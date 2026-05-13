/**
 * Normalizes any repository reference into a cloneable URL.
 *
 * Handles SSH URLs, HTTPS URLs, Sourcegraph paths, browser file/tree URLs
 * for both GitHub and GitLab hosts. See anchor.md "URL Normalization" for
 * the full format matrix.
 */

export interface NormalizedRepo {
  /** URL suitable for `git clone`. */
  cloneUrl: string;
  /** Hostname (e.g., "github.com", "gitlab.example.com"). */
  host: string;
  /** Owner/repo path (e.g., "owner/repo"). */
  repoPath: string;
  /** File or directory path extracted from a browser URL. */
  focusPath?: string | undefined;
  /** Branch extracted from a browser file/tree URL. */
  branch?: string | undefined;
}

/**
 * Normalize any repo reference into a cloneable URL.
 *
 * Pure function — no I/O, no side effects.
 */
export function normalizeRepoUrl(input: string): NormalizedRepo {
  const trimmed = input.trim().replace(/\/+$/, "");

  // --- SSH URL: git@host:org/repo.git ---
  if (trimmed.startsWith("git@")) {
    return parseSshUrl(trimmed);
  }

  // --- HTTPS URL ---
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return parseHttpsUrl(trimmed);
  }

  // --- Bare host path (Sourcegraph format): gitlab.example.com/org/repo ---
  if (looksLikeBareHostPath(trimmed)) {
    return parseBareHostPath(trimmed);
  }

  // Unrecognized — pass through as-is and let git figure it out.
  return {
    cloneUrl: trimmed,
    host: "unknown",
    repoPath: trimmed,
  };
}

// ---------------------------------------------------------------------------
// SSH: git@host:org/repo.git
// ---------------------------------------------------------------------------

function parseSshUrl(url: string): NormalizedRepo {
  // git@gitlab.example.com:org/repo.git
  const match = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (!match) {
    return { cloneUrl: url, host: "unknown", repoPath: url };
  }

  const host = match[1]!;
  const repoPath = match[2]!;
  const cloneUrl = `git@${host}:${repoPath}.git`;

  return { cloneUrl, host, repoPath };
}

// ---------------------------------------------------------------------------
// HTTPS URLs (with optional file/tree paths)
// ---------------------------------------------------------------------------

function parseHttpsUrl(rawUrl: string): NormalizedRepo {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { cloneUrl: rawUrl, host: "unknown", repoPath: rawUrl };
  }

  const host = url.hostname.toLowerCase();
  // Remove leading slash, strip trailing .git for path parsing
  const fullPath = url.pathname.replace(/^\//, "").replace(/\.git$/, "");

  // Split into segments for analysis
  const segments = fullPath.split("/").filter(Boolean);

  if (host.includes("gitlab")) {
    return parseGitLabHttpsUrl(host, segments);
  }

  if (host.includes("github")) {
    return parseGitHubHttpsUrl(host, segments);
  }

  // Unknown host — pass through as-is, stripping common path decorations.
  return parseGenericHttpsUrl(host, segments, rawUrl);
}

/**
 * GitLab HTTPS URL patterns:
 *   /org/repo
 *   /org/repo.git
 *   /org/group/subgroup/repo (nested groups)
 *   /org/repo/-/blob/branch/path/to/file
 *   /org/repo/-/tree/branch/path/to/dir
 */
function parseGitLabHttpsUrl(
  host: string,
  segments: string[],
): NormalizedRepo {
  // Find the `/-/` separator that marks file/tree paths
  const dashIdx = segments.indexOf("-");

  let repoSegments: string[];
  let focusPath: string | undefined;
  let branch: string | undefined;

  if (dashIdx >= 2) {
    // Has /-/blob/ or /-/tree/
    repoSegments = segments.slice(0, dashIdx);
    const pathType = segments[dashIdx + 1]; // "blob" or "tree"

    if (
      (pathType === "blob" || pathType === "tree") &&
      segments.length > dashIdx + 2
    ) {
      branch = segments[dashIdx + 2];
      const rest = segments.slice(dashIdx + 3);
      if (rest.length > 0) {
        focusPath = rest.join("/");
      }
    }
  } else {
    repoSegments = segments;
  }

  const repoPath = repoSegments.join("/");
  const cloneUrl = toSshUrl(host, repoPath);

  return { cloneUrl, host, repoPath, focusPath, branch };
}

/**
 * GitHub HTTPS URL patterns:
 *   /owner/repo
 *   /owner/repo.git
 *   /owner/repo/blob/branch/path/to/file
 *   /owner/repo/tree/branch/path/to/dir
 */
function parseGitHubHttpsUrl(
  host: string,
  segments: string[],
): NormalizedRepo {
  // GitHub repos are always exactly 2 segments: owner/repo
  if (segments.length < 2) {
    const repoPath = segments.join("/");
    return {
      cloneUrl: `https://${host}/${repoPath}`,
      host,
      repoPath,
    };
  }

  const owner = segments[0]!;
  const repo = segments[1]!;
  const repoPath = `${owner}/${repo}`;

  let focusPath: string | undefined;
  let branch: string | undefined;

  // /owner/repo/blob/branch/... or /owner/repo/tree/branch/...
  const pathType = segments[2];
  if (
    (pathType === "blob" || pathType === "tree") &&
    segments.length > 3
  ) {
    branch = segments[3];
    const rest = segments.slice(4);
    if (rest.length > 0) {
      focusPath = rest.join("/");
    }
  }

  // GitHub: HTTPS for public repos (SSH fallback handled at clone time)
  const cloneUrl = `https://${host}/${repoPath}.git`;

  return { cloneUrl, host, repoPath, focusPath, branch };
}

/**
 * Generic HTTPS — unknown host. Pass through as-is. The user's git
 * config handles auth. Strip obvious file/tree path segments if present.
 */
function parseGenericHttpsUrl(
  host: string,
  segments: string[],
  rawUrl: string,
): NormalizedRepo {
  if (segments.length < 2) {
    return { cloneUrl: rawUrl, host, repoPath: segments.join("/") };
  }

  const repoPath = `${segments[0]}/${segments[1]}`;
  const cloneUrl = `https://${host}/${repoPath}.git`;
  return { cloneUrl, host, repoPath };
}

// ---------------------------------------------------------------------------
// Bare host path (Sourcegraph/lucerna format): gitlab.example.com/org/repo
// ---------------------------------------------------------------------------

/**
 * Heuristic: looks like `host.tld/path` — has a dot in the first segment
 * and at least one `/` separator.
 */
function looksLikeBareHostPath(input: string): boolean {
  const slash = input.indexOf("/");
  if (slash <= 0) return false;
  const maybeHost = input.slice(0, slash);
  return maybeHost.includes(".");
}

function parseBareHostPath(input: string): NormalizedRepo {
  const slash = input.indexOf("/");
  const host = input.slice(0, slash).toLowerCase();
  const remaining = input.slice(slash + 1);

  // Delegate to host-specific parsers so file/tree path extraction works
  // even for bare paths (e.g., `gitlab.example.com/org/repo/-/blob/main/file.ts`).
  const segments = remaining.split("/").filter(Boolean);

  if (host.includes("gitlab")) {
    return parseGitLabHttpsUrl(host, segments);
  }

  if (host.includes("github")) {
    return parseGitHubHttpsUrl(host, segments);
  }

  // GitLab and GitHub hosts are handled above — this fallback is for
  // unknown hosts where HTTPS is the safest default.
  const repoPath = remaining;
  const cloneUrl = `https://${host}/${repoPath}.git`;

  return { cloneUrl, host, repoPath };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert host + repo path to SSH clone URL. */
function toSshUrl(host: string, repoPath: string): string {
  const clean = repoPath.replace(/\.git$/, "");
  return `git@${host}:${clean}.git`;
}
