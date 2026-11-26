import React, { useId, useMemo, useSyncExternalStore } from "react";
import type { PluginAgentCommandContext, PluginClientContext, PluginHostProps } from "@getpaseo/plugin/client";
import { conversationForkRpc, conversationLatestNodeRpc, type ConversationNode } from "../shared/conversation-actions-rpc";
import { ConversationDialog, type ConversationDialogKind } from "./components/conversation-actions";
import { useThemeTokens } from "./components/theme-tokens";
import { conversationStrings } from "./i18n/conversation-strings";
import { resolveLanguage } from "./i18n/settings-strings";
import { getEnhancerPreferences, useEnhancerPreferences } from "./preferences";
import { focusAgentComposer } from "./state/composer-bridge";

type DialogRequest = {
  kind: ConversationDialogKind;
  agentId: string;
  node: ConversationNode;
};

export function contributeConversationCommands(client: PluginClientContext) {
  if (!client.composers || !client.addComposerItem) return () => {};
  const surfaces = new Map<string, () => void>();
  let request: DialogRequest | null = null;
  let active = true;
  const setRequest = (next: DialogRequest | null) => {
    request = next;
    for (const notify of surfaces.values()) notify();
  };
  // Paseo can mount multiple composer items in split panes. Its composer
  // lookups return independent snapshots, so let one surface host the modal.
  function CommandDialog({ theme, layout }: PluginHostProps) {
    const id = useId();
    const [subscribe, getSnapshot] = useMemo(() => [
      (notify: () => void) => {
        surfaces.set(id, notify);
        return () => {
          const wasFirst = surfaces.keys().next().value === id;
          surfaces.delete(id);
          if (wasFirst) surfaces.values().next().value?.();
        };
      },
      () => surfaces.keys().next().value === id ? request : null,
    ] as const, [id]);
    const selected = useSyncExternalStore(subscribe, getSnapshot);
    return selected ? <OpenCommandDialog request={selected} theme={theme} layout={layout}
      close={() => { if (request === selected) setRequest(null); }} /> : null;
  }

  const words = conversationStrings[resolveLanguage(getEnhancerPreferences().language)];
  async function select(context: PluginAgentCommandContext, kind: ConversationDialogKind) {
    const agentId = context.agent.id;
    const { node } = await context.rpc(conversationLatestNodeRpc, { agentId, nodeKind: kind === "edit" ? "user" : undefined });
    if (!node) throw new Error(words.missing);
    if (active) setRequest({ kind, agentId, node });
  }

  const removeDialog = client.addComposerItem({ id: "omp-conversation-dialog", Component: CommandDialog });
  const removeFork = client.addCommandCenterItem({
    id: "omp-fork-conversation", context: "agent", icon: "GitBranch", title: words.commandFork,
    onSelect: (context) => select(context, "fork"),
  });
  const removeEdit = client.addCommandCenterItem({
    id: "omp-edit-last-message", context: "agent", icon: "Pencil", title: words.commandEdit,
    onSelect: (context) => select(context, "edit"),
  });
  const removeSlash = client.addSlashCommand({
    name: "fork", context: "agent", description: words.commandFork, argumentHint: words.slashHint,
    async onSubmit(context) {
      const agentId = context.agent.id;
      const { node } = await context.rpc(conversationLatestNodeRpc, { agentId });
      if (!node) throw new Error(words.missing);
      const initialPrompt = context.args.trim() || undefined;
      const result = await context.rpc(conversationForkRpc, { ...node, agentId, initialPrompt });
      if (result.newAgentId) await focusAgentComposer(result.newAgentId, result.ok ? undefined : initialPrompt, context.composers.bind(context));
      if (result.error || !result.ok) throw new Error(result.error ?? words.loadingFailed);
    },
  });
  return () => {
    active = false;
    setRequest(null);
    removeSlash();
    removeEdit();
    removeFork();
    removeDialog();
  };
}

function OpenCommandDialog({ request, theme, layout, close }: {
  request: DialogRequest; theme: PluginHostProps["theme"]; layout: PluginHostProps["layout"]; close(): void;
}) {
  const tokens = useThemeTokens(theme, useEnhancerPreferences(), layout.platform);
  return <ConversationDialog kind={request.kind} agentId={request.agentId} node={request.node} tokens={tokens} close={close} />;
}
