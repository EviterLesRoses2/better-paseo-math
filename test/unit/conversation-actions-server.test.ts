import { describe, expect, it, vi } from "vitest";
import { createConversationActions, forkOrigin, resolveConversationNode, type ConversationDaemon } from "../../server/conversation-actions";
import type { PaseoAgentTimelineHandle, PaseoApi } from "../../server/paseo-types";
import type { ConversationRewindEditInput } from "../../shared/conversation-actions-rpc";

type Page = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>;
type Entry = Page["entries"][number];
const epoch = "e1";
const cursor = (seq: number) => ({ epoch, seq });
function row(seq: number, text: string, kind: "user" | "assistant" = "user", messageId: string | undefined = `m${seq}`, clientMessageId?: string): Entry {
  const item = kind === "user" ? { type: "user_message" as const, text, messageId, clientMessageId }
    : { type: "assistant_message" as const, text, messageId };
  return { provider: "codex", item, timestamp: new Date(seq * 1000).toISOString(),
    seqStart: seq, seqEnd: seq, sourceSeqRanges: [{ startSeq: seq, endSeq: seq }], collapsed: [] };
}
const entries = [row(1, "original first"), row(2, "assistant answer", "assistant"),
  row(3, "please edit this", "user", "m3", "client-3"), row(4, "future answer", "assistant")];

function page(rows: Entry[], hasOlder = false): Page {
  return { requestId: "req", agentId: "source", agent: null, direction: "tail", projection: "projected", epoch,
    reset: false, staleCursor: false, gap: false, window: { minSeq: 1, maxSeq: 4, nextSeq: 5 },
    startCursor: rows.length ? cursor(rows[0]!.seqStart) : null, endCursor: rows.length ? cursor(rows.at(-1)!.seqEnd) : null,
    hasOlder, hasNewer: false, entries: rows, error: null };
}

function fixture({ native = false, running = false, archived = false, paged = false, wantsDaemon = true, nativeContext = false } = {}) {
  const source = {
    id: "source", provider: "codex", workspaceId: "workspace", cwd: "/work", model: "gpt-test", title: "Source title",
    status: running ? "running" : "idle", currentModeId: "test-mode", thinkingOptionId: "high", options: { fast: true },
    capabilities: { supportsRewindConversation: native, supportsRewindFiles: native, supportsRewindBoth: native },
    activeTurn: null, pendingPermissions: [], archivedAt: archived ? "2026-11-26" : null,
  };
  const refetch = vi.fn(async (options: { direction: string; cursor?: { seq: number } }) =>
    paged ? options.direction === "tail" ? page(entries.slice(2), true) : page(entries.slice(0, 2)) : page(entries));
  const original = { id: "source", refresh: vi.fn(async () => ({ agent: source })), send: vi.fn(async () => {}),
    archive: vi.fn(async () => {}), timeline: { refetch } };
  const fresh = { id: "new", send: vi.fn(async () => {}), timeline: { append: vi.fn(async () => {}) } };
  const create = vi.fn(async () => fresh);
  const workspaceRef = vi.fn(() => ({ agents: { create } }));
  const paseo = { agents: { ref: vi.fn(() => original) }, workspaces: { ref: workspaceRef } } as unknown as PaseoApi;
  const daemon = { close: vi.fn(async () => {}), rewindAgent: vi.fn<NonNullable<ConversationDaemon["rewindAgent"]>>(async () => ({ ok: true })),
    buildAgentForkContext: vi.fn<NonNullable<ConversationDaemon["buildAgentForkContext"]>>(async () => ({
      attachment: nativeContext ? { type: "text", mimeType: "text/plain", contextKind: "chat_history", text: "Native history" } : null, itemCount: 2,
    })),
  };
  const connect = vi.fn(async () => wantsDaemon ? daemon : null);
  return { actions: createConversationActions(connect), paseo, original, fresh, daemon, connect, create, workspaceRef, refetch };
}

const edit: ConversationRewindEditInput = { agentId: "source", messageId: "m3", originalText: "please edit this",
  editedText: "new version", action: "resend", rewindMode: "conversation", archiveSuperseded: true };

describe("locating a conversation node", () => {
  it("prioritizes the provider ID, then the client ID, regardless of duplicate text", () => {
    expect(resolveConversationNode(entries, { nodeKind: "user", nodeText: "original first", messageId: "m3" })).toBe(2);
    expect(resolveConversationNode(entries, { nodeKind: "user", nodeText: "original first", clientMessageId: "client-3" })).toBe(2);
    expect(resolveConversationNode(entries, { nodeKind: "assistant", nodeText: "unrelated", messageId: "m3" })).toBe(-1);
  });

  it("uses text and time when assistant fragments share a provider message ID", () => {
    const duplicateIds = [row(1, "before tools", "assistant", "shared"), row(3, "after tools", "assistant", "shared")];
    expect(resolveConversationNode(duplicateIds, { nodeKind: "assistant", nodeText: "before tools", messageId: "shared" })).toBe(0);
    expect(resolveConversationNode(duplicateIds, { nodeKind: "assistant", nodeText: "unknown", messageId: "shared", timestampMs: 2500 })).toBe(1);
  });

  it("matches exact text and the nearest timestamp, and rejects an ambiguous match", () => {
    const duplicate = [row(1, "same"), row(3, "same"), row(5, "same", "assistant")];
    expect(resolveConversationNode(duplicate, { nodeKind: "user", nodeText: "same", timestampMs: 2700 })).toBe(1);
    expect(resolveConversationNode(duplicate, { nodeKind: "user", nodeText: "same", timestampMs: 300 })).toBe(0);
    expect(resolveConversationNode(duplicate, { nodeKind: "user", nodeText: "same", timestampMs: 2000 })).toBe(-1);
    expect(resolveConversationNode(duplicate, { nodeKind: "user", nodeText: "same" })).toBe(-1);
  });

  it("finds the latest prompt independently of the latest assistant reply", async () => {
    const { actions, paseo } = fixture();
    await expect(actions.latestNode(paseo, "source")).resolves.toMatchObject({ nodeKind: "assistant", messageId: "m4" });
    await expect(actions.latestNode(paseo, "source", "user")).resolves.toMatchObject({ nodeKind: "user", messageId: "m3" });
  });
});

describe("editing a conversation", () => {
  it("rewinds natively then sends the revised message to the same agent", async () => {
    const { actions, paseo, original, daemon, create } = fixture({ native: true });
    await expect(actions.capabilities(paseo, "source")).resolves.toEqual({ supportsFork: true, provider: "codex", status: "idle",
      supportsRewindConversation: true, supportsRewindFiles: true, supportsRewindBoth: true });
    await expect(actions.rewindEdit(paseo, edit)).resolves.toEqual({ ok: true, strategy: "native_rewind", targetAgentId: "source" });
    expect(daemon.rewindAgent).toHaveBeenCalledWith("source", "m3", "conversation");
    expect(original.send).toHaveBeenCalledWith("new version");
    expect(daemon.rewindAgent.mock.invocationCallOrder[0]).toBeLessThan(original.send.mock.invocationCallOrder[0]!);
    expect(create).not.toHaveBeenCalled();
    expect(daemon.close).toHaveBeenCalledOnce();
  });

  it.each(["conversation", "both"] as const)("returns the draft without sending after native %s rewind", async (rewindMode) => {
    const { actions, paseo, original, daemon } = fixture({ native: true });
    await expect(actions.rewindEdit(paseo, { ...edit, rewindMode, action: "composer", messageId: undefined, clientMessageId: "client-3" }))
      .resolves.toEqual({ ok: true, strategy: "native_rewind", targetAgentId: "source", restoredText: "new version" });
    expect(daemon.rewindAgent).toHaveBeenCalledWith("source", "m3", rewindMode);
    expect(original.send).not.toHaveBeenCalled();
  });

  it("rewinds files only and never substitutes a branch for failed file rewind", async () => {
    const { actions, paseo, original, daemon, create } = fixture({ native: true });
    const input = { ...edit, action: "files", rewindMode: "files" } as const;
    await expect(actions.rewindEdit(paseo, input)).resolves.toMatchObject({ ok: true, strategy: "native_rewind" });
    expect(daemon.rewindAgent).toHaveBeenCalledWith("source", "m3", "files");
    daemon.rewindAgent.mockRejectedValueOnce(new Error("no checkpoint"));
    await expect(actions.rewindEdit(paseo, input)).resolves.toEqual({ ok: false, strategy: "failed", error: "no checkpoint" });
    expect(original.send).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("pages backwards, builds context strictly before the target, and archives after sending", async () => {
    const { actions, paseo, original, fresh, daemon, create, workspaceRef, refetch } = fixture({ paged: true, nativeContext: true });
    await expect(actions.rewindEdit(paseo, edit)).resolves.toEqual({ ok: true, strategy: "branch_replace", targetAgentId: "new", archivedOldAgent: true });
    expect(refetch).toHaveBeenCalledWith({ direction: "before", projection: "projected", cursor: cursor(3), limit: 400 });
    expect(daemon.buildAgentForkContext).toHaveBeenCalledWith("source", { boundaryCursor: cursor(2) });
    expect(workspaceRef).toHaveBeenCalledWith("workspace");
    expect(create).toHaveBeenCalledWith({ title: "Source title", background: false,
      config: { provider: "codex/gpt-test", modeId: "test-mode", thinkingOptionId: "high", options: { fast: true } } });
    expect(fresh.send).toHaveBeenCalledWith("new version", { attachments: [expect.objectContaining({ text: "Native history", contextKind: "chat_history" })] });
    expect(fresh.timeline.append.mock.invocationCallOrder[0]).toBeLessThan(fresh.send.mock.invocationCallOrder[0]!);
    expect(fresh.send.mock.invocationCallOrder[0]).toBeLessThan(original.archive.mock.invocationCallOrder[0]!);
  });

  it("handles editing the first message with no inherited history and no archive when opted out", async () => {
    const { actions, paseo, original, fresh, daemon } = fixture();
    await expect(actions.rewindEdit(paseo, { ...edit, messageId: "m1", originalText: "original first", archiveSuperseded: false }))
      .resolves.toMatchObject({ strategy: "branch_replace", archivedOldAgent: false });
    expect(fresh.send).toHaveBeenCalledWith("new version", undefined);
    expect(daemon.buildAgentForkContext).not.toHaveBeenCalled();
    expect(fresh.timeline.append).not.toHaveBeenCalled();
    expect(original.archive).not.toHaveBeenCalled();
  });

  it("gives an idle replacement a bounded system prompt and returns the edited draft after native rejection", async () => {
    const { actions, paseo, fresh, daemon, create } = fixture({ native: true });
    daemon.rewindAgent.mockRejectedValueOnce(new Error("unsupported"));
    await expect(actions.rewindEdit(paseo, { ...edit, action: "composer" })).resolves.toMatchObject({
      strategy: "branch_replace", targetAgentId: "new", restoredText: "new version" });
    const options = (create.mock.calls as unknown as [{ config: { systemPrompt: string } }][])[0]![0];
    expect(options.config.systemPrompt).toContain("<forked_conversation_context>");
    expect(options.config.systemPrompt).toContain("assistant answer");
    expect(options.config.systemPrompt).not.toContain("please edit this");
    expect(options.config.systemPrompt).not.toContain("future answer");
    expect(fresh.send).not.toHaveBeenCalled();
  });

  it.each([{ running: true }, { archived: true }])("refuses to edit an agent in this state: %j", async (state) => {
    const { actions, paseo, connect, create } = fixture(state);
    await expect(actions.rewindEdit(paseo, edit)).resolves.toMatchObject({ ok: false });
    expect(connect).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps the source after a native error if the timeline was already replaced", async () => {
    const { actions, paseo, original, daemon, refetch, create } = fixture({ native: true });
    daemon.rewindAgent.mockRejectedValueOnce(new Error("refresh failed after rewind"));
    refetch.mockResolvedValueOnce(page(entries)).mockResolvedValueOnce({ ...page(entries), epoch: "e2" });
    await expect(actions.rewindEdit(paseo, edit)).resolves.toMatchObject({ ok: false, strategy: "failed",
      error: expect.stringContaining("rewind could not be confirmed") });
    expect(original.archive).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps the source after a replacement send fails and returns the draft", async () => {
    const { actions, paseo, fresh, original } = fixture();
    fresh.send.mockRejectedValueOnce(new Error("send failed"));
    await expect(actions.rewindEdit(paseo, edit)).resolves.toMatchObject({ ok: false, targetAgentId: "new",
      archivedOldAgent: false, restoredText: "new version", error: expect.stringContaining("send failed") });
    expect(original.archive).not.toHaveBeenCalled();
  });

  it("does not fork after a successful native rewind followed by a send failure", async () => {
    const { actions, paseo, original, create } = fixture({ native: true });
    original.send.mockRejectedValueOnce(new Error("send failed"));
    await expect(actions.rewindEdit(paseo, edit)).resolves.toMatchObject({ ok: false, strategy: "native_rewind",
      targetAgentId: "source", restoredText: "new version" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("forking a conversation", () => {
  it("makes an idle assistant fork with an inclusive context and carries over the configuration", async () => {
    const { actions, paseo, create, fresh, original, daemon } = fixture({ nativeContext: true });
    await expect(actions.fork(paseo, { agentId: "source", nodeKind: "assistant", messageId: "m2", nodeText: "assistant answer" }))
      .resolves.toEqual({ ok: true, newAgentId: "new", title: "Source title (Fork)", itemCount: 2 });
    expect(daemon.buildAgentForkContext).toHaveBeenCalledWith("source", { boundaryCursor: cursor(2), boundaryMessageId: "m2" });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: "Source title (Fork)", config: expect.objectContaining({
      systemPrompt: expect.stringContaining("Native history"), options: { fast: true }, thinkingOptionId: "high" }) }));
    expect(fresh.timeline.append).toHaveBeenCalledWith(expect.objectContaining({ kind: "omp-fork-origin", data: expect.objectContaining({
      nodeKind: "assistant", sourceAgentId: "source", nodePreview: "assistant answer", itemCount: 2 }) }));
    expect(fresh.send).not.toHaveBeenCalled();
    expect(original.archive).not.toHaveBeenCalled();
  });

  it("can fork from a user message and send a first prompt with the fallback transcript", async () => {
    const { actions, paseo, create, fresh, original } = fixture({ wantsDaemon: false });
    await expect(actions.fork(paseo, { agentId: "source", nodeKind: "user", clientMessageId: "client-3", nodeText: "please edit this",
      title: "  New title  ", initialPrompt: "Continue here" })).resolves.toMatchObject({ ok: true, newAgentId: "new", title: "New title", itemCount: 3 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ config: expect.not.objectContaining({ systemPrompt: expect.anything() }) }));
    expect(fresh.send).toHaveBeenCalledWith("Continue here", { attachments: [expect.objectContaining({ contextKind: "chat_history",
      text: "### User\n\noriginal first\n\n### Assistant\n\nassistant answer\n\n### User\n\nplease edit this" })] });
    expect(original.archive).not.toHaveBeenCalled();
  });

  it("includes carried-over history when creating a copy of an existing fork", async () => {
    const { actions, paseo, create, refetch } = fixture({ wantsDaemon: false });
    const data = forkOrigin({ id: "parent", title: "Parent" }, { nodeKind: "assistant", nodeText: "Old reply" },
      { itemCount: 2, attachment: { type: "text", mimeType: "text/plain", text: "Original history" } });
    const origin: Entry = { ...row(0, ""), item: { type: "plugin", id: "fork-origin", pluginId: "better-paseo-math",
      kind: "omp-fork-origin", version: 1, data } };
    refetch.mockResolvedValueOnce(page([origin, ...entries]));
    await expect(actions.fork(paseo, { agentId: "source", nodeKind: "user", messageId: "m1", nodeText: "original first" }))
      .resolves.toMatchObject({ ok: true, itemCount: 3 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({
      systemPrompt: expect.stringContaining("Original history\n\n### User\n\noriginal first") }) }));
  });

  it("bounds the origin JSON on multibyte text and worst-case JSON escaping", () => {
    const text = ("\u0001\u0000\\\"你好\ud83d\ude03").repeat(25_000);
    const data = forkOrigin({ id: "source", title: text }, { nodeKind: "user", nodeText: text }, {
      itemCount: 100, attachment: { type: "text", mimeType: "text/plain", text },
    });
    expect(Buffer.byteLength(JSON.stringify(data), "utf8")).toBeLessThan(56 * 1024);
    expect(data.transcriptExcerpt).toContain("Earlier conversation truncated");
    expect(data.transcriptExcerpt).not.toContain("\ufffd");
  });
});
