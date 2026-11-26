import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const agentInput = z.object({ agentId: z.string().min(1) });
const nodeIdentity = z.object({
  messageId: z.string().optional(),
  clientMessageId: z.string().optional(),
  timestampMs: z.number().optional(),
});
const nodeKind = z.enum(["user", "assistant"]);
export const conversationNodeSchema = nodeIdentity.extend({ nodeKind, nodeText: z.string() });
export type ConversationNode = z.infer<typeof conversationNodeSchema>;
const capabilities = z.object({
  supportsRewindConversation: z.boolean(),
  supportsRewindFiles: z.boolean(),
  supportsRewindBoth: z.boolean(),
  supportsFork: z.boolean(),
  provider: z.string().nullable(),
  status: z.string().nullable(),
});
export type ConversationCapabilities = z.infer<typeof capabilities>;

export const conversationCapabilitiesRpc = defineRpc({
  name: "conversation.capabilities",
  input: agentInput,
  output: capabilities,
});

const rewindEditInput = agentInput.merge(nodeIdentity).extend({
  originalText: z.string(),
  editedText: z.string(),
  action: z.enum(["resend", "composer", "files"]),
  rewindMode: z.enum(["conversation", "files", "both"]),
  archiveSuperseded: z.boolean(),
});
const rewindEditOutput = z.object({
  ok: z.boolean(),
  strategy: z.enum(["native_rewind", "branch_replace", "failed"]),
  targetAgentId: z.string().optional(),
  restoredText: z.string().optional(),
  archivedOldAgent: z.boolean().optional(),
  error: z.string().optional(),
});
export type ConversationRewindEditInput = z.infer<typeof rewindEditInput>;
export type ConversationRewindEditResult = z.infer<typeof rewindEditOutput>;
export const conversationRewindEditRpc = defineRpc({
  name: "conversation.rewind_edit",
  input: rewindEditInput,
  output: rewindEditOutput,
});

const forkInput = agentInput.merge(conversationNodeSchema).extend({
  title: z.string().optional(),
  initialPrompt: z.string().optional(),
});
const forkOutput = z.object({
  ok: z.boolean(),
  newAgentId: z.string().optional(),
  title: z.string().optional(),
  itemCount: z.number().optional(),
  error: z.string().optional(),
});
export type ConversationForkInput = z.infer<typeof forkInput>;
export type ConversationForkResult = z.infer<typeof forkOutput>;
export const conversationForkRpc = defineRpc({
  name: "conversation.fork",
  input: forkInput,
  output: forkOutput,
});

export const conversationLatestNodeRpc = defineRpc({
  name: "conversation.latest_node",
  input: agentInput.extend({ nodeKind: nodeKind.optional() }),
  output: z.object({ node: conversationNodeSchema.nullable() }),
});

export const forkOriginSchema = z.object({
  sourceAgentId: z.string(),
  sourceTitle: z.string(),
  nodeKind,
  nodePreview: z.string(),
  itemCount: z.number().int().nonnegative(),
  summaryLines: z.array(z.string()),
  transcriptExcerpt: z.string(),
});
export type ForkOrigin = z.infer<typeof forkOriginSchema>;
