import type { Plugin } from "@opencode-ai/plugin";

import { loadConfig, type WebAccessConfig } from "./config";
import { createCloneRepoTool } from "./tools/clone-repo";
import { createWebSearchTool } from "./tools/web-search";

/**
 * OpenCode Scout plugin.
 *
 * Gives agents access to the outside world — web search via Exa/TinyFish/Gemini
 * and git clone for pulling repositories into the workspace.
 */
export const ScoutPlugin: Plugin = async (ctx, options) => {
  const config = loadConfig();

  const webSearchTool = createWebSearchTool(config);
  const cloneRepoTool = createCloneRepoTool(config);

  // Build provider status string once at init.
  const providerStatus = buildProviderStatus(config);

  void ctx.client.app.log({
    body: {
      service: "scout",
      level: "info",
      message: `scout loaded — web_search (${providerStatus}) | clone_repo ✓`,
    },
  });

  return {
    tool: {
      web_search: webSearchTool,
      clone_repo: cloneRepoTool,
    },
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        if (!output.system) return;
        output.system.push(
          `## Scout: web_search (${providerStatus}) | clone_repo ✓`,
        );
      } catch (err) {
        void ctx.client.app.log({
          body: {
            service: "scout",
            level: "warn",
            message: `system prompt hook: ${err instanceof Error ? err.message : String(err)}`,
          },
        });
      }
    },
  };
};

/** One-line provider availability string for system prompt and logs. */
function buildProviderStatus(config: WebAccessConfig): string {
  const exa = config.exaApiKey ? "Exa ✓" : "Exa ✗";
  const tinyfish = config.tinyFishApiKey ? "TinyFish ✓" : "TinyFish ✗";
  const gemini = config.geminiApiKey ? "Gemini ✓" : "Gemini ✗";

  if (!config.exaApiKey && !config.tinyFishApiKey && !config.geminiApiKey)
    return "no providers configured";
  return `${exa} ${tinyfish} ${gemini}`;
}

export default ScoutPlugin;
