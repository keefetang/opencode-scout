import { tool } from "@opencode-ai/plugin/tool";
import type { ToolDefinition } from "@opencode-ai/plugin/tool";

import type { WebAccessConfig } from "../config.ts";
import { createExaProvider } from "../providers/exa.ts";
import { createGeminiProvider } from "../providers/gemini.ts";
import { createTinyFishProvider } from "../providers/tinyfish.ts";
import type {
  ExaSearchOptions,
  SearchProvider,
  SearchResult,
} from "../providers/types.ts";

const z = tool.schema;

/** @internal Exported for testing. */
export function isCloneableUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "github.com" || host.endsWith(".github.com") || host.includes("gitlab.");
  } catch {
    return false;
  }
}

/**
 * Format a SearchResult as a readable string for the LLM.
 *
 * Always appends a Sources block with cloneable tags. The provider layer
 * returns raw answer text without sources formatting — this function owns
 * the final output shape.
 *
 * @internal Exported for testing.
 */
export function formatResultForLLM(result: SearchResult): string {
  const header = `## Search Results (via ${result.provider})`;

  if (result.sources.length === 0) return `${header}\n\n${result.answer}`;

  const sourcesList = result.sources
    .map((s, i) => {
      const tag = isCloneableUrl(s.url) ? " [cloneable]" : "";
      return `[${i + 1}] ${s.title} (${s.url})${tag}`;
    })
    .join("\n");

  const cloneableSources = result.sources.filter((s) => isCloneableUrl(s.url));
  const cloneableSection =
    cloneableSources.length > 0
      ? `\n\nCloneable repositories:\n${cloneableSources.map((s) => `- ${s.url}`).join("\n")}`
      : "";

  return `${header}\n\n${result.answer}\n\nSources:\n${sourcesList}${cloneableSection}`;
}

/** Build the set of available providers from config. Called once at init. */
function buildProviders(config: WebAccessConfig): Map<string, SearchProvider> {
  const providers = new Map<string, SearchProvider>();

  if (config.exaApiKey) {
    providers.set("exa", createExaProvider(config.exaApiKey));
  }
  if (config.tinyFishApiKey) {
    providers.set("tinyfish", createTinyFishProvider(config.tinyFishApiKey));
  }
  if (config.geminiApiKey) {
    providers.set(
      "gemini",
      createGeminiProvider(config.geminiApiKey, config.gemini.model),
    );
  }

  return providers;
}

/**
 * Create the `web_search` tool.
 *
 * Receives an already-loaded config (from `loadConfig()`). The config
 * determines which providers are available based on API key presence.
 */
export function createWebSearchTool(config: WebAccessConfig): ToolDefinition {
  // Build providers once — reused across all invocations.
  const providers = buildProviders(config);

  return tool({
    description:
      "Search the web using Exa, TinyFish, or Gemini. Returns answers with source citations. " +
      "Use `includeContent: true` with Exa to get full page content in one call. " +
      "For Gemini results, use the built-in webfetch tool on source URLs to get page content.",
    args: {
      query: z.string().describe("Search query"),
      provider: z
        .enum(["auto", "exa", "tinyfish", "gemini"])
        .optional()
        .describe(
          "Search provider. Omit to use the configured default (auto tries Exa → TinyFish → Gemini).",
        ),
      numResults: z
        .number()
        .optional()
        .describe("Max results (default: 5, Exa only)"),
      includeContent: z
        .boolean()
        .optional()
        .describe(
          "Fetch full page content from sources (Exa only). For Gemini results, use webfetch on source URLs.",
        ),
    },
    async execute(args, context): Promise<string> {
      context.metadata({ title: "Searching..." });

      try {
        const requestedProvider = args.provider ?? config.provider;

        // --- Select providers for this request ---

        const chain: SearchProvider[] = [];

        if (requestedProvider === "auto") {
          // Fallback chain: Exa → TinyFish → Gemini (skip unavailable).
          const exa = providers.get("exa");
          if (exa) chain.push(exa);
          const tinyfish = providers.get("tinyfish");
          if (tinyfish) chain.push(tinyfish);
          const gemini = providers.get("gemini");
          if (gemini) chain.push(gemini);
        } else {
          // Specific provider requested.
          const provider = providers.get(requestedProvider);
          if (provider) {
            chain.push(provider);
          } else {
            const envVars: Record<string, string> = {
              exa: "EXA_API_KEY",
              tinyfish: "TINYFISH_API_KEY",
              gemini: "GEMINI_API_KEY",
            };
            const configKeys: Record<string, string> = {
              exa: "exaApiKey",
              tinyfish: "tinyFishApiKey",
              gemini: "geminiApiKey",
            };
            return (
              `Error: ${requestedProvider} provider requested but no API key configured. ` +
              `Set ${envVars[requestedProvider] ?? requestedProvider.toUpperCase() + "_API_KEY"} env var ` +
              `or add ${configKeys[requestedProvider] ?? requestedProvider + "ApiKey"} to ~/.config/opencode/web-access.json`
            );
          }
        }

        if (chain.length === 0) {
          return (
            "Error: No search providers available. Configure at least one API key:\n" +
            "- EXA_API_KEY (env var) or exaApiKey (in ~/.config/opencode/web-access.json)\n" +
            "- TINYFISH_API_KEY (env var) or tinyFishApiKey (in ~/.config/opencode/web-access.json)\n" +
            "- GEMINI_API_KEY (env var) or geminiApiKey (in ~/.config/opencode/web-access.json)"
          );
        }

        // --- Try each provider in order ---

        const errors: string[] = [];

        for (const provider of chain) {
          try {
            context.metadata({
              title: `Searching via ${provider.name}...`,
            });

            // Build options based on provider capabilities.
            // All providers accept ExaSearchOptions (extends SearchOptions) —
            // non-Exa providers simply ignore the extra fields.
            const searchOpts: ExaSearchOptions = {
              signal: context.abort,
              ...(provider.capabilities.numResults && args.numResults != null
                ? { numResults: args.numResults }
                : {}),
              ...(provider.capabilities.includeContent && args.includeContent != null
                ? { includeContent: args.includeContent }
                : {}),
            };

            const result = await provider.search(args.query, searchOpts);

            return formatResultForLLM(result);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : String(err);
            errors.push(`${provider.name}: ${msg}`);
          }
        }

        // All providers failed.
        const tried = chain.map((p) => p.name).join(", ");
        const details = errors.join("\n  ");
        return `Error: All search providers failed (tried: ${tried}).\n  ${details}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `Error: Unexpected failure in web_search: ${msg}`;
      }
    },
  });
}
