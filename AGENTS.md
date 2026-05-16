# AGENTS.md -- opencode-scout

## What This Is

An OpenCode plugin that gives agents access to the outside world — web search via Exa, TinyFish, or Gemini, and git clone for pulling external repositories into the workspace.

## Architecture

Two tools (`web_search`, `clone_repo`) backed by a provider abstraction for search and a set of git utilities for cloning. Config loads from three sources with clear precedence: env vars > opencode.jsonc options > `~/.config/opencode/web-access.json` file > defaults.

Entry point: `src/index.ts` exports `ScoutPlugin`.

## Source Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | ~65 | Plugin entry, provider status string, system prompt injection |
| `src/config.ts` | ~135 | Config loading with three-source precedence, defensive validation |
| `src/providers/types.ts` | ~32 | SearchProvider, SearchResult, ProviderCapabilities, ExaSearchOptions interfaces |
| `src/providers/exa.ts` | ~111 | Exa provider — POST API, formatAnswer, includeContent/numResults support |
| `src/providers/gemini.ts` | ~270 | Gemini provider — grounded search, citation insertion (UTF-8 byte offsets), redirect URL resolution |
| `src/providers/tinyfish.ts` | ~107 | TinyFish provider — GET API, free search, snippets only |
| `src/tools/web-search.ts` | ~204 | web_search tool — provider selection, fallback chain, LLM output formatting |
| `src/tools/clone-repo.ts` | ~261 | clone_repo tool — response assembly, tree generation, README finding, file reading |
| `src/git/url-normalizer.ts` | ~291 | URL normalization — SSH, HTTPS, Sourcegraph paths, GitHub/GitLab, scheme allowlist |
| `src/git/clone.ts` | ~125 | Cache management, git clone invocation, error formatting |
| `src/git/subprocess.ts` | ~90 | General-purpose spawn wrapper with timeout, abort signal, 10 MB buffer cap |
| `src/git/path-safety.ts` | ~33 | Path containment checks — string-level (resolve) and filesystem-level (symlink) |

## Plugin Hooks

| Hook | Purpose |
|------|---------|
| `experimental.chat.system.transform` | Inject one-line provider status into system prompt |

### Custom Tools

| Tool | Purpose |
|------|---------|
| `web_search` | Search via Exa/TinyFish/Gemini with auto-fallback chain |
| `clone_repo` | Clone repos to local cache, return tree/README/file content |

## Conventions

- **Pure JS only** — no native dependencies. Runtime dep is `@opencode-ai/plugin` only. Uses Node.js built-ins (`fs`, `path`, `os`, `crypto`, `child_process`).
- **Source ships as `.ts`** — Bun transpiles natively. No build step.
- **Config precedence:** env vars > opencode.jsonc plugin options > `~/.config/opencode/web-access.json` > defaults. API keys should be in env vars (not committed to git).
- **Provider capabilities are declarative** — `SearchProvider.capabilities` declares what each provider supports. The tool layer checks capabilities before passing options.
- **Formatting responsibility:** Providers return structured `SearchResult` (answer + sources). The tool layer (`formatResultForLLM`) owns all output formatting including Sources blocks and `[cloneable]` tags.
- **Shallow clones** — `--depth 1 --single-branch` to minimize disk and time.
- **Cache by URL hash** — repos cached at `~/.cache/opencode/repos/<sha256-prefix>`.
- **Security:** URL scheme allowlist (blocks `ext::`, `file://`, `git://`), symlink escape guards, branch name injection guards, API keys in headers not query strings, subprocess buffer cap (10 MB), Gemini model name sanitized.

## Testing

```
bun test
```

110 tests across 4 files covering URL normalization (38 tests, 9 security cases), path safety (15 tests with symlink fixtures), config validation and precedence (32 tests), and output formatting (13 tests).

## Git Conventions

- **Always confirm with the user before pushing to remote.** No autonomous pushes.
- **Squash related commits before pushing** when possible.
- **CI:** `tsc --noEmit` + `bun test` on every push to main and on PRs. Auto-publish to npm on version tags (`v*`).
- **Dependabot:** Patch/minor PRs can be merged if CI passes. Major version bumps should be tested locally first.

See `~/.config/opencode/context/opencode-plugins.md` for SDK reference and cross-plugin conventions.
