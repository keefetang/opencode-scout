import { describe, expect, test } from "bun:test";

import type { SearchResult } from "../src/providers/types.ts";
import {
  formatResultForLLM,
  isCloneableUrl,
} from "../src/tools/web-search.ts";

// ---------------------------------------------------------------------------
// isCloneableUrl
// ---------------------------------------------------------------------------

describe("isCloneableUrl", () => {
  test("github.com URL is cloneable", () => {
    expect(isCloneableUrl("https://github.com/owner/repo")).toBe(true);
  });

  test("gitlab.com URL is cloneable", () => {
    expect(isCloneableUrl("https://gitlab.com/org/repo")).toBe(true);
  });

  test("custom gitlab host is cloneable", () => {
    expect(isCloneableUrl("https://gitlab.example.com/org/repo")).toBe(true);
  });

  test("non-cloneable host returns false", () => {
    expect(isCloneableUrl("https://stackoverflow.com/questions/12345")).toBe(
      false,
    );
  });

  test("docs site returns false", () => {
    expect(isCloneableUrl("https://docs.example.com/guide")).toBe(false);
  });

  test("invalid URL returns false", () => {
    expect(isCloneableUrl("not-a-url")).toBe(false);
  });

  test("empty string returns false", () => {
    expect(isCloneableUrl("")).toBe(false);
  });

  test("host containing 'github.com' as substring is not cloneable", () => {
    expect(isCloneableUrl("https://notgithub.com/owner/repo")).toBe(false);
    expect(isCloneableUrl("https://github.com.evil.com/owner/repo")).toBe(
      false,
    );
  });

  test("github.com subdomain is cloneable", () => {
    expect(isCloneableUrl("https://gist.github.com/user/id")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatResultForLLM
// ---------------------------------------------------------------------------

describe("formatResultForLLM", () => {
  test("result with no sources", () => {
    const result: SearchResult = {
      answer: "The answer is 42.",
      sources: [],
      provider: "exa",
    };
    const formatted = formatResultForLLM(result);
    expect(formatted).toContain("## Search Results (via exa)");
    expect(formatted).toContain("The answer is 42.");
    expect(formatted).not.toContain("Sources:");
  });

  test("result with non-cloneable sources", () => {
    const result: SearchResult = {
      answer: "Some answer.",
      sources: [
        { title: "Stack Overflow", url: "https://stackoverflow.com/q/1" },
        { title: "MDN", url: "https://developer.mozilla.org/docs" },
      ],
      provider: "gemini",
    };
    const formatted = formatResultForLLM(result);
    expect(formatted).toContain("## Search Results (via gemini)");
    expect(formatted).toContain("Sources:");
    expect(formatted).toContain("[1] Stack Overflow (https://stackoverflow.com/q/1)");
    expect(formatted).toContain("[2] MDN (https://developer.mozilla.org/docs)");
    // No cloneable section
    expect(formatted).not.toContain("Cloneable repositories:");
    expect(formatted).not.toContain("[cloneable]");
  });

  test("result with cloneable GitHub sources", () => {
    const result: SearchResult = {
      answer: "Check this repo.",
      sources: [
        { title: "Cool Repo", url: "https://github.com/owner/cool-repo" },
      ],
      provider: "exa",
    };
    const formatted = formatResultForLLM(result);
    expect(formatted).toContain("[cloneable]");
    expect(formatted).toContain("Cloneable repositories:");
    expect(formatted).toContain("- https://github.com/owner/cool-repo");
  });

  test("result with cloneable GitLab sources", () => {
    const result: SearchResult = {
      answer: "Check this repo.",
      sources: [
        { title: "GL Repo", url: "https://gitlab.com/org/project" },
      ],
      provider: "exa",
    };
    const formatted = formatResultForLLM(result);
    expect(formatted).toContain("[cloneable]");
    expect(formatted).toContain("Cloneable repositories:");
    expect(formatted).toContain("- https://gitlab.com/org/project");
  });

  test("result with mixed sources — cloneable and non-cloneable", () => {
    const result: SearchResult = {
      answer: "Mixed results.",
      sources: [
        { title: "Docs", url: "https://docs.example.com/guide" },
        { title: "GitHub Repo", url: "https://github.com/owner/repo" },
        { title: "Blog", url: "https://blog.example.com/post" },
        { title: "GitLab Repo", url: "https://gitlab.com/org/repo" },
      ],
      provider: "tinyfish",
    };
    const formatted = formatResultForLLM(result);

    // Header
    expect(formatted).toContain("## Search Results (via tinyfish)");

    // Sources list — all 4 present
    expect(formatted).toContain("[1] Docs (https://docs.example.com/guide)");
    expect(formatted).toContain(
      "[2] GitHub Repo (https://github.com/owner/repo) [cloneable]",
    );
    expect(formatted).toContain("[3] Blog (https://blog.example.com/post)");
    expect(formatted).toContain(
      "[4] GitLab Repo (https://gitlab.com/org/repo) [cloneable]",
    );

    // Cloneable section — only the 2 cloneable ones
    expect(formatted).toContain("Cloneable repositories:");
    expect(formatted).toContain("- https://github.com/owner/repo");
    expect(formatted).toContain("- https://gitlab.com/org/repo");
  });

  test("provider name appears in header", () => {
    const result: SearchResult = {
      answer: "Test",
      sources: [],
      provider: "custom-provider",
    };
    expect(formatResultForLLM(result)).toContain(
      "## Search Results (via custom-provider)",
    );
  });
});
