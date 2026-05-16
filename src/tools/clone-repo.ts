import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { tool } from "@opencode-ai/plugin/tool";
import type { ToolDefinition } from "@opencode-ai/plugin/tool";

import type { WebAccessConfig } from "../config.ts";
import { cloneRepo } from "../git/clone.ts";
import { isPathWithinRoot, isRealPathWithinRoot } from "../git/path-safety.ts";
import { runCommand } from "../git/subprocess.ts";
import { normalizeRepoUrl } from "../git/url-normalizer.ts";

const z = tool.schema;

/**
 * Create the `clone_repo` tool.
 *
 * Clones a git repository to a local cache directory and returns the
 * filesystem path, a directory tree, and README content. The agent then
 * uses `read`/`grep`/`glob` to explore the clone.
 */
export function createCloneRepoTool(config: WebAccessConfig): ToolDefinition {
  return tool({
    description:
      "Clone a git repository and return its local path, file tree, and README. " +
      "Accepts any format: SSH URL, HTTPS URL, browser link, Sourcegraph path. " +
      "Repos are cached — repeated calls for the same URL reuse the existing clone. " +
      "When a file or directory path is extracted from the URL (or provided via `path`), " +
      "the response focuses on that path. Use `read`/`grep`/`glob` on the returned path for deeper exploration.",
    args: {
      url: z
        .string()
        .describe(
          "Git repository URL, browser link, or Sourcegraph path to clone",
        ),
      branch: z
        .string()
        .optional()
        .describe("Branch to clone (default: default branch)"),
      path: z
        .string()
        .optional()
        .describe("Subdirectory or file to focus on after cloning"),
      forceReclone: z
        .boolean()
        .optional()
        .describe("Force re-clone even if cached"),
    },
    async execute(args, context): Promise<string> {
      try {
        // --- 1. Normalize ---
        context.metadata({ title: "Normalizing URL..." });
        const normalized = normalizeRepoUrl(args.url);

        const focusPath = args.path ?? normalized.focusPath;
        const branch = args.branch ?? normalized.branch;

        // Guard: reject branch names that look like git options.
        if (branch && branch.startsWith("-")) {
          return "Error: Invalid branch name.";
        }

        // --- 2. Cache directory ---
        const hash = createHash("sha256")
          .update(normalized.cloneUrl)
          .digest("hex")
          .slice(0, 12);
        const cacheDir = join(config.clone.cachePath, hash);

        // --- 3. Clone or reuse ---
        const isCached = existsSync(cacheDir) && !args.forceReclone;

        if (!isCached) {
          context.metadata({
            title: `Cloning ${normalized.repoPath}...`,
          });

          const result = await cloneRepo(
            normalized.cloneUrl,
            cacheDir,
            config.clone.cachePath,
            branch,
            {
              timeoutMs: config.clone.timeoutSeconds * 1000,
              forceReclone: args.forceReclone === true,
              host: normalized.host,
              signal: context.abort,
            },
          );

          if (!result.success) {
            return result.error;
          }
        }

        // --- 4. Build response ---
        context.metadata({ title: "Building response..." });

        const parts: string[] = [];
        parts.push(`Cloned to: ${cacheDir}`);
        parts.push(`Repository: ${normalized.repoPath} (${normalized.host})`);
        if (branch) parts.push(`Branch: ${branch}`);
        if (isCached) parts.push("(using cached clone)");
        parts.push("");

        // Determine what to focus on
        const focusFullPath = focusPath
          ? join(cacheDir, focusPath)
          : undefined;

        // Guard: focusPath must resolve within the cache directory.
        // Two layers: resolve() catches ".." traversal (works pre-existence),
        // realpathSync() catches symlink escapes (works post-existence).
        if (focusFullPath) {
          if (!isPathWithinRoot(focusFullPath, cacheDir)) {
            return "Error: Path escapes repository boundary.";
          }
        }

        // If focusPath points to a file, return its content directly
        if (focusFullPath && existsSync(focusFullPath)) {
          // Symlink-aware check now that the path exists on disk.
          if (!isRealPathWithinRoot(focusFullPath, cacheDir)) {
            return "Error: Path escapes repository boundary.";
          }

          try {
            const stat = statSync(focusFullPath);
            if (stat.isFile()) {
              parts.push(`## File: ${focusPath}`);
              parts.push("");
              const content = readFileSafe(focusFullPath);
              parts.push(content);
              parts.push("");

              // Also show the parent directory tree for context
              const parentDir = dirname(focusFullPath);
              const parentTree = await getTree(parentDir, context.abort);
              if (parentTree) {
                parts.push("## Parent Directory");
                parts.push("");
                parts.push(parentTree);
              }

              return parts.join("\n");
            }
          } catch {
            // stat failed — fall through to tree listing
          }
        }

        // Tree listing — scoped to focusPath if it's a directory
        let treeTarget = cacheDir;
        if (focusFullPath && existsSync(focusFullPath)) {
          // Symlink-aware check before using focusFullPath for tree listing.
          treeTarget = isRealPathWithinRoot(focusFullPath, cacheDir)
            ? focusFullPath
            : cacheDir;
        }

        const treeHeader = focusPath
          ? `## Directory: ${focusPath}`
          : "## Repository Structure";
        parts.push(treeHeader);
        parts.push("");

        const tree = await getTree(treeTarget, context.abort);
        if (tree) {
          parts.push(tree);
        } else {
          // tree command not available — fall back to listing
          parts.push("(tree command not available)");
        }
        parts.push("");

        // README
        const readme = findAndReadReadme(cacheDir);
        if (readme) {
          parts.push(`## README`);
          parts.push("");
          parts.push(readme);
        }

        return parts.join("\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: Unexpected failure in clone_repo: ${msg}`;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Response-assembly helpers
// ---------------------------------------------------------------------------

/**
 * Run `tree` on a directory. Returns null if tree is not installed.
 */
async function getTree(
  dir: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const result = await runCommand(
    "tree",
    [dir, "--du", "-h", "-L", "3", "--dirsfirst", "-I", ".git|node_modules"],
    { timeoutMs: 10_000, signal },
  );

  if (!result.success) return null;

  // Truncate very large trees
  const lines = result.stdout.split("\n");
  if (lines.length > 200) {
    return (
      lines.slice(0, 200).join("\n") +
      `\n... (${lines.length - 200} more lines, use \`glob\` to explore)`
    );
  }

  return result.stdout.trim();
}

/** Try common README filenames, return content or undefined. */
function findAndReadReadme(dir: string): string | undefined {
  const names = ["README.md", "README", "readme.md", "Readme.md"];
  for (const name of names) {
    const fullPath = join(dir, name);
    if (existsSync(fullPath) && isRealPathWithinRoot(fullPath, dir)) {
      return readFileSafe(fullPath);
    }
  }
  return undefined;
}

/** Check if a buffer likely contains binary content (null bytes in first 8KB). */
function isBinaryContent(buf: Buffer): boolean {
  const checkLen = Math.min(buf.length, 8192);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Read a file, truncating if too large. Returns a string safe for
 * inclusion in tool output. Detects binary files via null-byte scan.
 */
function readFileSafe(filePath: string): string {
  try {
    const stat = statSync(filePath);
    // Skip very large files
    if (stat.size > 512 * 1024) {
      return `(file too large: ${Math.round(stat.size / 1024)}KB — use \`read\` tool to view specific sections)`;
    }
    const buf = readFileSync(filePath);
    // Skip binary files — null bytes in first 8KB indicate non-text content
    if (isBinaryContent(buf)) {
      return `(binary file: ${Math.round(stat.size / 1024)}KB — use \`read\` tool if needed)`;
    }
    const content = buf.toString("utf-8");
    // Truncate by line count for the tool response
    const lines = content.split("\n");
    if (lines.length > 500) {
      return (
        lines.slice(0, 500).join("\n") +
        `\n... (${lines.length - 500} more lines — use \`read\` tool for the rest)`
      );
    }
    return content;
  } catch {
    return "(unable to read file)";
  }
}
