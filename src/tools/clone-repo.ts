import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

import { tool } from "@opencode-ai/plugin/tool";
import type { ToolDefinition } from "@opencode-ai/plugin/tool";

import type { WebAccessConfig } from "../config.ts";
import { normalizeRepoUrl } from "../git/url-normalizer";

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

          // Ensure parent directory exists
          mkdirSync(config.clone.cachePath, { recursive: true });

          // Remove stale cache if force-recloning
          if (existsSync(cacheDir)) {
            // Safety: only rm inside the expected cache directory
            if (!cacheDir.startsWith(config.clone.cachePath)) {
              return "Error: Cache directory path is outside expected cache root. Aborting.";
            }
            await runCommand("rm", ["-rf", cacheDir], {
              timeoutMs: 10_000,
              signal: context.abort,
            });
          }

          const cloneArgs = [
            "clone",
            "--depth",
            "1",
            "--single-branch",
          ];
          if (branch) {
            cloneArgs.push("--branch", branch);
          }
          cloneArgs.push(normalized.cloneUrl, cacheDir);

          const result = await runCommand("git", cloneArgs, {
            timeoutMs: config.clone.timeoutSeconds * 1000,
            signal: context.abort,
          });

          if (!result.success) {
            return formatCloneError(
              result.stderr,
              normalized.cloneUrl,
              normalized.host,
            );
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

        // If focusPath points to a file, return its content directly
        if (focusFullPath && existsSync(focusFullPath)) {
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
        const treeTarget =
          focusFullPath && existsSync(focusFullPath)
            ? focusFullPath
            : cacheDir;

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
// Helpers
// ---------------------------------------------------------------------------

interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Run a command via `spawn`, collecting stdout/stderr.
 *
 * Uses `setTimeout` + `process.kill()` for timeout (macOS has no `timeout`
 * command). Respects the abort signal from the tool context.
 */
function runCommand(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; signal?: AbortSignal | undefined },
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    // Timeout
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      // Give it a moment then SIGKILL
      killTimer = setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2000);
    }, opts.timeoutMs);

    // Abort signal from context
    const onAbort = (): void => {
      child.kill("SIGTERM");
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);

      resolve({
        success: code === 0,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        code,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      opts.signal?.removeEventListener("abort", onAbort);

      resolve({
        success: false,
        stdout: "",
        stderr: err.message,
        code: null,
      });
    });
  });
}

/** Produce a human-readable clone error message. */
function formatCloneError(
  stderr: string,
  cloneUrl: string,
  host: string,
): string {
  const lower = stderr.toLowerCase();

  if (
    lower.includes("could not resolve host") ||
    lower.includes("name or service not known")
  ) {
    return (
      `Error: Could not resolve host for ${cloneUrl}. ` +
      "Check the URL and your network connection."
    );
  }

  if (
    lower.includes("permission denied") ||
    lower.includes("authentication failed") ||
    lower.includes("could not read from remote")
  ) {
    const hint =
      host === "github.com"
        ? "For private GitHub repos, ensure SSH keys are configured (git@github.com:...)."
        : `Ensure your SSH key has access to ${host}.`;
    return `Error: Authentication failed for ${cloneUrl}. ${hint}`;
  }

  if (
    lower.includes("not found") ||
    lower.includes("does not exist") ||
    lower.includes("repository not found")
  ) {
    return `Error: Repository not found: ${cloneUrl}. Check the URL is correct.`;
  }

  if (
    lower.includes("remote branch") &&
    lower.includes("not found")
  ) {
    return `Error: Branch not found in ${cloneUrl}. Check the branch name.`;
  }

  if (lower.includes("signal") || lower.includes("killed")) {
    return `Error: Clone timed out or was cancelled for ${cloneUrl}.`;
  }

  // Generic fallback
  return `Error: git clone failed for ${cloneUrl}.\n${stderr.trim()}`;
}

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
    if (existsSync(fullPath)) {
      return readFileSafe(fullPath);
    }
  }
  return undefined;
}

/**
 * Read a file, truncating if too large. Returns a string safe for
 * inclusion in tool output.
 */
function readFileSafe(filePath: string): string {
  try {
    const stat = statSync(filePath);
    // Skip binary / very large files
    if (stat.size > 512 * 1024) {
      return `(file too large: ${Math.round(stat.size / 1024)}KB — use \`read\` tool to view specific sections)`;
    }
    const content = readFileSync(filePath, "utf-8");
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
