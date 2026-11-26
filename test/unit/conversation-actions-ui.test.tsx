import React, { useState } from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./helpers/quiet-renderer";

const state = vi.hoisted(() => ({
  invoke: vi.fn(), show: vi.fn(), error: vi.fn(), setPrompt: vi.fn(), focus: vi.fn(async () => {}),
  activeComposer: { setPrompt: vi.fn(), focus: vi.fn(async () => {}) },
  agent: { id: "source", title: "Original", status: "idle" },
}));
vi.mock("react-native", () => import("./helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) => rpcFor(contract.name),
  useAgent: (_id: string, select: (agent: typeof state.agent) => unknown) => select(state.agent),
}));
vi.mock("@getpaseo/plugin/client/ui", () => {
  const host = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props);
  return { Icon: host("Icon"), Modal: Object.assign(host("AppModal"), { Content: host("ModalContent") }),
    TextInput: host("TextInput"), copyText: async () => {}, useToast: () => ({ show: state.show, error: state.error }) };
});

import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ConversationDialog, ForkConversationModal, type ConversationDialogKind } from "../../client/components/conversation-actions";
import { ForkOriginCard } from "../../client/components/fork-origin-card";
import { buildThemeTokens } from "../../client/components/theme-tokens";
import { AssistantFooter, fitOneLine } from "../../client/components/turn-footer";
import { UserMessage } from "../../client/components/user-message";
import { contributeConversationCommands } from "../../client/conversation-commands";
import { updateEnhancerPreferences } from "../../client/preferences";
import { focusAgentComposer, installComposerBridge } from "../../client/state/composer-bridge";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const rpcs = new Map<string, (input: unknown) => Promise<unknown>>();
function rpcFor(name: string) {
  let fn = rpcs.get(name);
  if (!fn) rpcs.set(name, fn = (input) => state.invoke(name, input));
  return fn;
}
const colors = { surface0: "#fff", surface1: "#eee", surface2: "#ddd", border: "#ccc", foreground: "#111",
  foregroundMuted: "#666", accent: "#00f", accentForeground: "#fff", statusSuccess: "#080", statusWarning: "#a60", statusDanger: "#d00" };
const theme = { colors };
const tokens = buildThemeTokens(colors);
const node = { nodeKind: "user", nodeText: "Original prompt", messageId: "msg", clientMessageId: "client-msg", timestampMs: 1000 } as const;
const layout = { compact: true, platform: "ios" } as const;
const forkedComposer = { setPrompt: state.setPrompt, focus: state.focus };
const composers = ({ agentId }: { agentId: string }) => agentId === "source" ? [state.activeComposer] : [forkedComposer];
let renderer: ReactTestRenderer | undefined;
let removeBridge: () => void;
const hosts = (type: string) => renderer!.root.findAllByType(type as never);
const control = (label: string) => hosts("Pressable").find((item) => item.props.accessibilityLabel === label)!;
const field = (label: string) => hosts("TextInput").find((item) => item.props.accessibilityLabel === label)!;
const press = async (item: ReactTestInstance) => { await act(async () => { item.props.onPress(); }); };
const mount = async (element: React.ReactElement) => { await act(async () => { renderer = TestRenderer.create(element); }); };
const caps = { supportsFork: true, supportsRewindConversation: false, supportsRewindFiles: false, supportsRewindBoth: false,
  provider: "test", status: "idle" };

beforeEach(() => {
  vi.resetAllMocks();
  state.focus.mockResolvedValue(undefined);
  state.agent.status = "idle";
  updateEnhancerPreferences({ language: "en" });
  removeBridge = installComposerBridge({ composers } as unknown as PluginClientContext);
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  removeBridge();
  updateEnhancerPreferences({ language: "system" });
});

function UserRow() {
  const [dialog, setDialog] = useState<ConversationDialogKind | null>(null);
  return <>
    <UserMessage text={node.nodeText} tokens={tokens} compact onEdit={() => setDialog("edit")} onFork={() => setDialog("fork")}
      actions={<>{"Host rewind"}</>} />
    {dialog ? <ConversationDialog kind={dialog} agentId="source" node={node} tokens={tokens} close={() => setDialog(null)} /> : null}
  </>;
}

describe("conversation row actions", () => {
  it("puts Edit and Fork beside Copy without duplicating the host rewind control", async () => {
    await mount(<UserRow />);
    expect(hosts("Pressable").map((item) => item.props.accessibilityLabel).filter(Boolean))
      .toEqual(["Copy prompt", "Edit & overwrite", "Fork from here"]);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("Host rewind");
    await press(control("Fork from here"));
    expect(hosts("AppModal")[0]?.props.title).toBe("Fork from here");
    expect(field("Conversation title").props.value).toBe("Original (Fork)");
    await press(control("Cancel"));
    expect(hosts("AppModal")).toHaveLength(0);
  });

  it("passes the edited text to the replacement and restores it to the target composer", async () => {
    state.invoke.mockImplementation(async (name) => name === "conversation.capabilities" ? caps :
      { ok: true, strategy: "branch_replace", targetAgentId: "copy", restoredText: "revised" });
    await mount(<UserRow />);
    await press(control("Edit & overwrite"));
    expect(state.invoke).toHaveBeenCalledWith("conversation.capabilities", { agentId: "source" });
    expect(field("Edited message").props.value).toBe("Original prompt");
    expect(control("Archive original conversation").props.accessibilityState.checked).toBe(true);
    await press(control("Archive original conversation"));
    act(() => field("Edited message").props.onChangeText("revised"));
    await press(control("Move to Composer"));
    expect(state.invoke).toHaveBeenCalledWith("conversation.rewind_edit", { agentId: "source", messageId: "msg", clientMessageId: "client-msg",
      timestampMs: 1000, originalText: "Original prompt", editedText: "revised", action: "composer",
      rewindMode: "conversation", archiveSuperseded: false });
    expect(state.setPrompt).toHaveBeenCalledWith("revised");
    expect(state.setPrompt.mock.invocationCallOrder[0]).toBeLessThan(state.focus.mock.invocationCallOrder[0]!);
    expect(hosts("AppModal")).toHaveLength(0);
  });

  it("exposes native file modes and keeps an unsuccessful operation open for correction", async () => {
    state.invoke.mockImplementation(async (name) => name === "conversation.capabilities" ? { ...caps,
      supportsRewindConversation: true, supportsRewindBoth: true, supportsRewindFiles: true } :
      { ok: false, strategy: "failed", error: "Checkpoint missing" });
    await mount(<UserRow />);
    await press(control("Edit & overwrite"));
    expect(control("Rewind to Composer")).toBeDefined();
    expect(control("Conversation & Files")).toBeDefined();
    await press(control("Files only"));
    expect(hosts("TextInput")).toHaveLength(0);
    await press(control("Rewind Files"));
    expect(state.invoke).toHaveBeenCalledWith("conversation.rewind_edit", expect.objectContaining({ action: "files", rewindMode: "files" }));
    expect(hosts("Text").some((item) => item.props.accessibilityRole === "alert" && item.props.children === "Checkpoint missing")).toBe(true);
    expect(hosts("AppModal")).toHaveLength(1);
    expect(state.focus).not.toHaveBeenCalled();
  });

  it("adds Fork immediately after Copy in the assistant footer and includes it in the compact width", async () => {
    const onFork = vi.fn();
    await mount(<AssistantFooter text="reply" at={new Date()} tokens={tokens} compact onFork={onFork} />);
    const labels = hosts("Pressable").map((item) => item.props.accessibilityLabel).filter(Boolean);
    const at = labels.indexOf("Fork from here");
    expect(labels[at - 1]).toBe("Copy reply");
    await press(control("Fork from here"));
    expect(onFork).toHaveBeenCalledOnce();
    expect(fitOneLine({ copy: 48, fork: 48, model: 105, duration: 40 }, 205, 6)).toEqual({ model: false, clock: false });
  });

  it("submits the selected assistant node, title, and optional first prompt and opens the copy", async () => {
    const close = vi.fn();
    state.invoke.mockResolvedValue({ ok: true, newAgentId: "copy" });
    await mount(<ForkConversationModal agentId="source" node={{ ...node, nodeKind: "assistant" }} tokens={tokens} close={close} />);
    expect(control("Create Copy")).toBeDefined();
    act(() => {
      field("Conversation title").props.onChangeText("  My copy  ");
      field("Optional: first message to send right away").props.onChangeText("Continue here");
    });
    await press(control("Fork & Send"));
    expect(state.invoke).toHaveBeenCalledWith("conversation.fork", { ...node, nodeKind: "assistant", agentId: "source",
      title: "My copy", initialPrompt: "Continue here" });
    expect(close).toHaveBeenCalledOnce();
    expect(state.focus).toHaveBeenCalledOnce();
    expect(state.show).toHaveBeenCalledWith("Conversation copy created", { variant: "success" });
    expect(state.setPrompt).not.toHaveBeenCalled();
  });

  it("expands and collapses the read-only carried-over history", async () => {
    await mount(<ForkOriginCard agentId="copy" theme={theme} host={{ id: "host", label: "Local" }} layout={layout} timestamp={new Date()}
      item={{ type: "plugin", kind: "omp-fork-origin", version: 1, data: { sourceAgentId: "source", sourceTitle: "Original",
        nodeKind: "user", nodePreview: "Prompt", itemCount: 2, summaryLines: [], transcriptExcerpt: "Full carried-over preview" } }} />);
    const title = "Forked from Original \u00b7 2 messages";
    expect(control(title).props.accessibilityState.expanded).toBe(false);
    await press(control(title));
    expect(control(title).props.accessibilityState.expanded).toBe(true);
    expect(hosts("Text").some((item) => item.props.selectable && item.props.children === "Full carried-over preview")).toBe(true);
    await press(control(title));
    expect(hosts("Text").some((item) => item.props.children === "Full carried-over preview")).toBe(false);
  });
});

describe("composer and commands", () => {
  it("waits for a newly created composer and does not clear an existing draft for a fork", async () => {
    vi.useFakeTimers();
    try {
      const discover = vi.fn().mockReturnValueOnce([]).mockReturnValueOnce([]).mockReturnValue([forkedComposer]);
      const focus = focusAgentComposer("copy", undefined, discover);
      await vi.advanceTimersByTimeAsync(150);
      await focus;
      expect(discover).toHaveBeenCalledTimes(3);
      expect(state.focus).toHaveBeenCalledOnce();
      expect(state.setPrompt).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("opens the last prompted message from Command Center and forks from the latest node with /fork", async () => {
    const client = { composers, addComposerItem: vi.fn(() => () => {}), addCommandCenterItem: vi.fn(() => () => {}), addSlashCommand: vi.fn(() => () => {}) };
    const cleanup = contributeConversationCommands(client as unknown as PluginClientContext);
    const remove = () => act(cleanup);
    try {
      const items = client.addCommandCenterItem.mock.calls as unknown as [Parameters<PluginClientContext["addCommandCenterItem"]>[0]][];
      const contribution = (client.addComposerItem.mock.calls as unknown as [Parameters<PluginClientContext["addComposerItem"]>[0]][])[0]![0];
      const commands = client.addSlashCommand.mock.calls as unknown as [Parameters<PluginClientContext["addSlashCommand"]>[0]][];
      const context = { agent: state.agent, composers, rpc: (contract: { name: string }, input: unknown) => state.invoke(contract.name, input) };
      state.invoke.mockImplementation(async (name, input) => {
        if (name === "conversation.capabilities") return caps;
        if (name === "conversation.fork") return { ok: true, newAgentId: "copy" };
        return { node: input.nodeKind === "user" ? node : { ...node, nodeKind: "assistant", messageId: "latest" } };
      });
      await mount(<contribution.Component theme={theme} host={{ id: "host", label: "Local" }} layout={layout} />);
      await act(async () => { await items[1]![0].onSelect(context as never); });
      expect(hosts("AppModal").map((item) => item.props.title)).toEqual(["Edit & overwrite"]);
      expect(field("Edited message").props.value).toBe(node.nodeText);
      await press(control("Cancel"));
      expect(commands[0]![0].name).toBe("fork");
      await commands[0]![0].onSubmit({ ...context, args: " a new prompt " } as never);
      expect(state.invoke).toHaveBeenCalledWith("conversation.fork", expect.objectContaining({ nodeKind: "assistant", messageId: "latest", initialPrompt: "a new prompt" }));
      expect(state.focus).toHaveBeenCalledOnce();
    } finally { remove(); }
  });
});
