import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isPathWithinRoot, isRealPathWithinRoot } from "../src/git/path-safety.ts";

// ---------------------------------------------------------------------------
// isPathWithinRoot — string-level checks (no filesystem)
// ---------------------------------------------------------------------------

describe("isPathWithinRoot", () => {
  test("exact root match returns true", () => {
    expect(isPathWithinRoot("/cache/repos", "/cache/repos")).toBe(true);
  });

  test("child path returns true", () => {
    expect(isPathWithinRoot("/cache/repos/owner/repo", "/cache/repos")).toBe(
      true,
    );
  });

  test("deeply nested child returns true", () => {
    expect(
      isPathWithinRoot("/cache/repos/a/b/c/d/e", "/cache/repos"),
    ).toBe(true);
  });

  test(".. traversal escaping root returns false", () => {
    expect(isPathWithinRoot("/cache/repos/../secret", "/cache/repos")).toBe(
      false,
    );
  });

  test(".. traversal that resolves back into root returns true", () => {
    // /cache/repos/a/../b resolves to /cache/repos/b — still within root
    expect(isPathWithinRoot("/cache/repos/a/../b", "/cache/repos")).toBe(true);
  });

  test("prefix-but-not-ancestor returns false", () => {
    // /cache/foobar is NOT within /cache/foo — it just shares a prefix
    expect(isPathWithinRoot("/cache/foobar", "/cache/foo")).toBe(false);
  });

  test("sibling directory returns false", () => {
    expect(isPathWithinRoot("/cache/other", "/cache/repos")).toBe(false);
  });

  test("parent directory returns false", () => {
    expect(isPathWithinRoot("/cache", "/cache/repos")).toBe(false);
  });

  test("root itself with trailing slash in input", () => {
    // resolve() normalizes, so trailing slash shouldn't matter
    expect(isPathWithinRoot("/cache/repos/", "/cache/repos")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isRealPathWithinRoot — filesystem-level with symlink resolution
// ---------------------------------------------------------------------------

describe("isRealPathWithinRoot", () => {
  let tmpRoot: string;
  let innerDir: string;
  let outsideDir: string;
  let childFile: string;
  let escapingSymlink: string;
  let safeSymlink: string;

  beforeAll(() => {
    // Create structure:
    //   tmpRoot/
    //     inner/
    //       child.txt
    //       safe-link -> inner/child.txt (stays within root)
    //       escape-link -> ../outside/ (escapes root)
    //     outside/
    //       secret.txt
    tmpRoot = mkdtempSync(join(tmpdir(), "path-safety-"));
    innerDir = join(tmpRoot, "inner");
    outsideDir = join(tmpRoot, "outside");

    mkdirSync(innerDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });

    childFile = join(innerDir, "child.txt");
    writeFileSync(childFile, "ok");

    writeFileSync(join(outsideDir, "secret.txt"), "secret");

    // Symlink that escapes: inner/escape-link -> ../outside
    escapingSymlink = join(innerDir, "escape-link");
    symlinkSync(outsideDir, escapingSymlink);

    // Symlink that stays within root: inner/safe-link -> child.txt
    safeSymlink = join(innerDir, "safe-link");
    symlinkSync(childFile, safeSymlink);
  });

  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("real child file within root returns true", () => {
    expect(isRealPathWithinRoot(childFile, innerDir)).toBe(true);
  });

  test("exact root match returns true", () => {
    expect(isRealPathWithinRoot(innerDir, innerDir)).toBe(true);
  });

  test("symlink escaping root returns false", () => {
    expect(isRealPathWithinRoot(escapingSymlink, innerDir)).toBe(false);
  });

  test("symlink within root returns true", () => {
    expect(isRealPathWithinRoot(safeSymlink, innerDir)).toBe(true);
  });

  test("non-existent path returns false", () => {
    expect(
      isRealPathWithinRoot(join(innerDir, "nope.txt"), innerDir),
    ).toBe(false);
  });

  test("non-existent root returns false", () => {
    expect(isRealPathWithinRoot(childFile, "/nonexistent/root")).toBe(false);
  });
});
