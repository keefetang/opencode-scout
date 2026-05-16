import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { parseConfigObject } from "../src/config.ts";

// ---------------------------------------------------------------------------
// parseConfigObject — validates raw config objects
// ---------------------------------------------------------------------------

describe("parseConfigObject", () => {
  test("returns empty object for null", () => {
    expect(parseConfigObject(null)).toEqual({});
  });

  test("returns empty object for array", () => {
    expect(parseConfigObject([1, 2])).toEqual({});
  });

  test("returns empty object for string", () => {
    expect(parseConfigObject("not an object")).toEqual({});
  });

  test("returns empty object for number", () => {
    expect(parseConfigObject(42)).toEqual({});
  });

  test("extracts valid string API keys", () => {
    const result = parseConfigObject({
      exaApiKey: "exa-key",
      tinyFishApiKey: "tf-key",
      geminiApiKey: "gem-key",
    });
    expect(result.exaApiKey).toBe("exa-key");
    expect(result.tinyFishApiKey).toBe("tf-key");
    expect(result.geminiApiKey).toBe("gem-key");
  });

  test("drops non-string API keys", () => {
    const result = parseConfigObject({
      exaApiKey: 123,
      tinyFishApiKey: true,
      geminiApiKey: null,
    });
    expect(result.exaApiKey).toBeUndefined();
    expect(result.tinyFishApiKey).toBeUndefined();
    expect(result.geminiApiKey).toBeUndefined();
  });

  test("accepts valid provider values", () => {
    for (const p of ["auto", "exa", "tinyfish", "gemini"] as const) {
      expect(parseConfigObject({ provider: p }).provider).toBe(p);
    }
  });

  test("drops invalid provider string", () => {
    expect(parseConfigObject({ provider: "bing" }).provider).toBeUndefined();
  });

  test("drops non-string provider", () => {
    expect(parseConfigObject({ provider: 42 }).provider).toBeUndefined();
  });

  test("extracts valid gemini model", () => {
    const result = parseConfigObject({ gemini: { model: "gemini-pro" } });
    expect(result.gemini).toEqual({ model: "gemini-pro" });
  });

  test("drops gemini when not an object", () => {
    expect(parseConfigObject({ gemini: "string" }).gemini).toBeUndefined();
  });

  test("drops gemini when array", () => {
    expect(parseConfigObject({ gemini: [1] }).gemini).toBeUndefined();
  });

  test("drops gemini when null", () => {
    expect(parseConfigObject({ gemini: null }).gemini).toBeUndefined();
  });

  test("drops gemini.model when not a string", () => {
    const result = parseConfigObject({ gemini: { model: 42 } });
    expect(result.gemini).toBeUndefined();
  });

  test("extracts valid clone config", () => {
    const result = parseConfigObject({
      clone: { cachePath: "/tmp/repos", timeoutSeconds: 30, maxSizeMB: 100 },
    });
    expect(result.clone).toEqual({
      cachePath: "/tmp/repos",
      timeoutSeconds: 30,
      maxSizeMB: 100,
    });
  });

  test("drops clone when not an object", () => {
    expect(parseConfigObject({ clone: "string" }).clone).toBeUndefined();
  });

  test("drops clone when null", () => {
    expect(parseConfigObject({ clone: null }).clone).toBeUndefined();
  });

  test("drops negative timeoutSeconds", () => {
    const result = parseConfigObject({ clone: { timeoutSeconds: -5 } });
    expect(result.clone?.timeoutSeconds).toBeUndefined();
  });

  test("drops zero timeoutSeconds", () => {
    const result = parseConfigObject({ clone: { timeoutSeconds: 0 } });
    expect(result.clone?.timeoutSeconds).toBeUndefined();
  });

  test("drops NaN timeoutSeconds", () => {
    const result = parseConfigObject({ clone: { timeoutSeconds: NaN } });
    expect(result.clone?.timeoutSeconds).toBeUndefined();
  });

  test("drops Infinity maxSizeMB", () => {
    const result = parseConfigObject({ clone: { maxSizeMB: Infinity } });
    expect(result.clone?.maxSizeMB).toBeUndefined();
  });

  test("drops negative maxSizeMB", () => {
    const result = parseConfigObject({ clone: { maxSizeMB: -10 } });
    expect(result.clone?.maxSizeMB).toBeUndefined();
  });

  test("drops non-number clone values", () => {
    const result = parseConfigObject({
      clone: { timeoutSeconds: "fast", maxSizeMB: true },
    });
    expect(result.clone?.timeoutSeconds).toBeUndefined();
    expect(result.clone?.maxSizeMB).toBeUndefined();
  });

  test("ignores unknown fields", () => {
    const result = parseConfigObject({ unknownField: "hello", exaApiKey: "key" });
    expect(result.exaApiKey).toBe("key");
    expect((result as Record<string, unknown>)["unknownField"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// loadConfig — integration tests with env var overrides
// ---------------------------------------------------------------------------

import { writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadConfig } from "../src/config.ts";

// Use a nonexistent config file path to isolate tests from the real
// ~/.config/opencode/web-access.json. This ensures deterministic defaults.
const NO_FILE = "/tmp/.opencode-scout-test-nonexistent-config.json";

describe("loadConfig", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = ["EXA_API_KEY", "TINYFISH_API_KEY", "GEMINI_API_KEY"];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test("returns exact defaults when no file, no options, no env", () => {
    const config = loadConfig(undefined, NO_FILE);
    expect(config.provider).toBe("auto");
    expect(config.gemini.model).toBe("gemini-2.5-flash");
    expect(config.clone.timeoutSeconds).toBe(60);
    expect(config.clone.maxSizeMB).toBe(350);
    expect(config.exaApiKey).toBeUndefined();
    expect(config.tinyFishApiKey).toBeUndefined();
    expect(config.geminiApiKey).toBeUndefined();
  });

  test("options override defaults", () => {
    const config = loadConfig(
      {
        provider: "exa",
        gemini: { model: "custom-model" },
        clone: { timeoutSeconds: 120, maxSizeMB: 500 },
      },
      NO_FILE,
    );
    expect(config.provider).toBe("exa");
    expect(config.gemini.model).toBe("custom-model");
    expect(config.clone.timeoutSeconds).toBe(120);
    expect(config.clone.maxSizeMB).toBe(500);
  });

  test("env var overrides options for API keys", () => {
    process.env["EXA_API_KEY"] = "env-exa-key";
    const config = loadConfig({ exaApiKey: "opts-exa-key" }, NO_FILE);
    expect(config.exaApiKey).toBe("env-exa-key");
  });

  test("empty env var treated as unset — options value wins", () => {
    process.env["EXA_API_KEY"] = "";
    const config = loadConfig({ exaApiKey: "opts-exa-key" }, NO_FILE);
    expect(config.exaApiKey).toBe("opts-exa-key");
  });

  test("env var set, no options — env var used", () => {
    process.env["GEMINI_API_KEY"] = "env-gemini";
    const config = loadConfig(undefined, NO_FILE);
    expect(config.geminiApiKey).toBe("env-gemini");
  });

  test("invalid options are silently dropped", () => {
    const config = loadConfig(
      {
        provider: "invalid-provider",
        clone: { timeoutSeconds: -1, maxSizeMB: NaN },
      },
      NO_FILE,
    );
    expect(config.provider).toBe("auto");
    expect(config.clone.timeoutSeconds).toBe(60);
    expect(config.clone.maxSizeMB).toBe(350);
  });

  test("options API key used when no env var set", () => {
    const config = loadConfig({ tinyFishApiKey: "opts-tinyfish" }, NO_FILE);
    expect(config.tinyFishApiKey).toBe("opts-tinyfish");
  });

  // --- File-based config tests ---

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "scout-config-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("reads config from JSON file", () => {
    const filePath = join(tmpDir, "config.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        exaApiKey: "file-exa",
        provider: "gemini",
        gemini: { model: "gemini-pro" },
      }),
    );
    const config = loadConfig(undefined, filePath);
    expect(config.exaApiKey).toBe("file-exa");
    expect(config.provider).toBe("gemini");
    expect(config.gemini.model).toBe("gemini-pro");
  });

  test("options override file values", () => {
    const filePath = join(tmpDir, "config.json");
    writeFileSync(
      filePath,
      JSON.stringify({ provider: "exa", gemini: { model: "file-model" } }),
    );
    const config = loadConfig(
      { provider: "gemini", gemini: { model: "opts-model" } },
      filePath,
    );
    expect(config.provider).toBe("gemini");
    expect(config.gemini.model).toBe("opts-model");
  });

  test("env var overrides file API key", () => {
    const filePath = join(tmpDir, "config.json");
    writeFileSync(filePath, JSON.stringify({ exaApiKey: "file-exa" }));
    process.env["EXA_API_KEY"] = "env-exa";
    const config = loadConfig(undefined, filePath);
    expect(config.exaApiKey).toBe("env-exa");
  });

  test("malformed JSON file silently ignored", () => {
    const filePath = join(tmpDir, "config.json");
    writeFileSync(filePath, "not valid json {{{");
    const config = loadConfig(undefined, filePath);
    expect(config.provider).toBe("auto"); // defaults
  });
});
