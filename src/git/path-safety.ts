import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * String-level check: does `target` resolve within `root`?
 * Catches `..` traversal. Does NOT follow symlinks.
 */
export function isPathWithinRoot(target: string, root: string): boolean {
  const resolvedTarget = resolve(target);
  const resolvedRoot = resolve(root);
  return (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(resolvedRoot + "/")
  );
}

/**
 * Filesystem-level check: does `target`'s real path (symlinks resolved)
 * stay within `root`? Both paths must exist on disk.
 * Returns `false` if either path doesn't exist.
 */
export function isRealPathWithinRoot(target: string, root: string): boolean {
  try {
    const realTarget = realpathSync(target);
    const realRoot = realpathSync(root);
    return (
      realTarget === realRoot || realTarget.startsWith(realRoot + "/")
    );
  } catch {
    // Path doesn't exist — safe to reject.
    return false;
  }
}
