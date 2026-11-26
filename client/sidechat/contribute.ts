import { isSidechatAgent } from "../../shared/sidechat/identity";
import { sidechatSettings } from "../../shared/sidechat/settings";
import type {
  PluginButtonRegistration,
  PluginClientContext,
  PluginText,
  PluginWorkspaceCommandContext,
} from "@getpaseo/plugin/client";
import { setHostPluginClientCapabilities } from "./external-timeline-plugins";
import {
  enqueueSidechatHandoff,
  subscribeComposerPillPreference,
} from "./handoff";
import { sidechatLabel } from "./messages";
import {
  SidechatAgentPanel,
  SidechatWorkspacePanel,
} from "./sidechat-panel";
import { preferencesRpc } from "../../shared/sidechat/contracts";

export function contributeSidechat(client: PluginClientContext) {
  type ObservedAgent = {
    id: string;
    workspaceId?: string | null;
    background?: boolean;
    archivedAt?: string | null;
    updatedAt?: string;
    labels?: Record<string, string>;
  };

  const pills = new Map<string, PluginButtonRegistration<PluginText>>();
  const knownAgents = new Map<string, ObservedAgent>();
  let pillEnabled = true;
  const hasAgentPanel = typeof client.addAgentPanel === "function";
  const hasWorkspacePanel = typeof client.addWorkspacePanel === "function";
  if (!hasWorkspacePanel && !hasAgentPanel) {
    return () => {};
  }

  let disposed = false;
  const listAgents = client.paseo?.agents?.list;
  const lifetime = typeof listAgents === "function" && typeof AbortController !== "undefined"
    ? new AbortController()
    : undefined;
  const removers: Array<(() => void) | undefined> = [];

  setHostPluginClientCapabilities({
    i18n: client.i18n,
    paseo: client.paseo,
    openScreen: (input) => client.openScreen?.(input),
    openSurface: (id) => client.openSurface?.(id),
    openSettings: (id) => client.openSettings?.(id),
    composers: (sel) => client.composers?.(sel) ?? [],
    playAudio: (src) => client.playAudio?.(src) ?? Promise.resolve(),
  });

  removers.push(client.addAgentPanel?.({
    id: "better-sidechat",
    title: sidechatLabel("panelTitle"),
    icon: "MessagesSquare",
    locations: ["explorer", "workspace"],
    Component: SidechatAgentPanel,
  }));

  removers.push(client.addWorkspacePanel?.({
    id: "workspace-sidechat",
    title: sidechatLabel("workspacePanelTitle"),
    icon: "MessagesSquare",
    locations: ["explorer", "workspace"],
    Component: SidechatWorkspacePanel,
  }));

  if (hasAgentPanel) removers.push(client.addCommandCenterItem?.({
    id: "open-sidechat",
    title: sidechatLabel("openSidechat"),
    icon: "MessagesSquare",
    keywords: [
      "btw",
      "sidechat",
      "ai",
      "claude",
      "codex",
      "copilot",
      "opencode",
      "kimi",
      "side",
      "chat",
      "ask",
      "侧边",
      "聊天",
      "提问",
    ],
    context: "agent",
    onSelect: ({ openPanel }) => {
      openPanel("better-sidechat", { location: "explorer" });
    },
  }));

  if (hasAgentPanel) removers.push(client.addCommandCenterItem?.({
    id: "new-sidechat",
    title: sidechatLabel("newSidechat"),
    icon: "SquarePen",
    keywords: ["btw", "sidechat", "new", "claude", "新建", "侧边", "聊天"],
    context: "agent",
    onSelect: ({ openPanel, workspace, agent }) => {
      enqueueSidechatHandoff(
        { workspaceId: workspace.id, agentId: agent.id },
        { kind: "new_thread" },
      );
      openPanel("better-sidechat", { location: "explorer" });
    },
  }));

  if (hasWorkspacePanel) removers.push(client.addCommandCenterItem?.({
    id: "open-workspace-sidechat",
    title: sidechatLabel("workspacePanelTitle"),
    icon: "MessagesSquare",
    keywords: ["btw", "sidechat", "workspace", "claude", "侧边", "工作区"],
    context: "workspace",
    onSelect: ({ openPanel }) => {
      openPanel("workspace-sidechat", { location: "explorer" });
    },
  }));

  // Shared slash handler for `/btw` and `/sidechat`.
  // Registered with `context: "workspace"` so it works in BOTH active agent tabs and brand-new draft tabs!
  const handleSidechatSlash = ({
    workspace,
    composers,
    openPanel,
    args,
  }: PluginWorkspaceCommandContext & { args: string }) => {
    const promptText = args.trim();
    const focused = composers?.({ focused: true })[0] ?? null;
    let targetAgentId: string | null = null;

    if (focused?.context === "agent") {
      for (const agent of knownAgents.values()) {
        if (agent.workspaceId !== workspace.id || isSidechatAgent(agent.labels)) continue;
        if (composers({ agentId: agent.id })[0] === focused) {
          targetAgentId = agent.id;
          break;
        }
      }
    }

    if (!targetAgentId) {
      let latest: ObservedAgent | null = null;
      for (const agent of knownAgents.values()) {
        const isForeground =
          agent.workspaceId === workspace.id &&
          !agent.background &&
          !agent.archivedAt &&
          !isSidechatAgent(agent.labels);
        if (!isForeground) continue;
        if (!latest || (agent.updatedAt ?? "") > (latest.updatedAt ?? "")) {
          latest = agent;
        }
      }
      targetAgentId = latest?.id ?? null;
    }

    if (!hasAgentPanel) targetAgentId = null;
    if (!targetAgentId && !hasWorkspacePanel) return;

    if (promptText) {
      enqueueSidechatHandoff(
        { workspaceId: workspace.id, agentId: targetAgentId },
        { kind: "prompt", text: promptText },
      );
    }

    if (targetAgentId) {
      client.openPanel?.("better-sidechat", {
        workspaceId: workspace.id,
        agentId: targetAgentId,
        location: "explorer",
      });
    } else {
      openPanel("workspace-sidechat", { location: "explorer" });
    }
  };

  removers.push(client.addSlashCommand?.({
    name: "btw",
    description: sidechatLabel("slashDescription"),
    argumentHint: sidechatLabel("slashHint"),
    context: "workspace",
    onSubmit: handleSidechatSlash,
  }));

  removers.push(client.addSlashCommand?.({
    name: "sidechat",
    description: sidechatLabel("slashDescription"),
    argumentHint: sidechatLabel("slashHint"),
    context: "workspace",
    onSubmit: handleSidechatSlash,
  }));

  const syncAgentPill = (agent: ObservedAgent) => {
    if (disposed) return;
    const previous = knownAgents.get(agent.id);
    knownAgents.set(agent.id, agent);
    if (!hasAgentPanel || typeof client.addComposerPill !== "function") return;
    const isSidechatOrBackground =
      !pillEnabled ||
      Boolean(agent.background) ||
      Boolean(agent.archivedAt) ||
      isSidechatAgent(agent.labels);

    if (!agent.workspaceId || isSidechatOrBackground) {
      pills.get(agent.id)?.remove();
      pills.delete(agent.id);
      return;
    }

    if (pills.has(agent.id)) {
      if (previous?.workspaceId === agent.workspaceId) return;
      pills.get(agent.id)?.remove();
    }
    const { id: agentId, workspaceId } = agent;
    pills.set(
      agentId,
      client.addComposerPill({
        id: "better-sidechat",
        agentId,
        workspaceId,
        button: {
          title: sidechatLabel("openSidechat"),
          label: sidechatLabel("pillLabel"),
          icon: "MessagesSquare",
          behavior: {
            kind: "action",
            onPress: () => {
              client.openPanel?.("better-sidechat", {
                workspaceId,
                agentId,
                location: "explorer",
              });
            },
          },
        },
      }),
    );
  };

  const clearPills = () => {
    for (const pill of pills.values()) {
      pill.remove();
    }
    pills.clear();
  };

  const applyPillEnabled = (enabled: boolean) => {
    pillEnabled = enabled;
    if (!enabled) {
      clearPills();
      return;
    }
    for (const agent of knownAgents.values()) {
      syncAgentPill(agent);
    }
  };

  let sawCurrentSettings = false;
  let settingsRead = 0;
  const unsubPillPref = subscribeComposerPillPreference((enabled) => {
    sawCurrentSettings = true;
    settingsRead++;
    applyPillEnabled(enabled);
  });
  const initialPrefs = lifetime ? client.rpc?.(preferencesRpc, {}) : undefined;
  const stopSettings = client.paseo?.observeEvents?.(["status.plugin_settings_changed"]);
  const unsubscribeSettings = stopSettings?.subscribe?.({
    snapshot() {},
    update(event) {
      if (event.type !== "status") return;
      const { status, settingsId } = event.payload;
      if (status !== "plugin_settings_changed" || settingsId !== sidechatSettings.id) return;
      sawCurrentSettings = true;
      const read = ++settingsRead;
      void client.rpc(preferencesRpc, {}).then((prefs) => {
        if (!disposed && read === settingsRead) applyPillEnabled(prefs.showComposerPill);
      }).catch(() => {});
    },
  });
  if (typeof initialPrefs?.then === "function") {
    void initialPrefs.then((prefs) => {
      if (!disposed && !sawCurrentSettings) applyPillEnabled(prefs.showComposerPill);
    }).catch(() => {});
  }

  let stopAgentObservation: (() => void) | undefined;
  if (lifetime) void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal, page: { limit: 200 } })
    .then(({ entries, subscription }) => {
      if (disposed) {
        void subscription?.release().catch(() => {});
        return;
      }
      for (const { agent } of entries) syncAgentPill(agent);
      const unsubscribe = subscription?.subscribe({
        snapshot: ({ entries: refreshed }) => {
          clearPills();
          knownAgents.clear();
          for (const { agent } of refreshed) syncAgentPill(agent);
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          if (message.payload.kind === "upsert") {
            syncAgentPill(message.payload.agent);
          } else {
            knownAgents.delete(message.payload.agentId);
            pills.get(message.payload.agentId)?.remove();
            pills.delete(message.payload.agentId);
          }
        },
      });
      stopAgentObservation = () => {
        unsubscribe?.();
        void subscription?.release().catch(() => {});
      };
    })
    .catch((error) => {
      if (!disposed) console.warn("Sidechat agent observation failed:", error);
    });

  return () => {
    setHostPluginClientCapabilities(null);
    disposed = true;
    stopAgentObservation?.();
    lifetime?.abort();
    unsubscribeSettings?.();
    void stopSettings?.release?.();
    for (const remove of removers) remove?.();
    unsubPillPref();
    knownAgents.clear();
    clearPills();
  };
}
