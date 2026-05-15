import { tool } from "@opencode-ai/plugin/tool";
import type { ToolDefinition } from "@opencode-ai/plugin/tool";

import type { WebAccessConfig } from "../config.ts";
import { createExaProvider } from "../providers/exa";
import { createGeminiProvider } from "../providers/gemini";
import { createTinyFishProvider } from "../providers/tinyfish";
import type { SearchProvider, SearchResult } from "../providers/types.ts";

const z = tool.schema;

/** URL patterns that indicate a cloneable git repository. */
function isCloneableUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes("github.com") || host.includes("gitlab.");
  } catch {
    return false;
  }
}

/** Flag cloneable sources in search results. Mutates in place. */
function flagCloneableSources(result: SearchResult): void {
  for (const source of result.sources) {
    if (isCloneableUrl(source.url)) {
      source.cloneable = true;
    }
  }
}

/**
 * Format a SearchResult as a readable string for the LLM.
 *
 * The Gemini provider already embeds a Sources block in `answer` with inline
 * citations. To avoid duplicating it, we only append our own Sources block
 * (with cloneable tags) when the provider didn't already include one.
 */
function formatResultForLLM(result: SearchResult): string {
  const header = `## Search Results (via ${result.provider})`;
  const body = result.answer;

  if (result.sources.length === 0) return `${header}\n\n${body}`;

  // Gemini's answer already contains a "Sources:" section with inline
  // citation markers. Appending a second one would duplicate it.
  // Only add our own Sources block when the answer doesn't have one.
  const hasSourcesBlock = body.includes("\nSources:\n");

  if (hasSourcesBlock) {
    // Still want cloneable tags — append them as a supplement.
    const cloneableSources = result.sources.filter((s) => s.cloneable);
    const cloneableSection =
      cloneableSources.length > 0
        ? `\n\nCloneable repositories:\n${cloneableSources.map((s) => `- ${s.url}`).join("\n")}`
        : "";

    return `${header}\n\n${body}${cloneableSection}`;
  }

  const sourcesList = result.sources
    .map((s, i) => {
      const tag = s.cloneable ? " [cloneable]" : "";
      return `[${i + 1}] ${s.title} (${s.url})${tag}`;
    })
    .join("\n");

  return `${header}\n\n${body}\n\nSources:\n${sourcesList}`;
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

            const result = await provider.search(args.query, {
              ...(args.numResults != null ? { numResults: args.numResults } : {}),
              ...(args.includeContent != null ? { includeContent: args.includeContent } : {}),
              signal: context.abort,
            });

            flagCloneableSources(result);

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
