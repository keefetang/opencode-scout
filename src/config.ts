import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".config", "opencode", "web-access.json");

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
function readConfigFile(): ConfigFile {
  let parsed: unknown;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    parsed = JSON.parse(raw);
  } catch {
    // File doesn't exist or is malformed — both are fine.
    return {};
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const obj = parsed as Record<string, unknown>;
  const file: ConfigFile = {};

  if (typeof obj["exaApiKey"] === "string") file.exaApiKey = obj["exaApiKey"];
  if (typeof obj["tinyFishApiKey"] === "string")
    file.tinyFishApiKey = obj["tinyFishApiKey"];
  if (typeof obj["geminiApiKey"] === "string")
    file.geminiApiKey = obj["geminiApiKey"];

  if (typeof obj["provider"] === "string" && VALID_PROVIDERS.has(obj["provider"]))
    file.provider = obj["provider"] as "auto" | "exa" | "tinyfish" | "gemini";

  const gemini = obj["gemini"];
  if (typeof gemini === "object" && gemini !== null && !Array.isArray(gemini)) {
    const g = gemini as Record<string, unknown>;
    if (typeof g["model"] === "string") file.gemini = { model: g["model"] };
  }

  const clone = obj["clone"];
  if (typeof clone === "object" && clone !== null && !Array.isArray(clone)) {
    const c = clone as Record<string, unknown>;
    const cloneConfig: ConfigFile["clone"] = {};
    if (typeof c["cachePath"] === "string") cloneConfig.cachePath = c["cachePath"];
    if (typeof c["timeoutSeconds"] === "number") cloneConfig.timeoutSeconds = c["timeoutSeconds"];
    if (typeof c["maxSizeMB"] === "number") cloneConfig.maxSizeMB = c["maxSizeMB"];
    file.clone = cloneConfig;
  }

  return file;
}

/**
 * Load plugin configuration.
 *
 * Reads `~/.config/opencode/web-access.json` (optional), then applies
 * env var overrides and defaults. Call once at plugin init.
 */
export function loadConfig(): WebAccessConfig {
  const file = readConfigFile();

  const config: WebAccessConfig = {
    provider: file.provider ?? "auto",
    gemini: {
      model: file.gemini?.model ?? "gemini-2.5-flash",
    },
    clone: {
      cachePath:
        file.clone?.cachePath ??
        join(homedir(), ".cache", "opencode", "repos"),
      timeoutSeconds: file.clone?.timeoutSeconds ?? 60,
      maxSizeMB: file.clone?.maxSizeMB ?? 350,
    },
  };

  // Env vars override file values. Empty env vars (EXA_API_KEY="") are
  // treated as unset — the file value wins. This is intentional.
  const exaApiKey = process.env["EXA_API_KEY"] ?? file.exaApiKey;
  if (exaApiKey) config.exaApiKey = exaApiKey;

  const tinyFishApiKey =
    process.env["TINYFISH_API_KEY"] ?? file.tinyFishApiKey;
  if (tinyFishApiKey) config.tinyFishApiKey = tinyFishApiKey;

  const geminiApiKey = process.env["GEMINI_API_KEY"] ?? file.geminiApiKey;
  if (geminiApiKey) config.geminiApiKey = geminiApiKey;

  return config;
}
