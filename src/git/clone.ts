import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { runCommand } from "./subprocess.ts";

/** Produce a human-readable clone error message. */
export function formatCloneError(
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

interface CloneOptions {
  timeoutMs: number;
  forceReclone: boolean;
  /** Host from URL normalization — used for error messages. */
  host: string;
  signal?: AbortSignal;
}

type CloneResult =
  | { success: true; cacheDir: string }
  | { success: false; error: string };

/**
 * Clone a git repository into a cache directory.
 *
 * Handles mkdir, stale cache removal, git clone invocation, and error formatting.
 *
 * @param cacheRoot - The configured cache root directory (e.g. `~/.cache/opencode/repos`).
 *                    Used for mkdir and as the safety boundary for rm -rf.
 */
export async function cloneRepo(
  cloneUrl: string,
  cacheDir: string,
  cacheRoot: string,
  branch: string | undefined,
  opts: CloneOptions,
): Promise<CloneResult> {
  // Ensure cache root directory exists
  mkdirSync(cacheRoot, { recursive: true });

  // Remove stale cache if force-recloning
  if (existsSync(cacheDir) && opts.forceReclone) {
    // Safety: only rm inside the configured cache root
    const resolvedCacheDir = resolve(cacheDir);
    const resolvedCacheRoot = resolve(cacheRoot);
    if (!resolvedCacheDir.startsWith(resolvedCacheRoot + "/")) {
      return {
        success: false,
        error: "Error: Cache directory path is outside expected cache root. Aborting.",
      };
    }
    await runCommand("rm", ["-rf", cacheDir], {
      timeoutMs: 10_000,
      signal: opts.signal,
    });
  }

  const cloneArgs = ["clone", "--depth", "1", "--single-branch"];
  if (branch) {
    cloneArgs.push("--branch", branch);
  }
  cloneArgs.push("--", cloneUrl, cacheDir);

  const result = await runCommand("git", cloneArgs, {
    timeoutMs: opts.timeoutMs,
    signal: opts.signal,
  });

  if (!result.success) {
    return {
      success: false,
      error: formatCloneError(result.stderr, cloneUrl, opts.host),
    };
  }

  return { success: true, cacheDir };
}
