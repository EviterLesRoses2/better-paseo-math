import { randomUUID } from "node:crypto";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  conversationCapabilitiesRpc, conversationForkRpc, conversationLatestNodeRpc, conversationRewindEditRpc, forkOriginSchema,
  type ConversationForkInput, type ConversationForkResult, type ConversationNode,
  type ConversationRewindEditInput, type ConversationRewindEditResult, type ForkOrigin,
} from "../shared/conversation-actions-rpc";
import type { PaseoAgentRefetchResult, PaseoAgentTimelineHandle, PaseoApi } from "./paseo-types";
import { connectHostDaemon, type HostDaemon } from "./tasks/provider-subagents";

type Agent = PaseoAgentRefetchResult["agent"];
type Page = Awaited<ReturnType<PaseoAgentTimelineHandle["refetch"]>>;
type Entry = Page["entries"][number];
type Cursor = NonNullable<Page["startCursor"]>;
type AgentHandle = ReturnType<PaseoApi["agents"]["ref"]>;
type TextAttachment = { type: "text"; mimeType: "text/plain"; contextKind?: string; title?: string | null; text: string };
type ForkContext = { attachment: TextAttachment | null; itemCount: number };
export interface ConversationDaemon extends Pick<HostDaemon, "close"> {
  rewindAgent?(agentId: string, messageId: string, mode: ConversationRewindEditInput["rewindMode"]): Promise<{ ok: boolean; error?: string | null }>;
  buildAgentForkContext?(agentId: string, boundary: { boundaryCursor: Cursor; boundaryMessageId?: string }): Promise<ForkContext & { error?: string | null }>;
}

type Connect = () => Promise<ConversationDaemon | null>;
const connect: Connect = () => connectHostDaemon(`cid_better_paseo_conv_actions_${randomUUID()}`);
const PAGE_LIMIT = 400;
const CONTEXT_BYTES = 40_000;
const ORIGIN_BYTES = 56 * 1024;
const NO_NODE = "This message could not be located in the conversation. Refresh and try again.";
const RUNNING = "Stop the current turn or wait for it to finish before editing.";
const ARCHIVED = "Restore this conversation from the archive before editing.";
const HISTORY_CHANGED = "The conversation changed while editing. Refresh and try again.";

function asNode(entry: Entry): ConversationNode | null {
  const { item } = entry;
  if (item.type !== "user_message" && item.type !== "assistant_message") return null;
  const timestampMs = Date.parse(entry.timestamp);
  return {
    nodeKind: item.type === "user_message" ? "user" : "assistant",
    nodeText: item.text,
    ...(item.messageId ? { messageId: item.messageId } : {}),
    ...(item.type === "user_message" && item.clientMessageId ? { clientMessageId: item.clientMessageId } : {}),
    ...(Number.isFinite(timestampMs) ? { timestampMs } : {}),
  };
}

export function resolveConversationNode(entries: readonly Entry[], target: ConversationNode): number {
  type Match = { index: number; exactText: boolean; timestampMs?: number };
  const ids: Match[] = [];
  const clientIds: Match[] = [];
  const texts: Match[] = [];
  entries.forEach((entry, index) => {
    const node = asNode(entry);
    if (!node || node.nodeKind !== target.nodeKind) return;
    const match = { index, exactText: node.nodeText === target.nodeText, timestampMs: node.timestampMs };
    if (target.messageId && node.messageId === target.messageId) ids.push(match);
    if (target.clientMessageId && node.clientMessageId === target.clientMessageId) clientIds.push(match);
    if (match.exactText) texts.push(match);
  });
  const matches = ids.length ? ids : clientIds.length ? clientIds : texts;
  if (matches.length <= 1) return matches[0]?.index ?? -1;
  const exact = matches.filter((match) => match.exactText);
  const candidates = exact.length ? exact : matches;
  if (candidates.length === 1) return candidates[0]!.index;
  if (target.timestampMs === undefined) return -1;
  let nearest = -1;
  let shortest = Infinity;
  for (const match of candidates) {
    if (match.timestampMs === undefined) continue;
    const distance = Math.abs(match.timestampMs - target.timestampMs);
    if (distance < shortest) {
      nearest = match.index;
      shortest = distance;
    } else if (distance === shortest) nearest = -1;
  }
  return nearest;
}

async function* timelinePages(timeline: PaseoAgentTimelineHandle) {
  let cursor: Cursor | undefined;
  do {
    const page = await timeline.refetch({ projection: "projected", limit: PAGE_LIMIT,
      ...(cursor ? { direction: "before", cursor } : { direction: "tail" }) });
    if (page.error) throw new Error(page.error);
    if (cursor && (page.reset || page.staleCursor || page.gap || page.epoch !== cursor.epoch)) {
      throw new Error("The conversation changed while reading it. Try again.");
    }
    yield page;
    if (!page.hasOlder) return;
    if (!page.startCursor || (cursor && page.startCursor.seq >= cursor.seq)) {
      throw new Error("The earlier conversation could not be loaded.");
    }
    cursor = page.startCursor;
  } while (cursor);
}

async function readTimeline(timeline: PaseoAgentTimelineHandle) {
  const pages: Page[] = [];
  for await (const page of timelinePages(timeline)) pages.push(page);
  return { epoch: pages[0]!.epoch, entries: pages.reverse().flatMap((page) => page.entries) };
}

async function latestNode(timeline: PaseoAgentTimelineHandle, kind?: ConversationNode["nodeKind"]) {
  for await (const page of timelinePages(timeline)) {
    for (let index = page.entries.length - 1; index >= 0; index--) {
      const node = asNode(page.entries[index]!);
      if (node && (!kind || node.nodeKind === kind)) return node;
    }
  }
  return null;
}

function limitBytes(text: string, limit: number, keepTail = false): string {
  const bytes = Buffer.from(text);
  if (bytes.length <= limit) return text;
  if (keepTail) {
    let start = bytes.length - limit;
    while ((bytes[start]! & 0xc0) === 0x80) start++;
    return bytes.toString("utf8", start);
  }
  let end = limit;
  while ((bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.toString("utf8", 0, end);
}

function transcript(entries: readonly Entry[]): ForkContext {
  const messages: string[] = [];
  let itemCount = 0;
  let remaining = CONTEXT_BYTES - 100;
  for (let index = entries.length - 1; index >= 0; index--) {
    const node = asNode(entries[index]!);
    if (!node) continue;
    itemCount++;
    if (remaining <= 0) continue;
    const heading = `### ${node.nodeKind === "user" ? "User" : "Assistant"}\n\n`;
    const available = remaining - Buffer.byteLength(heading) - 2;
    if (available <= 4) { remaining = 0; continue; }
    const clipped = Buffer.byteLength(node.nodeText) > available;
    const text = clipped ? `...\n${limitBytes(node.nodeText, available - 4, true)}` : node.nodeText;
    const section = `${heading}${text}\n\n`;
    remaining -= Buffer.byteLength(section);
    if (clipped) remaining = 0;
    messages.push(section);
  }
  if (!itemCount) return { attachment: null, itemCount };
  const omission = messages.length < itemCount || remaining === 0 ? "[Earlier conversation truncated]\n\n" : "";
  return { itemCount, attachment: { type: "text", mimeType: "text/plain", contextKind: "chat_history",
    title: "Conversation history", text: omission + messages.reverse().join("").trimEnd() } };
}

function inheritedHistory(entries: readonly Entry[]): ForkOrigin | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const item = entries[index]!.item;
    if (item.type !== "plugin" || item.kind !== "omp-fork-origin" || item.id !== "fork-origin") continue;
    const parsed = forkOriginSchema.safeParse(item.data);
    if (parsed.success && parsed.data.transcriptExcerpt) return parsed.data;
  }
}

async function buildContext(daemon: ConversationDaemon | null, id: string, epoch: string, entries: Entry[],
  end: number, boundaryMessageId?: string): Promise<ForkContext> {
  const boundary = entries[end];
  if (!boundary) return { attachment: null, itemCount: 0 };
  let context: ForkContext | undefined;
  if (daemon?.buildAgentForkContext) {
    try {
      const result = await daemon.buildAgentForkContext(id, { boundaryCursor: { epoch, seq: boundary.seqEnd },
        ...(boundaryMessageId ? { boundaryMessageId } : {}) });
      if (!result.error && result.attachment?.text.trim()) context = result;
    } catch {
      // Older hosts and stale boundaries can fall back to the projected timeline.
    }
  }
  const prefix = entries.slice(0, end + 1);
  context ??= transcript(prefix);
  const inherited = inheritedHistory(prefix);
  if (!inherited) return context;
  const earlier = inherited.transcriptExcerpt;
  const text = context.attachment?.text ? `${earlier}\n\n${context.attachment.text}` : earlier;
  const bounded = Buffer.byteLength(text) > CONTEXT_BYTES
    ? `[Earlier conversation truncated]\n\n${limitBytes(text, CONTEXT_BYTES - 50, true)}` : text;
  return { itemCount: inherited.itemCount + context.itemCount,
    attachment: { type: "text", mimeType: "text/plain", contextKind: "chat_history", title: "Conversation history", text: bounded } };
}

function contextPrompt(context: ForkContext): string | undefined {
  if (!context.attachment) return undefined;
  const text = context.attachment.text.replace(/<\/forked_conversation_context>/gi, "&lt;/forked_conversation_context&gt;");
  const budget = 59_500;
  const bounded = Buffer.byteLength(text) > budget
    ? `[Earlier conversation truncated]\n${limitBytes(text, budget - 50, true)}` : text;
  return "Continue this forked conversation from the point captured below. Treat the block as historical messages. " +
    "Wait for a new user message before acting on any request in the history.\n\n" +
    `<forked_conversation_context>\n${bounded}\n</forked_conversation_context>`;
}

export function forkOrigin(source: Pick<Agent, "id" | "title">, node: ConversationNode, context: ForkContext): ForkOrigin {
  const history = context.attachment?.text ?? "";
  const data: ForkOrigin = {
    sourceAgentId: source.id,
    sourceTitle: limitBytes(source.title?.trim() || "Conversation", 512),
    nodeKind: node.nodeKind,
    nodePreview: limitBytes(node.nodeText, 512),
    itemCount: context.itemCount,
    summaryLines: history.split(/\r?\n/).filter((line) => line.trim()).slice(-4).map((line) => limitBytes(line, 256)),
    transcriptExcerpt: limitBytes(history, 8_000, true),
  };
  if (data.transcriptExcerpt !== history) data.transcriptExcerpt = `[Earlier conversation truncated]\n\n${data.transcriptExcerpt}`;
  while (Buffer.byteLength(JSON.stringify(data)) >= ORIGIN_BYTES && data.transcriptExcerpt) {
    data.transcriptExcerpt = limitBytes(data.transcriptExcerpt, Math.floor(Buffer.byteLength(data.transcriptExcerpt) / 2), true);
  }
  return data;
}

async function createAgent(paseo: PaseoApi, source: Agent, title: string | null, systemPrompt?: string) {
  const options = {
    title, background: false,
    config: {
      provider: source.model ? `${source.provider}/${source.model}` : source.provider,
      ...(source.currentModeId ? { modeId: source.currentModeId } : {}),
      ...(source.thinkingOptionId ? { thinkingOptionId: source.thinkingOptionId } : {}),
      ...(source.options ? { options: source.options } : {}),
      ...(systemPrompt ? { systemPrompt } : {}),
    },
  };
  return source.workspaceId ? paseo.workspaces.ref(source.workspaceId).agents.create(options)
    : paseo.agents.create({ ...options, cwd: source.cwd });
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

async function appendOrigin(agent: AgentHandle, source: Agent, node: ConversationNode, context: ForkContext) {
  try {
    await agent.timeline.append({ type: "plugin", kind: "omp-fork-origin", id: "fork-origin", version: 1,
      data: forkOrigin(source, node, context) });
    return undefined;
  } catch (error) {
    return `The copy was created, but its history preview could not be displayed. ${errorMessage(error)}`;
  }
}

async function confirmEditSource(agent: AgentHandle, baseline: Agent) {
  const current = (await agent.refresh())?.agent;
  if (!current) throw new Error("Conversation not found.");
  checkEditable(current);
  if (current.lastUserMessageAt !== baseline.lastUserMessageAt) throw new Error(HISTORY_CHANGED);
  return current;
}

function checkEditable(source: Agent) {
  if (source.archivedAt) throw new Error(ARCHIVED);
  if (source.status === "running" || source.status === "initializing" || source.activeTurn || source.pendingPermissions.length) throw new Error(RUNNING);
}

export function createConversationActions(openDaemon: Connect = connect) {
  const editing = new Set<string>();
  return {
    async capabilities(paseo: PaseoApi, agentId: string) {
      const source = (await paseo.agents.ref(agentId).refresh())?.agent;
      const flags = source?.capabilities;
      return {
        supportsRewindConversation: flags?.supportsRewindConversation === true,
        supportsRewindFiles: flags?.supportsRewindFiles === true,
        supportsRewindBoth: flags?.supportsRewindBoth === true,
        supportsFork: Boolean(source), provider: source?.provider ?? null, status: source?.status ?? null,
      };
    },
    latestNode: (paseo: PaseoApi, id: string, kind?: ConversationNode["nodeKind"]) => latestNode(paseo.agents.ref(id).timeline, kind),
    async rewindEdit(paseo: PaseoApi, input: ConversationRewindEditInput): Promise<ConversationRewindEditResult> {
      const failed = (error: string): ConversationRewindEditResult => ({ ok: false, strategy: "failed", error });
      if ((input.action === "files") !== (input.rewindMode === "files")) return failed("Select a matching rewind action and mode.");
      if (input.action === "resend" && !input.editedText.trim()) return failed("Enter a message to resend.");
      if (editing.has(input.agentId)) return failed("Another edit is already in progress for this conversation.");
      editing.add(input.agentId);
      let daemon: ConversationDaemon | null = null;
      try {
        const original = paseo.agents.ref(input.agentId);
        const source = (await original.refresh())?.agent;
        if (!source) return failed("Conversation not found.");
        checkEditable(source);
        const { epoch, entries } = await readTimeline(original.timeline);
        const index = resolveConversationNode(entries, { ...input, nodeKind: "user", nodeText: input.originalText });
        if (index < 0) return failed(NO_NODE);
        const node = asNode(entries[index]!)!;
        daemon = await openDaemon().catch(() => null);
        const current = await confirmEditSource(original, source);
        const flags = current.capabilities;
        const supportsMode = { conversation: flags?.supportsRewindConversation, files: flags?.supportsRewindFiles,
          both: flags?.supportsRewindBoth }[input.rewindMode];
        if (node.messageId && supportsMode && daemon?.rewindAgent) {
          let rewindError: string | undefined;
          try {
            const response = await daemon.rewindAgent(input.agentId, node.messageId, input.rewindMode);
            if (!response.ok) rewindError = response.error ?? "Rewind failed.";
          } catch (error) {
            rewindError = errorMessage(error);
          }
          if (rewindError === undefined) {
            if (input.action === "resend") {
              try {
                await original.send(input.editedText);
              } catch (error) {
                return { ok: false, strategy: "native_rewind", targetAgentId: original.id, restoredText: input.editedText,
                  error: `The rewind succeeded, but the edited message could not be sent. ${errorMessage(error)}` };
              }
            }
            return { ok: true, strategy: "native_rewind", targetAgentId: original.id,
              ...(input.action === "composer" ? { restoredText: input.editedText } : {}) };
          }
          if (input.rewindMode !== "conversation") return failed(rewindError);
          // A provider can commit a rewind before the daemon fails to refresh
          // its timeline. Only replace the source if it still has that history.
          const recovered = await confirmEditSource(original, current);
          const tail = await original.timeline.refetch({ direction: "tail", limit: 1, projection: "projected" });
          if (tail.error || tail.epoch !== epoch || JSON.stringify(recovered.persistence) !== JSON.stringify(current.persistence)) {
            return failed(`The rewind could not be confirmed. ${rewindError} Refresh the conversation before editing again.`);
          }
        }
        if (input.rewindMode !== "conversation") return failed("File rewind is unavailable for this conversation or message.");
        const context = await buildContext(daemon, source.id, epoch, entries, index - 1);
        const latest = await confirmEditSource(original, source);
        const replacement = await createAgent(paseo, latest, latest.title,
          input.action === "composer" ? contextPrompt(context) : undefined);
        let warning = context.attachment ? await appendOrigin(replacement, source, node, context) : undefined;
        if (input.action === "resend") {
          try {
            await replacement.send(input.editedText, context.attachment ? { attachments: [context.attachment] } : undefined);
          } catch (error) {
            return { ok: false, strategy: "branch_replace", targetAgentId: replacement.id, restoredText: input.editedText,
              archivedOldAgent: false, error: `The replacement was created, but the message could not be sent. The original is still available. ${errorMessage(error)}` };
          }
        }
        let archivedOldAgent = false;
        if (input.archiveSuperseded) {
          try {
            await confirmEditSource(original, latest);
            await original.archive();
            archivedOldAgent = true;
          } catch (error) {
            warning = `The replacement is ready. The original conversation could not be archived. ${errorMessage(error)}`;
          }
        }
        return { ok: true, strategy: "branch_replace", targetAgentId: replacement.id, archivedOldAgent,
          ...(input.action === "composer" ? { restoredText: input.editedText } : {}), ...(warning ? { error: warning } : {}) };
      } catch (error) {
        return failed(errorMessage(error));
      } finally {
        await daemon?.close().catch(() => {});
        editing.delete(input.agentId);
      }
    },
    async fork(paseo: PaseoApi, input: ConversationForkInput): Promise<ConversationForkResult> {
      let daemon: ConversationDaemon | null = null;
      try {
        const original = paseo.agents.ref(input.agentId);
        const source = (await original.refresh())?.agent;
        if (!source) return { ok: false, error: "Conversation not found." };
        const { entries, epoch } = await readTimeline(original.timeline);
        const index = resolveConversationNode(entries, input);
        if (index < 0) return { ok: false, error: NO_NODE };
        const node = asNode(entries[index]!)!;
        daemon = await openDaemon().catch(() => null);
        const context = await buildContext(daemon, source.id, epoch, entries, index, node.messageId);
        const title = input.title?.trim() || `${source.title?.trim() || "Conversation"} (Fork)`;
        const prompt = input.initialPrompt?.trim() ? input.initialPrompt : undefined;
        const fork = await createAgent(paseo, source, title, prompt ? undefined : contextPrompt(context));
        const result = { newAgentId: fork.id, title, itemCount: context.itemCount };
        const warning = await appendOrigin(fork, source, node, context);
        if (prompt) {
          try {
            await fork.send(prompt, context.attachment ? { attachments: [context.attachment] } : undefined);
          } catch (error) {
            return { ok: false, ...result,
              error: `The copy was created, but its first message could not be sent. ${errorMessage(error)}` };
          }
        }
        return { ok: true, ...result, ...(warning ? { error: warning } : {}) };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      } finally {
        await daemon?.close().catch(() => {});
      }
    },
  };
}

export function registerConversationActions(server: PluginServerContext) {
  const actions = createConversationActions();
  server.handle(conversationCapabilitiesRpc, ({ agentId }, { paseo }) => actions.capabilities(paseo, agentId));
  server.handle(conversationLatestNodeRpc, async ({ agentId, nodeKind }, { paseo }) => ({ node: await actions.latestNode(paseo, agentId, nodeKind) }));
  server.handle(conversationRewindEditRpc, (input, { paseo }) => actions.rewindEdit(paseo, input));
  server.handle(conversationForkRpc, (input, { paseo }) => actions.fork(paseo, input));
}
