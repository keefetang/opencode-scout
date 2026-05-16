# Changelog

## [0.3.0] — 2026-05-16

### Architecture

- **Config: opencode.jsonc as primary source** — Plugin now reads options from `opencode.jsonc` (`["opencode-scout", { ... }]`) as the primary config. Precedence: env vars > opencode.jsonc options > `~/.config/opencode/web-access.json` > defaults. The JSON file is demoted to machine-wide fallback.
- **Clone tool decomposed** — Extracted `subprocess.ts` (general-purpose command runner), `path-safety.ts` (path containment checks), and `clone.ts` (cache management + git clone) from the 450-line monolith. `clone-repo.ts` now handles only tool definition and response assembly.
- **Provider capabilities** — New `ProviderCapabilities` interface on `SearchProvider`. The tool layer checks `provider.capabilities.includeContent` and `.numResults` before passing options, eliminating provider-specific conditionals.
- **Formatting responsibility clarified** — Providers return structured data only (answer + sources). The tool layer owns all output formatting including Sources blocks and cloneable tags. Eliminates the Gemini-specific `\nSources:\n` string detection.

### Bug fixes

- **`isCloneableUrl` false positive** — `host.includes("github.com")` matched `notgithub.com`. Fixed to use exact match (`host === "github.com"`) plus subdomain support (`host.endsWith(".github.com")`).

### Robustness

- **Gemini model sanitized** — Model name stripped to `[a-zA-Z0-9._-]` before URL interpolation. Prevents path traversal from malicious config.
- **Subprocess buffer cap** — `runCommand` now caps total stdout+stderr at 10 MB and kills the process if exceeded. Prevents memory exhaustion from adversarial output.
- **Binary file detection** — `readFileSafe` scans the first 8 KB for null bytes before returning content. Binary files produce a descriptive placeholder instead of garbled text.
- **Config path injectable** — `loadConfig` accepts an optional `configPath` parameter for test isolation.

### Tests

- **110 tests** across 4 files (url-normalizer, path-safety, config, formatting)
- URL normalizer: 38 tests including 9 security cases (scheme allowlist, option injection)
- Path safety: 15 tests including symlink escape detection with real filesystem fixtures
- Config: 32 tests covering validation, precedence chain, file reading, and malformed JSON
- Formatting: 13 tests for cloneable detection and LLM output formatting

### Other

- Updated `@opencode-ai/plugin` to ^1.15.0, `bun-types` to ^1.3.14, `typescript` to ^6.0.3
- Added CI workflow (typecheck + test), publish workflow (tag-triggered npm publish + GitHub Release), Dependabot
- Removed "Planned providers" section from README (Perplexity/OpenRouter not implemented)
- README rewritten to document three-source config precedence

## [0.2.0] — 2026-05-14

### Added

- TinyFish as third search provider (free, snippet-based search)
- URL scheme allowlist — blocks `ext::`, `file://`, `git://`, `ssh://` and other unsafe schemes
- Symlink escape guard in clone_repo path handling
- Gemini API key sent in header (`x-goog-api-key`) instead of query string
- Exa error responses truncated to 200 chars to prevent context bloat

## [0.1.0] — 2026-05-12

### Added

- Initial implementation
- `web_search` tool with Exa and Gemini providers, auto-fallback chain
- `clone_repo` tool with URL normalization (GitHub, GitLab, SSH, Sourcegraph paths)
- Shallow clone caching by URL hash
- System prompt injection showing provider availability
