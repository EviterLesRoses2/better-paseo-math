import { expect, it } from "vitest";
import { z } from "zod";
import {
  applyTimelinePluginsToItems,
  applyTimelineStreamEvent,
  createEmptyTimelineState,
  fromTimelineSnapshot,
  projectTimelineRows,
} from "../../../shared/sidechat/timeline";
import { collectTimelinePluginContributions } from "../../../shared/sidechat/timeline-plugin-loader";

it("collectTimelinePluginContributions evaluates Gen-UI style clientBundle, captures transformers/renderers, and no-ops sidebar views", async () => {
  let cleanedUp = false;

  const mockGenUiBundle = `(function(require) {
    const module = { exports: {} };
    const { z } = require("zod");
    module.exports.default = function contribute(client) {
      // Host UI registrations must safely no-op without duplicating in Paseo
      client.addSidebarView({
        id: "gen-ui-gallery",
        title: "Gen-UI Gallery",
        icon: "LayoutGrid",
        Component: function Gallery() { return null; },
      });

      client.addTimelineTransformer({
        id: "gen-ui-assistant",
        query: { itemType: "assistant_message" },
        transform({ item, phase }) {
          if (!item.text.includes("Card(")) return undefined;
          const parts = item.text.split(/(\\x60{3}[\\s\\S]*?Card\\([\\s\\S]*?\\x60{3})/);
          const items = [];
          parts.forEach((seg, idx) => {
            if (!seg.trim()) return;
            if (seg.includes("Card(")) {
              items.push({
                type: "plugin",
                id: "seg-" + idx,
                kind: "gen-ui-card",
                version: 1,
                data: { dsl: seg, streaming: phase === "streaming" },
              });
            } else {
              items.push({
                type: "plugin",
                id: "seg-" + idx,
                kind: "gen-ui-prose",
                version: 1,
                data: { markdown: seg },
              });
            }
          });
          return { items };
        },
      });

      client.addTimelineRenderer({
        kind: "gen-ui-card",
        version: 1,
        schema: z.object({ dsl: z.string(), streaming: z.boolean() }),
        Component: function GenUiCardView() { return null; },
      });

      client.addTimelineRenderer({
        kind: "gen-ui-prose",
        version: 1,
        schema: z.object({ markdown: z.string() }),
        Component: function GenUiProseView() { return null; },
      });

      return function cleanup() {
        return "cleaned";
      };
    };
    return module.exports;
  })`;

  const evaluated = collectTimelinePluginContributions({
    pluginId: "paseo-gen-ui",
    bundleHash: "hash-v1",
    bundleCode: mockGenUiBundle,
    evaluateFactory: (_id, code) => {
      const fn = (0, globalThis.eval)(code) as (req: (s: string) => unknown) => unknown;
      return fn;
    },
    requireModule: (specifier) => {
      if (specifier === "zod") return { z };
      throw new Error(`Unexpected module: ${specifier}`);
    },
  });

  expect(evaluated.id).toBe("paseo-gen-ui");
  expect(evaluated.timelineTransformers.length).toBe(1);
  expect(evaluated.timelineRenderers.length).toBe(2);

  const rawText = [
    "最近的逻辑是两层分工：",
    "```genui\nCard(\"工具调用的判定逻辑\", [\n  Diagram(\"flowchart TD\"),\n])\n```",
    "为什么这样分：\n- 开放权限只放一处。",
  ].join("\n\n");

  const snapshot = fromTimelineSnapshot({
    epoch: "ep-1",
    window: { minSeq: 0, maxSeq: 4, nextSeq: 5 },
    agent: { status: "idle", activeTurn: null },
    entries: [
      {
        provider: "claude",
        item: { type: "user_message", text: "解释一下最近的逻辑", messageId: "u1" },
        turnId: "t1",
        timestamp: "2026-11-21T05:50:00.000Z",
        seqStart: 1,
        seqEnd: 1,
      },
      {
        provider: "claude",
        item: { type: "reasoning", text: "Checking registry and config center..." },
        turnId: "t1",
        timestamp: "2026-11-21T05:50:01.000Z",
        seqStart: 2,
        seqEnd: 2,
      },
      {
        provider: "claude",
        item: {
          type: "tool_call",
          callId: "c1",
          name: "Bash",
          status: "completed",
          error: null,
          detail: { type: "shell", command: "git log -n 3" },
        },
        turnId: "t1",
        timestamp: "2026-11-21T05:50:02.000Z",
        seqStart: 3,
        seqEnd: 3,
      },
      {
        provider: "claude",
        item: { type: "assistant_message", text: rawText, messageId: "a1" },
        turnId: "t1",
        timestamp: "2026-11-21T05:50:05.000Z",
        seqStart: 4,
        seqEnd: 4,
      },
    ],
  });

  const transformed = applyTimelinePluginsToItems(snapshot.items, [evaluated]);
  const projected = projectTimelineRows(transformed, {
    chatDisplay: "collapseTurns",
    autoExpandReasoning: false,
    isTurnActive: false,
    expandedGroupIds: new Set(),
    toggledItemIds: new Set(),
  });

  // Expected rows: user_message, turn_summary (1 thought + 1 command), and ALL 3 Gen-UI plugin rows in tail!
  expect(projected.map((r) => r.kind)).toStrictEqual(["user_message", "turn_summary", "plugin", "plugin", "plugin"]);

  const pluginRows = projected.filter((r) => r.kind === "plugin");
  expect(pluginRows[0]?.item.itemKind).toBe("gen-ui-prose");
  expect(pluginRows[0]?.showActions).toBe(false);

  expect(pluginRows[1]?.item.itemKind).toBe("gen-ui-card");
  expect(pluginRows[1]?.showActions).toBe(false);

  expect(pluginRows[2]?.item.itemKind).toBe("gen-ui-prose");
  expect(pluginRows[2]?.showActions).toBe(true);
  expect(pluginRows[2]?.actionText).toBe(rawText);

  await evaluated.cleanup();
  cleanedUp = true;
  expect(cleanedUp).toBe(true);
  expect(evaluated.timelineTransformers.length).toBe(0);
  expect(evaluated.timelineRenderers.length).toBe(0);
});

it("streaming assistant_message passes phase='streaming' and suppresses action bar until turn completes", () => {
  const seenPhases: string[] = [];
  const mockPlugin = {
    id: "future-chart-plugin",
    timelineTransformers: [
      {
        id: "chart-transform",
        query: { itemType: "assistant_message" as const },
        transform({ item, phase }: { item: { type: string; text?: string }; phase: "streaming" | "complete" }) {
          seenPhases.push(phase);
          return {
            items: [
              {
                type: "plugin" as const,
                id: "chart-0",
                kind: "chart-block",
                version: 1,
                data: { raw: item.text ?? "", live: phase === "streaming" },
              },
            ],
          };
        },
      },
    ],
  };

  let state = createEmptyTimelineState();
  state = applyTimelineStreamEvent(state, {
    agentId: "ag-1",
    seq: 1,
    epoch: "ep-1",
    timestamp: "2026-11-21T06:00:00.000Z",
    event: { type: "turn_started", provider: "claude", turnId: "t1" },
  }).state;

  state = applyTimelineStreamEvent(state, {
    agentId: "ag-1",
    seq: 2,
    epoch: "ep-1",
    timestamp: "2026-11-21T06:00:01.000Z",
    event: {
      type: "timeline",
      provider: "claude",
      turnId: "t1",
      item: { type: "assistant_message", text: "Chart([1, 2, 3])", messageId: "m1" },
    },
  }).state;

  const liveTransformed = applyTimelinePluginsToItems(state.items, [mockPlugin]);
  const liveRows = projectTimelineRows(liveTransformed, {
    chatDisplay: "collapseTurns",
    autoExpandReasoning: false,
    isTurnActive: state.isTurnActive,
    expandedGroupIds: new Set(),
    toggledItemIds: new Set(),
  });
  expect(liveRows[0]?.kind).toBe("plugin");
  if (liveRows[0]?.kind === "plugin") {
    expect(liveRows[0].showActions).toBe(false);
    expect(liveRows[0].item.data).toStrictEqual({ raw: "Chart([1, 2, 3])", live: true });
  }

  state = applyTimelineStreamEvent(state, {
    agentId: "ag-1",
    seq: 3,
    epoch: "ep-1",
    timestamp: "2026-11-21T06:00:02.000Z",
    event: { type: "turn_completed", provider: "claude", turnId: "t1" },
  }).state;

  const doneTransformed = applyTimelinePluginsToItems(state.items, [mockPlugin]);
  const doneRows = projectTimelineRows(doneTransformed, {
    chatDisplay: "collapseTurns",
    autoExpandReasoning: false,
    isTurnActive: state.isTurnActive,
    expandedGroupIds: new Set(),
    toggledItemIds: new Set(),
  });
  expect(doneRows[0]?.kind).toBe("plugin");
  if (doneRows[0]?.kind === "plugin") {
    expect(doneRows[0].showActions).toBe(true);
    expect(doneRows[0].actionText).toBe("Chart([1, 2, 3])");
    expect(doneRows[0].item.data).toStrictEqual({ raw: "Chart([1, 2, 3])", live: false });
  }
  expect(seenPhases).toStrictEqual(["streaming", "complete"]);
});

it("server-emitted plugin timeline items upsert cleanly by pluginId + id and faulty transformers fall back safely", () => {
  let state = createEmptyTimelineState();
  state = applyTimelineStreamEvent(state, {
    agentId: "ag-1",
    seq: 1,
    epoch: "ep-1",
    timestamp: "2026-11-21T06:01:00.000Z",
    event: {
      type: "timeline",
      provider: "claude",
      turnId: "t1",
      item: {
        type: "plugin",
        pluginId: "deploy-preview",
        id: "card-1",
        kind: "preview-card",
        version: 1,
        data: { status: "building" },
      },
    },
  }).state;

  state = applyTimelineStreamEvent(state, {
    agentId: "ag-1",
    seq: 2,
    epoch: "ep-1",
    timestamp: "2026-11-21T06:01:05.000Z",
    event: {
      type: "timeline",
      provider: "claude",
      turnId: "t1",
      item: {
        type: "plugin",
        pluginId: "deploy-preview",
        id: "card-1",
        kind: "preview-card",
        version: 1,
        data: { status: "ready", url: "https://preview.example.com" },
      },
    },
  }).state;

  expect(state.items.length).toBe(1);
  expect(state.items[0]?.kind).toBe("plugin");
  if (state.items[0]?.kind === "plugin") {
    expect(state.items[0].data).toStrictEqual({
      status: "ready",
      url: "https://preview.example.com",
    });
  }

  // Verify a throwing transformer never breaks timeline rendering
  const brokenPlugin = {
    id: "broken-plugin",
    timelineTransformers: [
      {
        id: "crash",
        query: { itemType: "assistant_message" as const },
        transform(): never {
          throw new Error("boom");
        },
      },
    ],
  };

  const snap = fromTimelineSnapshot({
    epoch: "ep-2",
    window: { minSeq: 1, maxSeq: 1, nextSeq: 2 },
    agent: { status: "idle", activeTurn: null },
    entries: [
      {
        provider: "claude",
        item: { type: "assistant_message", text: "Safe fallback markdown", messageId: "m2" },
        turnId: "t2",
        timestamp: "2026-11-21T06:02:00.000Z",
        seqStart: 1,
        seqEnd: 1,
      },
    ],
  });

  const out = applyTimelinePluginsToItems(snap.items, [brokenPlugin]);
  expect(out.length).toBe(1);
  expect(out[0]?.kind).toBe("assistant_message");
});
