import type { PluginClientContext } from "@getpaseo/plugin/client";

type Composers = PluginClientContext["composers"];
let resolveComposers: Composers | undefined;

export function installComposerBridge(client: PluginClientContext) {
  const resolve = client.composers?.bind(client);
  resolveComposers = resolve;
  return () => {
    if (resolveComposers === resolve) resolveComposers = undefined;
  };
}

export async function focusAgentComposer(agentId: string, draft?: string, resolve = resolveComposers) {
  if (!resolve) throw new Error("This Paseo client cannot open the conversation's composer.");
  const deadline = Date.now() + 3_000;
  for (let delay = 50; ; delay = Math.min(delay * 2, 500)) {
    const [composer] = resolve({ agentId });
    if (composer) {
      if (draft !== undefined) composer.setPrompt(draft);
      await composer.focus();
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("The conversation's composer did not become available.");
    await new Promise<void>((done) => setTimeout(done, Math.min(remaining, delay)));
  }
}
