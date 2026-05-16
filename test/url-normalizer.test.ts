import { describe, expect, test } from "bun:test";

import { normalizeRepoUrl } from "../src/git/url-normalizer.ts";

// ---------------------------------------------------------------------------
// GitHub HTTPS URLs
// ---------------------------------------------------------------------------

describe("normalizeRepoUrl — GitHub HTTPS", () => {
  test("basic repo URL", () => {
    const result = normalizeRepoUrl("https://github.com/owner/repo");
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git");
    expect(result.host).toBe("github.com");
    expect(result.repoPath).toBe("owner/repo");
    expect(result.focusPath).toBeUndefined();
    expect(result.branch).toBeUndefined();
  });

  test("URL with .git suffix", () => {
    const result = normalizeRepoUrl("https://github.com/owner/repo.git");
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git");
    expect(result.repoPath).toBe("owner/repo");
  });

  test("blob URL extracts branch and file path", () => {
    const result = normalizeRepoUrl(
      "https://github.com/owner/repo/blob/main/src/index.ts",
    );
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git");
    expect(result.repoPath).toBe("owner/repo");
    expect(result.branch).toBe("main");
    expect(result.focusPath).toBe("src/index.ts");
  });

  test("tree URL extracts branch and directory path", () => {
    const result = normalizeRepoUrl(
      "https://github.com/owner/repo/tree/develop/src/lib",
    );
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git");
    expect(result.branch).toBe("develop");
    expect(result.focusPath).toBe("src/lib");
  });

  test("blob URL with branch only (no file path)", () => {
    const result = normalizeRepoUrl(
      "https://github.com/owner/repo/blob/main",
    );
    expect(result.repoPath).toBe("owner/repo");
    expect(result.branch).toBe("main");
    expect(result.focusPath).toBeUndefined();
  });

  test("trailing slash is stripped", () => {
    const result = normalizeRepoUrl("https://github.com/owner/repo/");
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git");
    expect(result.repoPath).toBe("owner/repo");
  });

  test("owner-only URL (no repo segment)", () => {
    const result = normalizeRepoUrl("https://github.com/owner");
    expect(result.host).toBe("github.com");
    expect(result.repoPath).toBe("owner");
  });
});

// ---------------------------------------------------------------------------
// GitLab HTTPS URLs
// ---------------------------------------------------------------------------

describe("normalizeRepoUrl — GitLab HTTPS", () => {
  test("basic repo URL", () => {
    const result = normalizeRepoUrl("https://gitlab.com/org/repo");
    expect(result.cloneUrl).toBe("git@gitlab.com:org/repo.git");
    expect(result.host).toBe("gitlab.com");
    expect(result.repoPath).toBe("org/repo");
  });

  test("nested group repo URL", () => {
    const result = normalizeRepoUrl(
      "https://gitlab.com/org/group/subgroup/repo",
    );
    expect(result.cloneUrl).toBe("git@gitlab.com:org/group/subgroup/repo.git");
    expect(result.repoPath).toBe("org/group/subgroup/repo");
  });

  test("URL with .git suffix", () => {
    const result = normalizeRepoUrl("https://gitlab.com/org/repo.git");
    expect(result.cloneUrl).toBe("git@gitlab.com:org/repo.git");
    expect(result.repoPath).toBe("org/repo");
  });

  test("/-/blob/ URL extracts branch and file path", () => {
    const result = normalizeRepoUrl(
      "https://gitlab.com/org/repo/-/blob/main/src/index.ts",
    );
    expect(result.cloneUrl).toBe("git@gitlab.com:org/repo.git");
    expect(result.repoPath).toBe("org/repo");
    expect(result.branch).toBe("main");
    expect(result.focusPath).toBe("src/index.ts");
  });

  test("/-/tree/ URL extracts branch and directory path", () => {
    const result = normalizeRepoUrl(
      "https://gitlab.com/org/repo/-/tree/develop/lib",
    );
    expect(result.repoPath).toBe("org/repo");
    expect(result.branch).toBe("develop");
    expect(result.focusPath).toBe("lib");
  });

  test("nested group with /-/blob/ path", () => {
    const result = normalizeRepoUrl(
      "https://gitlab.com/org/group/repo/-/blob/main/README.md",
    );
    expect(result.repoPath).toBe("org/group/repo");
    expect(result.branch).toBe("main");
    expect(result.focusPath).toBe("README.md");
  });

  test("custom GitLab host", () => {
    const result = normalizeRepoUrl("https://gitlab.example.com/team/project");
    expect(result.cloneUrl).toBe("git@gitlab.example.com:team/project.git");
    expect(result.host).toBe("gitlab.example.com");
    expect(result.repoPath).toBe("team/project");
  });
});

// ---------------------------------------------------------------------------
// Generic HTTPS URLs (unknown hosts)
// ---------------------------------------------------------------------------

describe("normalizeRepoUrl — generic HTTPS hosts", () => {
  test("bitbucket HTTPS URL", () => {
    const result = normalizeRepoUrl("https://bitbucket.org/team/project");
    expect(result.cloneUrl).toBe("https://bitbucket.org/team/project.git");
    expect(result.host).toBe("bitbucket.org");
    expect(result.repoPath).toBe("team/project");
  });

  test("single-segment path on unknown host", () => {
    const result = normalizeRepoUrl("https://sr.ht/~user");
    expect(result.host).toBe("sr.ht");
    expect(result.repoPath).toBe("~user");
  });

  test("GitHub issues URL extracts repo, ignores non-blob/tree path", () => {
    const result = normalizeRepoUrl(
      "https://github.com/owner/repo/issues/42",
    );
    expect(result.repoPath).toBe("owner/repo");
    expect(result.branch).toBeUndefined();
    expect(result.focusPath).toBeUndefined();
  });

  test("GitHub pull request URL extracts repo only", () => {
    const result = normalizeRepoUrl(
      "https://github.com/owner/repo/pull/123",
    );
    expect(result.repoPath).toBe("owner/repo");
    expect(result.branch).toBeUndefined();
    expect(result.focusPath).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SSH URLs
// ---------------------------------------------------------------------------

describe("normalizeRepoUrl — SSH", () => {
  test("GitHub SSH URL", () => {
    const result = normalizeRepoUrl("git@github.com:owner/repo.git");
    expect(result.cloneUrl).toBe("git@github.com:owner/repo.git");
    expect(result.host).toBe("github.com");
    expect(result.repoPath).toBe("owner/repo");
  });

  test("GitLab SSH URL", () => {
    const result = normalizeRepoUrl("git@gitlab.com:org/repo.git");
    expect(result.cloneUrl).toBe("git@gitlab.com:org/repo.git");
    expect(result.host).toBe("gitlab.com");
    expect(result.repoPath).toBe("org/repo");
  });

  test("SSH URL without .git suffix normalizes to include .git", () => {
    const result = normalizeRepoUrl("git@github.com:owner/repo");
    expect(result.cloneUrl).toBe("git@github.com:owner/repo.git");
    expect(result.repoPath).toBe("owner/repo");
  });

  test("SSH URL with custom host", () => {
    const result = normalizeRepoUrl("git@gitlab.internal.io:team/project.git");
    expect(result.host).toBe("gitlab.internal.io");
    expect(result.repoPath).toBe("team/project");
  });

  test("malformed SSH URL (no colon) degrades gracefully", () => {
    const result = normalizeRepoUrl("git@host-without-colon");
    expect(result.host).toBe("unknown");
    expect(result.cloneUrl).toBe("git@host-without-colon");
  });
});

// ---------------------------------------------------------------------------
// Sourcegraph bare paths
// ---------------------------------------------------------------------------

describe("normalizeRepoUrl — bare host paths", () => {
  test("GitLab bare path", () => {
    const result = normalizeRepoUrl("gitlab.com/org/repo");
    expect(result.cloneUrl).toBe("git@gitlab.com:org/repo.git");
    expect(result.host).toBe("gitlab.com");
    expect(result.repoPath).toBe("org/repo");
  });

  test("GitHub bare path", () => {
    const result = normalizeRepoUrl("github.com/owner/repo");
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git");
    expect(result.host).toBe("github.com");
    expect(result.repoPath).toBe("owner/repo");
  });

  test("custom GitLab bare path with nested groups", () => {
    const result = normalizeRepoUrl(
      "gitlab.example.com/org/group/subgroup/repo",
    );
    expect(result.cloneUrl).toBe(
      "git@gitlab.example.com:org/group/subgroup/repo.git",
    );
    expect(result.repoPath).toBe("org/group/subgroup/repo");
  });

  test("bare path with /-/blob/ extracts file info", () => {
    const result = normalizeRepoUrl(
      "gitlab.example.com/org/repo/-/blob/main/file.ts",
    );
    expect(result.repoPath).toBe("org/repo");
    expect(result.branch).toBe("main");
    expect(result.focusPath).toBe("file.ts");
  });

  test("unknown host bare path", () => {
    const result = normalizeRepoUrl("bitbucket.org/team/project");
    expect(result.cloneUrl).toBe("https://bitbucket.org/team/project.git");
    expect(result.host).toBe("bitbucket.org");
    expect(result.repoPath).toBe("team/project");
  });
});

// ---------------------------------------------------------------------------
// Security: unsafe schemes
// ---------------------------------------------------------------------------

describe("normalizeRepoUrl — security", () => {
  test("ext:: command injection throws", () => {
    expect(() => normalizeRepoUrl("ext::sh -c whoami% ")).toThrow(
      "only HTTPS and SSH URLs are supported",
    );
  });

  test("file:// local filesystem access throws", () => {
    expect(() => normalizeRepoUrl("file:///etc/passwd")).toThrow(
      "only HTTPS and SSH URLs are supported",
    );
  });

  test("git:// unauthenticated protocol throws", () => {
    expect(() => normalizeRepoUrl("git://github.com/owner/repo")).toThrow(
      "only HTTPS and SSH URLs are supported",
    );
  });

  test("ssh:// scheme throws (not the same as git@ syntax)", () => {
    expect(() =>
      normalizeRepoUrl("ssh://git@github.com/owner/repo"),
    ).toThrow("only HTTPS and SSH URLs are supported");
  });

  test("ftp:// scheme throws", () => {
    expect(() => normalizeRepoUrl("ftp://example.com/repo")).toThrow(
      "only HTTPS and SSH URLs are supported",
    );
  });

  test("FILE:// mixed-case evasion throws", () => {
    expect(() => normalizeRepoUrl("FILE:///etc/passwd")).toThrow(
      "only HTTPS and SSH URLs are supported",
    );
  });

  test("GIT:// mixed-case evasion throws", () => {
    expect(() => normalizeRepoUrl("GIT://github.com/repo")).toThrow(
      "only HTTPS and SSH URLs are supported",
    );
  });

  test("svn+ssh:// compound scheme throws", () => {
    expect(() => normalizeRepoUrl("svn+ssh://evil.com/repo")).toThrow(
      "only HTTPS and SSH URLs are supported",
    );
  });

  test("input starting with dash throws (option injection)", () => {
    expect(() => normalizeRepoUrl("-branch")).toThrow("Invalid repository URL");
  });

  test("input starting with --upload-pack throws", () => {
    expect(() => normalizeRepoUrl("--upload-pack=evil")).toThrow(
      "Invalid repository URL",
    );
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("normalizeRepoUrl — edge cases", () => {
  test("leading/trailing whitespace is trimmed", () => {
    const result = normalizeRepoUrl("  https://github.com/owner/repo  ");
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git");
  });

  test("multiple trailing slashes are stripped", () => {
    const result = normalizeRepoUrl("https://github.com/owner/repo///");
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git");
  });

  test("double .git.git suffix handled gracefully", () => {
    // .git is stripped once during path parsing; repo name keeps the first .git
    const result = normalizeRepoUrl("https://github.com/owner/repo.git.git");
    expect(result.repoPath).toBe("owner/repo.git");
    expect(result.cloneUrl).toBe("https://github.com/owner/repo.git.git");
  });

  test("http:// (non-TLS) is accepted", () => {
    const result = normalizeRepoUrl("http://github.com/owner/repo");
    expect(result.host).toBe("github.com");
    expect(result.repoPath).toBe("owner/repo");
  });

  test("unrecognized bare string without host pattern passes through", () => {
    const result = normalizeRepoUrl("just-a-string");
    expect(result.cloneUrl).toBe("just-a-string");
    expect(result.host).toBe("unknown");
    expect(result.repoPath).toBe("just-a-string");
  });

  test("empty segments in URL path are filtered", () => {
    const result = normalizeRepoUrl("https://github.com//owner//repo");
    expect(result.repoPath).toBe("owner/repo");
  });

  test("unicode in path segments is handled gracefully", () => {
    // URL constructor percent-encodes non-ASCII characters in the path
    const result = normalizeRepoUrl("https://github.com/owner/repo-\u00e9");
    expect(result.host).toBe("github.com");
    // The URL constructor encodes é → %C3%A9
    expect(result.repoPath).toBe("owner/repo-%C3%A9");
  });
});
