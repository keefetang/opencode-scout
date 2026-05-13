export interface SearchProvider {
  name: string;
  isAvailable(): boolean;
  search(query: string, options: SearchOptions): Promise<SearchResult>;
}

export interface SearchOptions {
  numResults?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Fetch full page content from sources (Exa only). */
  includeContent?: boolean;
}

export interface SearchResult {
  answer: string;
  sources: Array<{
    title: string;
    url: string;
    snippet?: string;
    /** True if URL is a GitHub/GitLab repository. */
    cloneable?: boolean;
  }>;
  provider: string;
}
