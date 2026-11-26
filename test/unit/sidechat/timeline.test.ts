import { expect, it } from "vitest";
import {
  appendOptimisticUserMessage,
  applyTimelineStreamEvent,
  createEmptyTimelineState,
  extractPromptOutline,
  fromTimelineSnapshot,
  projectTimelineRows,
} from "../../../shared/sidechat/timeline";

it("streaming reasoning and assistant_message chunks concatenate and settle cleanly", () => {
  let state = appendOptimisticUserMessage(createEmptyTimelineState(), {
    text: "Why does this hook re-render?",
    clientMessageId: "c1",
    timestamp: "2026-11-21T01:00:00Z",
  });

  state = applyTimelineStreamEvent(state, {
    agentId: "a1",
    seq: 1,
    epoch: "e1",
    timestamp: "2026-11-21T01:00:01Z",
    event: {
      type: "timeline",
      provider: "claude",
      turnId: "t1",
      item: { type: "user_message", text: "Why does this hook re-render?", clientMessageId: "c1", messageId: "m1" },
    },
  }).state;
  expect(state.items.length).toBe(1);
  expect(state.items[0]).toMatchObject({ kind: "user_message", optimistic: false });

  // Stream two reasoning chunks
  state = applyTimelineStreamEvent(state, {
    agentId: "a1",
    seq: 2,
    epoch: "e1",
    timestamp: "2026-11-21T01:00:02Z",
    event: {
      type: "timeline",
      provider: "claude",
      turnId: "t1",
      item: { type: "reasoning", text: "Checking deps... " },
    },
  }).state;
  state = applyTimelineStreamEvent(state, {
    agentId: "a1",
    seq: 3,
    epoch: "e1",
    timestamp: "2026-11-21T01:00:03Z",
    event: {
      type: "timeline",
      provider: "claude",
      turnId: "t1",
      item: { type: "reasoning", text: "Found unstable object literal." },
    },
  }).state;

  expect(state.items.length).toBe(2);
  expect(state.items[1]).toMatchObject({
    kind: "thought",
    text: "Checking deps... Found unstable object literal.",
    status: "loading",
  });

  // Duplicate seq <= maxSeq is ignored
  const deduped = applyTimelineStreamEvent(state, {
    agentId: "a1",
    seq: 3,
    epoch: "e1",
    timestamp: "2026-11-21T01:00:03Z",
    event: {
      type: "timeline",
      provider: "claude",
      turnId: "t1",
      item: { type: "reasoning", text: "Found unstable object literal." },
    },
  }).state;
  expect(deduped.items[1]).toMatchObject({ kind: "thought", text: "Checking deps... Found unstable object literal." });

  // Assistant answer settles thought -> ready and concatenates deltas
  state = applyTimelineStreamEvent(state, {
    agentId: "a1",
    seq: 4,
    epoch: "e1",
    timestamp: "2026-11-21T01:00:04Z",
    event: {
      type: "timeline",
      provider: "claude",
      turnId: "t1",
      item: { type: "assistant_message", text: "Because `options` ", messageId: "am1" },
    },
  }).state;
  expect(state.items[1]).toMatchObject({ kind: "thought", status: "ready" });

  state = applyTimelineStreamEvent(state, {
    agentId: "a1",
    seq: 5,
    epoch: "e1",
    timestamp: "2026-11-21T01:00:05Z",
    event: {
      type: "timeline",
      provider: "claude",
      turnId: "t1",
      item: { type: "assistant_message", text: "is recreated each render.", messageId: "am1" },
    },
  }).state;

  state = applyTimelineStreamEvent(state, {
    agentId: "a1",
    seq: 6,
    epoch: "e1",
    timestamp: "2026-11-21T01:00:06Z",
    event: { type: "turn_completed", provider: "claude", turnId: "t1" },
  }).state;

  expect(state.isTurnActive).toBe(false);
  expect(state.items[2]).toMatchObject({
    kind: "assistant_message",
    text: "Because `options` is recreated each render.",
    streaming: false,
  });
});

it("projectTimelineRows adapts accurately to full, collapseToolCalls, collapseTurns, and autoExpandReasoning", () => {
  const snapshot = fromTimelineSnapshot({
    epoch: "e1",
    window: { minSeq: 0, maxSeq: 10, nextSeq: 11 },
    agent: { status: "idle", activeTurn: null },
    entries: [
      {
        provider: "claude",
        turnId: "t1",
        timestamp: "2026-11-21T01:00:00Z",
        seqStart: 1,
        seqEnd: 1,
        item: { type: "user_message", text: "Inspect auth flow" },
      },
      {
        provider: "claude",
        turnId: "t1",
        timestamp: "2026-11-21T01:00:01Z",
        seqStart: 2,
        seqEnd: 2,
        item: { type: "reasoning", text: "Let me read auth.ts and session.ts" },
      },
      {
        provider: "claude",
        turnId: "t1",
        timestamp: "2026-11-21T01:00:02Z",
        seqStart: 3,
        seqEnd: 3,
        item: {
          type: "tool_call",
          callId: "c1",
          name: "Read",
          status: "completed",
          error: null,
          detail: { type: "read", filePath: "src/auth.ts" },
        },
      },
      {
        provider: "claude",
        turnId: "t1",
        timestamp: "2026-11-21T01:00:03Z",
        seqStart: 4,
        seqEnd: 4,
        item: {
          type: "tool_call",
          callId: "c2",
          name: "Read",
          status: "completed",
          error: null,
          detail: { type: "read", filePath: "src/session.ts" },
        },
      },
      {
        provider: "claude",
        turnId: "t1",
        timestamp: "2026-11-21T01:00:04Z",
        seqStart: 5,
        seqEnd: 5,
        item: { type: "assistant_message", text: "Auth validates JWTs in `src/auth.ts`." },
      },
    ],
  });

  // 1. collapseTurns + autoExpandReasoning=false -> user_message, turn_summary, assistant_message
  const collapsedTurns = projectTimelineRows(snapshot.items, {
    chatDisplay: "collapseTurns",
    autoExpandReasoning: false,
    isTurnActive: false,
    expandedGroupIds: new Set(),
    toggledItemIds: new Set(),
  });
  expect(collapsedTurns.map((r) => r.kind)).toStrictEqual(["user_message", "turn_summary", "assistant_message"]);
  if (collapsedTurns[1]?.kind === "turn_summary") {
    expect(collapsedTurns[1]?.counts.thoughtCount).toBe(1);
    expect(collapsedTurns[1]?.counts.readFileCount).toBe(2);
  }

  // 2. collapseTurns + autoExpandReasoning=true -> thought stays expanded above turn_summary!
  const collapsedTurnsExpandedThought = projectTimelineRows(snapshot.items, {
    chatDisplay: "collapseTurns",
    autoExpandReasoning: true,
    isTurnActive: false,
    expandedGroupIds: new Set(),
    toggledItemIds: new Set(),
  });
  expect(collapsedTurnsExpandedThought.map((r) => r.kind)).toStrictEqual(["user_message", "thought", "turn_summary", "assistant_message"]);
  if (collapsedTurnsExpandedThought[1]?.kind === "thought") {
    expect(collapsedTurnsExpandedThought[1]?.expanded).toBe(true);
  }

  // 3. collapseToolCalls + autoExpandReasoning=true -> thought ungrouped & expanded, 2 Read calls grouped!
  const groupedTools = projectTimelineRows(snapshot.items, {
    chatDisplay: "collapseToolCalls",
    autoExpandReasoning: true,
    isTurnActive: false,
    expandedGroupIds: new Set(),
    toggledItemIds: new Set(),
  });
  expect(groupedTools.map((r) => r.kind)).toStrictEqual(["user_message", "thought", "tool_group", "assistant_message"]);

  // 4. full + autoExpandReasoning=false -> every item shown, thought collapsed by default
  const fullRows = projectTimelineRows(snapshot.items, {
    chatDisplay: "full",
    autoExpandReasoning: false,
    isTurnActive: false,
    expandedGroupIds: new Set(),
    toggledItemIds: new Set(),
  });
  expect(fullRows.map((r) => r.kind)).toStrictEqual(["user_message", "thought", "tool_call", "tool_call", "assistant_message"]);
  if (fullRows[1]?.kind === "thought") {
    expect(fullRows[1]?.expanded).toBe(false);
  }

  // Outline extraction
  const outline = extractPromptOutline(snapshot.items);
  expect(outline.length).toBe(1);
  expect(outline[0]?.preview).toBe("Inspect auth flow");
});

it("fromTimelineSnapshot converts Paseo parent->child agent_message tool_call into clean user_message without duplicating optimistic bubble", () => {
  const optimistic = appendOptimisticUserMessage(createEmptyTimelineState(), {
    text: "给我随便画个流程图我看下显示",
    clientMessageId: "c-init",
    timestamp: "2026-11-21T02:00:00Z",
  });
  const optimisticUser = optimistic.items[0];
  if (optimisticUser?.kind !== "user_message") throw new Error("Expected an optimistic user message");

  const snapshot = fromTimelineSnapshot(
    {
      epoch: "e1",
      window: { minSeq: 0, maxSeq: 3, nextSeq: 4 },
      agent: { status: "idle", activeTurn: null },
      entries: [
        {
          provider: "claude",
          turnId: "t1",
          timestamp: "2026-11-21T02:00:01Z",
          seqStart: 1,
          seqEnd: 1,
          item: {
            type: "tool_call",
            callId: "msg-call-1",
            name: "agent_message",
            status: "completed",
            error: null,
            detail: { type: "plain_text", text: "给我随便画个流程图我看下显示" },
            agentMessage: {
              event: "message",
              sender: { id: "parent-1" },
              text: "<sidechat_context>\nMain session: finance\n</sidechat_context>\n\n给我随便画个流程图我看下显示",
            },
          },
        },
      ],
    },
    [optimisticUser],
  );

  expect(snapshot.items.length).toBe(1);
  expect(snapshot.items[0]).toMatchObject({
    kind: "user_message",
    body: "给我随便画个流程图我看下显示",
    mainContext: "Main session: finance",
  });
  expect(snapshot.items[0]).not.toHaveProperty("optimistic", true);
});

it("projectTimelineRows keeps running tools inside a single stable tool_group without external row bounce, and preserves expanded state across turn completion", () => {
  const runningSnapshot = fromTimelineSnapshot({
    epoch: "e2",
    window: { minSeq: 0, maxSeq: 4, nextSeq: 5 },
    agent: { status: "running", activeTurn: { turnId: "t-live", startedAt: "2026-11-21T03:00:00Z" } },
    entries: [
      {
        provider: "claude",
        turnId: "t-live",
        timestamp: "2026-11-21T03:00:00Z",
        seqStart: 1,
        seqEnd: 1,
        item: { type: "user_message", text: "Check git diff" },
      },
      {
        provider: "claude",
        turnId: "t-live",
        timestamp: "2026-11-21T03:00:01Z",
        seqStart: 2,
        seqEnd: 2,
        item: {
          type: "tool_call",
          callId: "c1",
          name: "Read",
          status: "completed",
          error: null,
          detail: { type: "read", filePath: "package.json" },
        },
      },
      {
        provider: "claude",
        turnId: "t-live",
        timestamp: "2026-11-21T03:00:02Z",
        seqStart: 3,
        seqEnd: 3,
        item: {
          type: "tool_call",
          callId: "c2",
          name: "Bash",
          status: "running",
          error: null,
          detail: { type: "shell", command: "git status" },
        },
      },
    ],
  });

  // 1. Collapsed (default): running c2 stays INSIDE the single `tool_group` row (never pops outside!)
  const liveCollapsedRows = projectTimelineRows(runningSnapshot.items, {
    chatDisplay: "collapseTurns",
    autoExpandReasoning: false,
    isTurnActive: true,
    expandedGroupIds: new Set(),
    toggledItemIds: new Set(),
  });
  expect(liveCollapsedRows.map((r) => r.kind)).toStrictEqual(["user_message", "tool_group"]);
  const groupRow = liveCollapsedRows[1]!;
  expect(groupRow.kind).toBe("tool_group");
  if (groupRow.kind === "tool_group") {
    expect(groupRow.isLoading).toBe(true);
    expect(groupRow.items.length).toBe(2);
    expect(groupRow.activeStepLabel ?? "").toMatch(/Bash.*git status/);
  }

  // 2. Expanded while running: ALL items (including running c2) render nested INSIDE the group!
  const expandedSet = new Set([groupRow.id]);
  const liveExpandedRows = projectTimelineRows(runningSnapshot.items, {
    chatDisplay: "collapseTurns",
    autoExpandReasoning: false,
    isTurnActive: true,
    expandedGroupIds: expandedSet,
    toggledItemIds: new Set(),
  });
  expect(liveExpandedRows.map((r) => r.kind)).toStrictEqual(["user_message", "tool_group", "tool_call", "tool_call"]);
  if (liveExpandedRows[2]?.kind === "tool_call" && liveExpandedRows[3]?.kind === "tool_call") {
    expect(liveExpandedRows[2].nested).toBe(true);
    expect(liveExpandedRows[3].nested).toBe(true);
  }

  // 3. Turn finishes with an assistant message: the group ID stays identical so expansion state is preserved!
  const finishedSnapshot = fromTimelineSnapshot({
    epoch: "e2",
    window: { minSeq: 0, maxSeq: 5, nextSeq: 6 },
    agent: { status: "idle", activeTurn: null },
    entries: [
      {
        provider: "claude",
        turnId: "t-live",
        timestamp: "2026-11-21T03:00:00Z",
        seqStart: 1,
        seqEnd: 1,
        item: { type: "user_message", text: "Check git diff" },
      },
      {
        provider: "claude",
        turnId: "t-live",
        timestamp: "2026-11-21T03:00:01Z",
        seqStart: 2,
        seqEnd: 2,
        item: {
          type: "tool_call",
          callId: "c1",
          name: "Read",
          status: "completed",
          error: null,
          detail: { type: "read", filePath: "package.json" },
        },
      },
      {
        provider: "claude",
        turnId: "t-live",
        timestamp: "2026-11-21T03:00:02Z",
        seqStart: 3,
        seqEnd: 3,
        item: {
          type: "tool_call",
          callId: "c2",
          name: "Bash",
          status: "completed",
          error: null,
          detail: { type: "shell", command: "git status" },
        },
      },
      {
        provider: "claude",
        turnId: "t-live",
        timestamp: "2026-11-21T03:00:04Z",
        seqStart: 4,
        seqEnd: 4,
        item: { type: "assistant_message", text: "Working tree is clean." },
      },
    ],
  });

  const finishedExpandedRows = projectTimelineRows(finishedSnapshot.items, {
    chatDisplay: "collapseTurns",
    autoExpandReasoning: false,
    isTurnActive: false,
    expandedGroupIds: expandedSet,
    toggledItemIds: new Set(),
  });
  expect(finishedExpandedRows[1]?.id).toBe(groupRow.id);
  expect(finishedExpandedRows.map((r) => r.kind)).toStrictEqual(["user_message", "turn_summary", "tool_call", "tool_call", "assistant_message"]);
});

it("showActions never appears mid-turn or on intermediate assistant narration before subsequent tool calls", () => {
  const midTurnEntries = [
    {
      provider: "claude",
      turnId: "t-multi",
      timestamp: "2026-11-21T03:05:00Z",
      seqStart: 1,
      seqEnd: 1,
      item: { type: "user_message" as const, text: "再帮我看下有没有最新的需要我处理的 request" },
    },
    {
      provider: "claude",
      turnId: "t-multi",
      timestamp: "2026-11-21T03:05:01Z",
      seqStart: 2,
      seqEnd: 2,
      item: { type: "reasoning" as const, text: "Checking tools" },
    },
    {
      provider: "claude",
      turnId: "t-multi",
      timestamp: "2026-11-21T03:05:02Z",
      seqStart: 3,
      seqEnd: 3,
      item: {
        type: "tool_call" as const,
        callId: "c1",
        name: "ToolSearch",
        status: "completed" as const,
        error: null,
        detail: { type: "search" as const, query: "slack" },
      },
    },
    {
      provider: "claude",
      turnId: "t-multi",
      timestamp: "2026-11-21T03:05:03Z",
      seqStart: 4,
      seqEnd: 4,
      item: { type: "assistant_message" as const, text: "Need Slack tool. Search deferred tools." },
    },
    {
      provider: "claude",
      turnId: "t-multi",
      timestamp: "2026-11-21T03:05:04Z",
      seqStart: 5,
      seqEnd: 5,
      item: { type: "reasoning" as const, text: "Searching deferred MCP tools" },
    },
    {
      provider: "claude",
      turnId: "t-multi",
      timestamp: "2026-11-21T03:05:05Z",
      seqStart: 6,
      seqEnd: 6,
      item: {
        type: "tool_call" as const,
        callId: "c2",
        name: "ToolSearch",
        status: "completed" as const,
        error: null,
        detail: { type: "search" as const, query: "slack-personal" },
      },
    },
  ];

  // 1. Mid-turn (even if isTurnActive temporarily flickered false, subsequent thought/tool after assistant_message suppresses showActions!)
  const midTurnSnapshot = fromTimelineSnapshot({
    epoch: "e3",
    window: { minSeq: 0, maxSeq: 6, nextSeq: 7 },
    agent: { status: "running", activeTurn: { turnId: "t-multi", startedAt: "2026-11-21T03:05:00Z" } },
    entries: midTurnEntries,
  });

  const midTurnRows = projectTimelineRows(midTurnSnapshot.items, {
    chatDisplay: "collapseToolCalls",
    autoExpandReasoning: false,
    isTurnActive: false,
    expandedGroupIds: new Set(),
    toggledItemIds: new Set(),
  });
  const midTurnAssistantRows = midTurnRows.filter(
    (r): r is Extract<typeof r, { kind: "assistant_message" }> => r.kind === "assistant_message",
  );
  expect(midTurnAssistantRows.length).toBe(1);
  expect(midTurnAssistantRows[0]?.showActions).toBe(false);

  // 2. After final conclusion arrives and turn completes: ONLY the final assistant message has showActions=true!
  const completedSnapshot = fromTimelineSnapshot({
    epoch: "e3",
    window: { minSeq: 0, maxSeq: 7, nextSeq: 8 },
    agent: { status: "idle", activeTurn: null },
    entries: [
      ...midTurnEntries,
      {
        provider: "claude",
        turnId: "t-multi",
        timestamp: "2026-11-21T03:05:08Z",
        seqStart: 7,
        seqEnd: 7,
        item: { type: "assistant_message" as const, text: "目前没有需要你处理的新请求。" },
      },
    ],
  });

  // In `collapseToolCalls`: intermediate narration has showActions=false, final answer has showActions=true
  const completedToolRows = projectTimelineRows(completedSnapshot.items, {
    chatDisplay: "collapseToolCalls",
    autoExpandReasoning: false,
    isTurnActive: false,
    expandedGroupIds: new Set(),
    toggledItemIds: new Set(),
  });
  const assistantRows = completedToolRows.filter(
    (r): r is Extract<typeof r, { kind: "assistant_message" }> => r.kind === "assistant_message",
  );
  expect(assistantRows.length).toBe(2);
  expect(assistantRows[0]?.item.text).toBe("Need Slack tool. Search deferred tools.");
  expect(assistantRows[0]?.showActions).toBe(false);
  expect(assistantRows[1]?.item.text).toBe("目前没有需要你处理的新请求。");
  expect(assistantRows[1]?.showActions).toBe(true);

  // While turn is still streaming the final message (`isTurnActive: true`), showActions is false on ALL messages
  const stillRunningRows = projectTimelineRows(completedSnapshot.items, {
    chatDisplay: "collapseToolCalls",
    autoExpandReasoning: false,
    isTurnActive: true,
    expandedGroupIds: new Set(),
    toggledItemIds: new Set(),
  });
  for (const r of stillRunningRows) {
    if (r.kind === "assistant_message") {
      expect(r.showActions).toBe(false);
    }
  }
});
