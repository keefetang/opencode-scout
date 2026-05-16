import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CONFIG_PATH = join(homedir(), ".config", "opencode", "web-access.json");

export interface WebAccessConfig {
  exaApiKey?: string;
  tinyFishApiKey?: string;
  geminiApiKey?: string;
  provider: "auto" | "exa" | "tinyfish" | "gemini";
  gemini: { model: string };
  clone: {
    cachePath: string;
    timeoutSeconds: number;
    maxSizeMB: number;
  };
}

/** Raw shape of `~/.config/opencode/web-access.json` — all fields optional. */
interface ConfigFile {
  exaApiKey?: string;
  tinyFishApiKey?: string;
  geminiApiKey?: string;
  provider?: "auto" | "exa" | "tinyfish" | "gemini";
  gemini?: { model?: string };
  clone?: {
    cachePath?: string;
    timeoutSeconds?: number;
    maxSizeMB?: number;
  };
}

const VALID_PROVIDERS = new Set(["auto", "exa", "tinyfish", "gemini"]);

/** Read and validate the config file. Invalid fields are silently dropped. */
function readConfigFile(configPath: string): ConfigFile {
  let parsed: unknown;
  try {
    const raw = readFileSync(configPath, "utf-8");
    parsed = JSON.parse(raw);
  } catch {
    // File doesn't exist or is malformed — both are fine.
    return {};
  }

  return parseConfigObject(parsed);
}

/**
 * Parse and validate a raw config object (from JSON file or plugin options).
 * Invalid fields are silently dropped.
 *
 * @internal Exported for testing.
 */
export function parseConfigObject(parsed: unknown): ConfigFile {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const obj = parsed as Record<string, unknown>;
  const result: ConfigFile = {};

  if (typeof obj["exaApiKey"] === "string") result.exaApiKey = obj["exaApiKey"];
  if (typeof obj["tinyFishApiKey"] === "string")
    result.tinyFishApiKey = obj["tinyFishApiKey"];
  if (typeof obj["geminiApiKey"] === "string")
    result.geminiApiKey = obj["geminiApiKey"];

  if (typeof obj["provider"] === "string" && VALID_PROVIDERS.has(obj["provider"]))
    result.provider = obj["provider"] as "auto" | "exa" | "tinyfish" | "gemini";

  const gemini = obj["gemini"];
  if (typeof gemini === "object" && gemini !== null && !Array.isArray(gemini)) {
    const g = gemini as Record<string, unknown>;
    if (typeof g["model"] === "string") result.gemini = { model: g["model"] };
  }

  const clone = obj["clone"];
  if (typeof clone === "object" && clone !== null && !Array.isArray(clone)) {
    const c = clone as Record<string, unknown>;
    const cloneConfig: ConfigFile["clone"] = {};
    if (typeof c["cachePath"] === "string") cloneConfig.cachePath = c["cachePath"];
    if (typeof c["timeoutSeconds"] === "number" && Number.isFinite(c["timeoutSeconds"]) && c["timeoutSeconds"] > 0)
      cloneConfig.timeoutSeconds = c["timeoutSeconds"];
    if (typeof c["maxSizeMB"] === "number" && Number.isFinite(c["maxSizeMB"]) && c["maxSizeMB"] > 0)
      cloneConfig.maxSizeMB = c["maxSizeMB"];
    result.clone = cloneConfig;
  }

  return result;
}

/**
 * Load plugin configuration.
 *
 * Precedence: env vars > opencode.jsonc options > web-access.json file > defaults.
 *
 * @param options - Plugin options from opencode.jsonc (same shape as ConfigFile)
 * @param configPath - Path to the JSON config file. Defaults to `~/.config/opencode/web-access.json`.
 *                     Exposed for testing — production callers should omit this.
 */
export function loadConfig(
  options?: Record<string, unknown>,
  configPath: string = DEFAULT_CONFIG_PATH,
): WebAccessConfig {
  const file = readConfigFile(configPath);
  const opts = options ? parseConfigObject(options) : {};

  // Merge: options override file values, then env vars override everything.
  const config: WebAccessConfig = {
    provider: opts.provider ?? file.provider ?? "auto",
    gemini: {
      model: opts.gemini?.model ?? file.gemini?.model ?? "gemini-2.5-flash",
    },
    clone: {
      cachePath:
        opts.clone?.cachePath ??
        file.clone?.cachePath ??
        join(homedir(), ".cache", "opencode", "repos"),
      timeoutSeconds:
        opts.clone?.timeoutSeconds ?? file.clone?.timeoutSeconds ?? 60,
      maxSizeMB: opts.clone?.maxSizeMB ?? file.clone?.maxSizeMB ?? 350,
    },
  };

  // Env vars override everything. Empty env vars (EXA_API_KEY="") are
  // treated as unset — the options/file value wins. This is intentional.
  const exaApiKey =
    process.env["EXA_API_KEY"] || opts.exaApiKey || file.exaApiKey;
  if (exaApiKey) config.exaApiKey = exaApiKey;

  const tinyFishApiKey =
    process.env["TINYFISH_API_KEY"] || opts.tinyFishApiKey || file.tinyFishApiKey;
  if (tinyFishApiKey) config.tinyFishApiKey = tinyFishApiKey;

  const geminiApiKey =
    process.env["GEMINI_API_KEY"] || opts.geminiApiKey || file.geminiApiKey;
  if (geminiApiKey) config.geminiApiKey = geminiApiKey;

  return config;
}
