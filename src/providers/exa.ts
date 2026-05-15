import type { SearchOptions, SearchProvider, SearchResult } from "./types.ts";

const EXA_API_URL = "https://api.exa.ai/search";

/** Exa API response shape. */
interface ExaResult {
  title?: string;
  url?: string;
  id?: string;
  text?: string;
  highlights?: string[];
  image?: string;
  favicon?: string;
}

interface ExaResponse {
  results?: ExaResult[];
  costDollars?: { total?: number };
}

/** Format raw Exa results into a markdown answer. */
function formatAnswer(results: ExaResult[]): string {
  if (results.length === 0) return "No results found.";

  return results
    .map((r) => {
      const title = r.title ?? "Untitled";
      const url = r.url ?? "";
      const heading = url ? `## [${title}](${url})` : `## ${title}`;
      const snippet = r.text?.trim();
      const highlights =
        r.highlights && r.highlights.length > 0
          ? "\n\n**Key passages:**\n" +
            r.highlights.map((h) => `- ${h}`).join("\n")
          : "";
      const body = snippet ? `\n\n${snippet}${highlights}` : highlights;
      return body ? `${heading}${body}` : heading;
    })
    .join("\n\n---\n\n");
}

/**
 * Create an Exa search provider.
 *
 * @param apiKey - Exa API key (from config or EXA_API_KEY env var)
 */
export function createExaProvider(apiKey: string): SearchProvider {
  return {
    name: "exa",

    async search(query: string, options: SearchOptions): Promise<SearchResult> {
      const includeContent = options.includeContent === true;
      const numResults = options.numResults ?? 5;

      const body = {
        query,
        numResults,
        type: "auto",
        contents: includeContent
          ? { text: { maxCharacters: 10000 }, highlights: true }
          : { text: { maxCharacters: 300 } },
      };

      const signal = AbortSignal.any([
        AbortSignal.timeout(options.timeoutMs ?? 30000),
        ...(options.signal ? [options.signal] : []),
      ]);

      const response = await fetch(EXA_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Exa API error (${response.status}): ${(text || response.statusText).slice(0, 200)}`,
        );
      }

      const data = (await response.json()) as ExaResponse;
      const results = data.results ?? [];

      return {
        answer: formatAnswer(results),
        sources: results.map((r) => {
          const snippet = r.text?.slice(0, 300);
          return {
            title: r.title ?? "Untitled",
            url: r.url ?? "",
            ...(snippet ? { snippet } : {}),
          };
        }),
        provider: "exa",
      };
    },
  };
}
