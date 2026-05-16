export interface SearchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ExaSearchOptions extends SearchOptions {
  numResults?: number;
  includeContent?: boolean;
}

export interface ProviderCapabilities {
  /** Supports fetching full page content in search results */
  includeContent: boolean;
  /** Supports limiting number of results */
  numResults: boolean;
}

export interface SearchProvider {
  name: string;
  capabilities: ProviderCapabilities;
  search(query: string, options: ExaSearchOptions): Promise<SearchResult>;
}

export interface SearchResult {
  answer: string;
  sources: Array<{
    title: string;
    url: string;
    snippet?: string;
  }>;
  provider: string;
}
