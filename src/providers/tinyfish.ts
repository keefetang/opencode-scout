import type { SearchOptions, SearchProvider, SearchResult } from "./types.ts";

const TINYFISH_API_URL = "https://api.search.tinyfish.ai";

/** TinyFish API response shape. */
interface TinyFishResult {
  position?: number;
  site_name?: string;
  snippet?: string;
  title?: string;
  url?: string;
}

interface TinyFishResponse {
  query?: string;
  results?: TinyFishResult[];
  total_results?: number;
  page?: number;
}

interface TinyFishErrorResponse {
  error?: { code?: string; message?: string };
}

/** Format raw TinyFish results into a markdown answer. */
function formatAnswer(results: TinyFishResult[]): string {
  if (results.length === 0) return "No results found.";

  return results
    .map((r) => {
      const title = r.title ?? "Untitled";
      const url = r.url ?? "";
      const heading = url ? `## [${title}](${url})` : `## ${title}`;
      const snippet = r.snippet?.trim();
      const body = snippet ? `\n\n${snippet}` : "";
      return body ? `${heading}${body}` : heading;
    })
    .join("\n\n---\n\n");
}

/**
 * Create a TinyFish search provider.
 *
 * @param apiKey - TinyFish API key (from config or TINYFISH_API_KEY env var)
 */
export function createTinyFishProvider(apiKey: string): SearchProvider {
  return {
    name: "tinyfish",

    async search(query: string, options: SearchOptions): Promise<SearchResult> {
      const params = new URLSearchParams({ query });

      const signal = AbortSignal.any([
        AbortSignal.timeout(options.timeoutMs ?? 30000),
        ...(options.signal ? [options.signal] : []),
      ]);

      const response = await fetch(`${TINYFISH_API_URL}?${params.toString()}`, {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
        },
        signal,
      });

      // Read as text first — if the API returns non-JSON (e.g. a proxy
      // HTML error page), response.json() would throw an unhelpful SyntaxError.
      const rawBody = await response.text();

      let data: TinyFishResponse & TinyFishErrorResponse;
      try {
        data = JSON.parse(rawBody) as TinyFishResponse & TinyFishErrorResponse;
      } catch {
        throw new Error(
          `TinyFish API returned non-JSON response (HTTP ${response.status}): ${rawBody.slice(0, 200)}`,
        );
      }

      // Check for API error in response body before checking HTTP status.
      // TinyFish may return error details in the JSON body even on non-2xx.
      if (data.error) {
        throw new Error(
          `TinyFish API error (${data.error.code ?? "UNKNOWN"}): ${data.error.message ?? "unknown error"}`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `TinyFish API error (${response.status}): ${response.statusText}`,
        );
      }

      const results = data.results ?? [];

      return {
        answer: formatAnswer(results),
        sources: results.map((r) => ({
          title: r.title ?? "Untitled",
          url: r.url ?? "",
          ...(r.snippet ? { snippet: r.snippet } : {}),
        })),
        provider: "tinyfish",
      };
    },
  };
}
