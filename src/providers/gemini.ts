import type { SearchOptions, SearchProvider, SearchResult } from "./types.ts";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ---------------------------------------------------------------------------
// Gemini API response types
// ---------------------------------------------------------------------------

interface GeminiSearchResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      groundingSupports?: Array<{
        segment?: {
          startIndex?: number;
          endIndex?: number;
          text?: string;
        };
        groundingChunkIndices?: number[];
      }>;
    };
  }>;
  error?: { code?: number; message?: string; status?: string };
}

interface ResolvedSource {
  title: string;
  url: string;
}

interface CitationInsertion {
  /** UTF-8 byte offset where the marker is inserted. */
  index: number;
  /** e.g. "[1][3]" */
  marker: string;
}

// ---------------------------------------------------------------------------
// Citation helpers
// ---------------------------------------------------------------------------

/**
 * Build a list of citation markers to splice into the answer text.
 *
 * Each `groundingSupport` maps a text segment to one or more grounding chunk
 * indices. We insert a `[1][2]` style marker at `segment.endIndex` (a UTF-8
 * byte offset). The returned list is sorted **descending** by index so we can
 * splice from back-to-front without shifting earlier offsets.
 */
function buildCitationInsertions(
  supports: NonNullable<
    NonNullable<
      NonNullable<GeminiSearchResponse["candidates"]>[number]["groundingMetadata"]
    >["groundingSupports"]
  >,
): CitationInsertion[] {
  const insertions: CitationInsertion[] = [];

  for (const support of supports) {
    const endIndex = support.segment?.endIndex;
    const chunkIndices = support.groundingChunkIndices;
    if (endIndex == null || !chunkIndices?.length) continue;

    // Chunk indices are 0-based; display as 1-based.
    const marker = chunkIndices.map((i) => `[${i + 1}]`).join("");
    insertions.push({ index: endIndex, marker });
  }

  // Descending so back-to-front insertion preserves earlier offsets.
  insertions.sort((a, b) => b.index - a.index);
  return insertions;
}

/**
 * Insert citation markers into `text` at UTF-8 byte positions.
 *
 * `endIndex` from the Gemini API is a byte offset into the UTF-8 encoded
 * answer text, **not** a JS string character index. We convert to a byte
 * array, splice markers at byte positions (back to front), then decode.
 */
function insertMarkersByUtf8Index(
  text: string,
  insertions: CitationInsertion[],
): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let bytes = encoder.encode(text);

  for (const { index, marker } of insertions) {
    const markerBytes = encoder.encode(marker);
    // Clamp to valid range — defensive against out-of-bounds offsets.
    const pos = Math.min(index, bytes.length);
    const merged = new Uint8Array(bytes.length + markerBytes.length);
    merged.set(bytes.subarray(0, pos), 0);
    merged.set(markerBytes, pos);
    merged.set(bytes.subarray(pos), pos + markerBytes.length);
    bytes = merged;
  }

  return decoder.decode(bytes);
}

// ---------------------------------------------------------------------------
// Redirect resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a Gemini grounding redirect URL to its real destination.
 *
 * Gemini's `groundingChunks[].web.uri` returns a
 * `vertexaisearch.cloud.google.com/grounding-api-redirect/…` URL that 302s
 * to the real source. We issue a HEAD with `redirect: "manual"` to read the
 * `Location` header without following the redirect.
 *
 * Falls back to the original URL if resolution fails.
 */
async function resolveRedirectUrl(
  url: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]),
    });
    return res.headers.get("location") ?? url;
  } catch {
    // Network error, timeout, etc. — fall back to the original URL.
    return url;
  }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export function createGeminiProvider(
  apiKey: string,
  model: string,
): SearchProvider {
  return {
    name: "gemini",

    // numResults is ignored — Gemini's grounding API controls its own
    // source count. The option only applies to Exa.
    async search(query: string, options: SearchOptions): Promise<SearchResult> {
      const signal = AbortSignal.any([
        AbortSignal.timeout(options.timeoutMs ?? 30_000),
        ...(options.signal ? [options.signal] : []),
      ]);

      // ----- 1. Call the Gemini API with search grounding -----

      const url = `${API_BASE}/models/${model}:generateContent`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: query }] }],
          tools: [{ google_search: {} }],
        }),
        signal,
      });

      // ----- 2. Parse response and handle errors -----

      // Read as text first — if the API returns non-JSON (e.g. a proxy
      // HTML error page), res.json() would throw an unhelpful SyntaxError.
      const rawBody = await res.text();

      let data: GeminiSearchResponse;
      try {
        data = JSON.parse(rawBody) as GeminiSearchResponse;
      } catch {
        throw new Error(
          `Gemini API returned non-JSON response (HTTP ${res.status}): ${rawBody.slice(0, 200)}`,
        );
      }

      if (data.error) {
        const err = data.error;
        if (err.code === 429) {
          throw new Error(
            `Gemini quota exceeded (${err.status ?? "RESOURCE_EXHAUSTED"}): ${err.message ?? "rate limited"}`,
          );
        }
        throw new Error(
          `Gemini API error (${err.code ?? res.status}): ${err.message ?? "unknown error"}`,
        );
      }

      if (!res.ok) {
        throw new Error(`Gemini API returned HTTP ${res.status}`);
      }

      const candidate = data.candidates?.[0];

      // ----- 3. Extract answer text (join non-thought parts) -----

      const answerText =
        candidate?.content?.parts
          ?.filter((p) => !p.thought && p.text)
          .map((p) => p.text)
          .join("") ?? "";

      const metadata = candidate?.groundingMetadata;
      const chunks = metadata?.groundingChunks ?? [];
      const supports = metadata?.groundingSupports ?? [];

      // ----- 4. Resolve redirect URLs in parallel -----
      // Use Promise.allSettled so one failed HEAD doesn't abort all
      // resolutions. Each resolveRedirectUrl already falls back to the
      // original URL on failure, but allSettled is an extra safety net.

      const settled = await Promise.allSettled(
        chunks.map(async (chunk): Promise<ResolvedSource> => {
          const rawUri = chunk.web?.uri ?? "";
          const title = chunk.web?.title ?? "";
          const resolvedUrl = rawUri
            ? await resolveRedirectUrl(rawUri, signal)
            : "";
          return { title, url: resolvedUrl };
        }),
      );

      const resolvedSources: ResolvedSource[] = settled.map((result, i) => {
        if (result.status === "fulfilled") return result.value;
        // Fallback to raw chunk data if the promise somehow rejected.
        const chunk = chunks[i];
        return { title: chunk?.web?.title ?? "", url: chunk?.web?.uri ?? "" };
      });

      // ----- 5. Insert inline citation markers -----

      let annotatedText = answerText;
      if (supports.length > 0) {
        const insertions = buildCitationInsertions(supports);
        annotatedText = insertMarkersByUtf8Index(answerText, insertions);
      }

      // ----- 6. Build Sources list -----

      if (resolvedSources.length > 0) {
        const sourcesList = resolvedSources
          .map((s, i) => `[${i + 1}] ${s.title}${s.title ? " " : ""}(${s.url})`)
          .join("\n");
        annotatedText += `\n\nSources:\n${sourcesList}`;
      }

      // ----- 7. Return SearchResult -----

      return {
        answer: annotatedText,
        sources: resolvedSources.map((s) => ({
          title: s.title,
          url: s.url,
        })),
        provider: "gemini",
      };
    },
  };
}
