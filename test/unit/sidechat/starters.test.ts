import { expect, it } from "vitest";
import {
  buildAiStarterGenerationPrompt,
  buildContextualStarterPrompts,
  buildRecencyWeightedStarterDigest,
  computeMainStarterFingerprint,
  detectConversationLanguage,
  parseAiStarterResponse,
  resolveStarterHelperSafetyConfig,
  shouldUseAiStarters,
  type TimelineEntryLike,
} from "../../../shared/sidechat/starters";

it("detectConversationLanguage detects Chinese conversation even with heavy English code and English Paseo UI locale", () => {
  const entries: TimelineEntryLike[] = [
    {
      item: {
        type: "user_message",
        messageId: "u1",
        text: "帮我看看 PSOS-6432 合并后的情况",
      },
    },
    {
      item: {
        type: "assistant_message",
        messageId: "a1",
        text: [
          "PSOS-6432 已经合并到 `origin/master`，环境变量 `CHAT_DELETED_CONVERSATION_RETENTION_DAYS` 默认是 30 天。",
          "```ts",
          "export const CHAT_DELETED_CONVERSATION_RETENTION_DAYS = Number(process.env.CHAT_DELETED_CONVERSATION_RETENTION_DAYS ?? 30);",
          "export function cleanupDeletedConversations(repo: ConversationRepository) { return repo.purgeExpired(); }",
          "```",
        ].join("\n"),
      },
    },
  ];

  const detected = detectConversationLanguage(entries, "en");
  expect(detected.lang).toBe("zh");
  expect(detected.languageTag).toBe("zh-CN");
});

it("detectConversationLanguage respects fallbackLocale when main session has no messages", () => {
  expect(detectConversationLanguage([], "en")).toStrictEqual({
    lang: "en",
    languageTag: "en",
  });
  expect(detectConversationLanguage([], "zh-CN")).toStrictEqual({
    lang: "zh",
    languageTag: "zh-CN",
  });
  expect(detectConversationLanguage([], "ja")).toStrictEqual({
    lang: "ja",
    languageTag: "ja",
  });
});

it("buildContextualStarterPrompts generates 4 concrete Chinese follow-up questions from a realistic main session", () => {
  const entries: TimelineEntryLike[] = [
    {
      item: {
        type: "user_message",
        messageId: "u1",
        text: "同步一下进度",
      },
    },
    {
      item: {
        type: "assistant_message",
        messageId: "a1",
        text: [
          "PSOS-6432 (P2 后续 4 项) 合并了，PR #87 的 commit `23ee658` 在 `origin/master` 上，Jira 改成了 Done。",
          "清理已删除的会话：customer worker 每小时跑一次清理，保留期由 `CHAT_DELETED_CONVERSATION_RETENTION_DAYS` 控制，默认 30 天。契约 `chat/contracts/` 没改。",
          "我转给 PSOS-6431 的提示：",
          "- worker 因会话已删除而取消 run 时，没有改审批记录，这部分归它判断。",
          "- 三处可能冲突的文件位置。",
          "当前进度：epic 里 28 张 ticket，20 张 Done，在跑的只有 PSOS-6431。它刚才是 idle，很可能在等你回答“整条消息都做安全分类，还是把消息上限降到 2000 字”，请去它的 session 看一下。",
        ].join("\n"),
      },
    },
  ];

  // Even when Paseo's UI locale is English ("en"), follow-up starters match the Chinese main chat!
  const starters = buildContextualStarterPrompts({
    title: "Customer AI Chat Tickets Arrangement",
    status: "idle",
    entries,
    fallbackLocale: "en",
  });

  expect(starters.length).toBe(4);
  // 1. Captures the open design dilemma
  expect(starters.some((s) => s.prompt.includes("整条消息都做安全分类，还是把消息上限降到 2000 字")), `Expected open dilemma starter, got: ${JSON.stringify(starters)}`).toBeTruthy();
  // 2. Captures the numeric gap (28 - 20 = 8 remaining tickets!)
  expect(starters.some((s) => s.title.includes("8") && s.title.includes("ticket")), `Expected remaining 8 tickets follow-up, got: ${JSON.stringify(starters)}`).toBeTruthy();
  // 3. Captures unverified/conflict hint or PSOS ticket relationship
  expect(starters.some(
      (s) =>
        s.title.includes("可能冲突") ||
        s.title.includes("PSOS-6431") ||
        s.title.includes("PSOS-6432"),
    )).toBeTruthy();
});

it("buildContextualStarterPrompts generates concrete English follow-ups from errors and touched files", () => {
  const entries: TimelineEntryLike[] = [
    {
      item: {
        type: "user_message",
        messageId: "u1",
        text: "Run the payment webhook integration tests and fix any auth failure.",
      },
    },
    {
      item: {
        type: "tool_call",
        callId: "tc1",
        name: "Edit",
        status: "completed",
        error: null,
        detail: {
          type: "edit",
          filePath: "src/webhooks/stripe-signature.ts",
        },
      },
    },
    {
      item: {
        type: "error",

        message: "WebhookSignatureMismatchError: timestamp tolerance exceeded 300s",
      },
    },
    {
      item: {
        type: "assistant_message",
        messageId: "a1",
        text: 'Updated `STRIPE_WEBHOOK_TOLERANCE_SEC` handling in `src/webhooks/stripe-signature.ts`. Let me know whether to reject replayed timestamps strictly or allow a clock-skew grace window.',
      },
    },
  ];

  const starters = buildContextualStarterPrompts({
    title: "Stripe Webhook Fix",
    status: "idle",
    entries,
    fallbackLocale: "en",
  });

  expect(starters.length).toBe(4);
  expect(starters.some((s) => s.prompt.includes("reject replayed timestamps strictly or allow"))).toBeTruthy();
  expect(starters.some((s) => s.prompt.includes("WebhookSignatureMismatchError"))).toBeTruthy();
});

it("parseAiStarterResponse parses raw JSON and fenced JSON blocks and normalizes icons", () => {
  const fenced = [
    "```json",
    JSON.stringify({
      starters: [
        {
          icon: "GitCompareArrows",
          title: "全量安全分类 vs 限 2000 字怎么选？",
          prompt: "对比全量安全分类与限制 2000 字在延迟、成本与用户体验上的优劣。",
        },
        {
          icon: "ListChecks",
          title: "另外还没做的 8 张 ticket 是什么？",
          prompt: "查一下 epic 里除了已完成 20 张之外，剩下 8 张未完成 ticket 的内容。",
        },
        {
          icon: "UnknownCustomIcon",
          title: "取消 run 不改审批记录会有副作用吗？",
          prompt: "核实 worker 因会话已删除而取消 run 时不改审批记录是否会导致状态不一致。",
        },
        {
          icon: "Workflow",
          title: "那三处可能冲突的文件具体在哪？",
          prompt: "列出 PSOS-6432 与 PSOS-6431 之间可能冲突的三处文件位置及原因。",
        },
      ],
    }),
    "```",
  ].join("\n");

  const parsed = parseAiStarterResponse(fenced);
  if (!parsed) throw new Error("Expected four parsed starters");
  expect(parsed.length).toBe(4);
  expect(parsed[0]?.icon).toBe("GitCompareArrows");
  expect(parsed[1]?.title).toBe("另外还没做的 8 张 ticket 是什么？");
  // Unknown icon safely falls back to a valid Lucide starter icon
  expect(parsed[2]?.icon).toBe("ShieldAlert");
  expect(parseAiStarterResponse("not json at all")).toBe(null);
});

it("computeMainStarterFingerprint stays stable across streaming tokens while running and updates once settled", () => {
  const baseUser = {
    item: { type: "user_message" as const, messageId: "u1", text: "分析当前架构" },
  };
  const streamStep1: TimelineEntryLike[] = [
    baseUser,
    {
      item: {
        type: "assistant_message",
        messageId: "a1",
        text: "这是一段超过六十个字符的开头内容，用来测试流式输出过程中指纹不会因为尾部新增字符而频繁抖动变化……第一部分内容已经稳定输出完毕，后面还在继续追加流式文本 AAAA",
      },
    },
  ];
  const streamStep2: TimelineEntryLike[] = [
    baseUser,
    {
      item: {
        type: "assistant_message",
        messageId: "a1",
        text: "这是一段超过六十个字符的开头内容，用来测试流式输出过程中指纹不会因为尾部新增字符而频繁抖动变化……第一部分内容已经稳定输出完毕，后面还在继续追加流式文本 BBBBBBBBBBBB",
      },
    },
  ];

  const runningFp1 = computeMainStarterFingerprint("agent-1", "running", streamStep1);
  const runningFp2 = computeMainStarterFingerprint("agent-1", "running", streamStep2);
  expect(runningFp1).toBe(runningFp2);

  const idleFp1 = computeMainStarterFingerprint("agent-1", "idle", streamStep1);
  const idleFp2 = computeMainStarterFingerprint("agent-1", "idle", streamStep2);
  expect(idleFp1).not.toBe(idleFp2);

  const prompt = buildAiStarterGenerationPrompt({
    latestTurnBlock: "Main session: Test",
    languageTag: "zh-CN",
  });
  expect(prompt.includes("Simplified Chinese")).toBeTruthy();
  expect(prompt.includes('priority="HIGHEST"')).toBeTruthy();
});

it("multi-turn extraction and digest strictly prioritize the latest main agent message over older resolved turns", () => {
  const longMiddle = "已完成常规模块检查。\n".repeat(120);
  const entries: TimelineEntryLike[] = [
    {
      item: {
        type: "user_message",
        messageId: "u-old",
        text: "先修一下 OLD-101 的缓存报错",
      },
    },
    {
      item: {
        type: "tool_call",
        callId: "tc-old",
        name: "Edit",
        status: "completed",
        error: null,
        detail: { type: "edit", filePath: "src/legacy/old-cache.ts" },
      },
    },
    {
      item: {
        type: "error",

        message: "OldRedisTimeoutError: connection refused",
      },
    },
    {
      item: {
        type: "assistant_message",
        messageId: "a-old",
        text: "OLD-101 里需要决定“用 Redis 还是 Memcached”，共有 10 个子任务，4 个已完成，另外 `OLD_CACHE_TTL` 还没核实。",
      },
    },
    {
      item: {
        type: "user_message",
        messageId: "u-latest",
        text: "好，缓存先不管了，现在看 NEW-888 的工具权限路由",
      },
    },
    {
      item: {
        type: "tool_call",
        callId: "tc-latest",
        name: "Edit",
        status: "completed",
        error: null,
        detail: { type: "edit", filePath: "src/chat/permission-router.ts" },
      },
    },
    {
      item: {
        type: "assistant_message",
        messageId: "a-latest",
        text: [
          "NEW-888 的两层权限判定已经梳理完，核心在 `allowed_mcp_tools`。",
          longMiddle,
          "还没落地或没核实的：",
          "- 给 mercaso-shopper 填 `allowed_mcp_tools` 会不会进入内部 Slack 路由，还没核实。",
          "当前共有 12 张单子，9 张 Done；下一步等你确认“新写工具默认自动放行，还是强制弹确认卡片”。",
        ].join("\n"),
      },
    },
  ];

  const starters = buildContextualStarterPrompts({
    title: "OLD-101 Cache Investigation",
    status: "idle",
    entries,
    fallbackLocale: "zh-CN",
  });

  expect(starters.length).toBe(4);
  // Every top starter comes from Turn 2 (latest message), NEVER from Turn 1!
  expect(starters[0]?.prompt.includes("新写工具默认自动放行，还是强制弹确认卡片")).toBeTruthy();
  expect(starters[1]?.title.includes("3 个 单子")).toBeTruthy();
  expect(starters.every(
      (s) =>
        !s.prompt.includes("OldRedisTimeoutError") &&
        !s.prompt.includes("用 Redis 还是 Memcached") &&
        !s.prompt.includes("OLD-101"),
    ), `Expected zero stale Turn 1 references, got: ${JSON.stringify(starters)}`).toBeTruthy();

  // Recency-weighted AI digest preserves the tail of the long latest message inside HIGHEST priority
  const digest = buildRecencyWeightedStarterDigest({
    title: "OLD-101 Cache Investigation",
    cwd: "/repo",
    status: "idle",
    entries,
  });
  expect(digest.latestTurnBlock.includes("新写工具默认自动放行，还是强制弹确认卡片")).toBeTruthy();
  expect(digest.latestTurnBlock.includes("permission-router.ts")).toBeTruthy();
  expect(digest.latestTurnBlock.includes("edit: permission-router.ts")).toBeTruthy();
  expect(!digest.latestTurnBlock.includes("OldRedisTimeoutError")).toBeTruthy();
  expect(digest.earlierBackgroundBlock.includes("OLD-101")).toBeTruthy();
});

it("digest expands immediately preceding turn when the latest assistant reply is a short confirmation", () => {
  const entries: TimelineEntryLike[] = [
    {
      item: {
        type: "user_message",
        messageId: "u1",
        text: "执行并回复",
      },
    },
    {
      item: {
        type: "assistant_message",
        messageId: "a1",
        text: "Order 314887 已改好，Shopify 同步状态是 PENDING，旧数据备份在 `/app/backups/prod-accounting/update_receivable_20261121_003706.csv`，上一单 M-311271 退货抵了 $24.49。",
      },
    },
    {
      item: {
        type: "user_message",
        messageId: "u2",
        text: "再看下还有没有新消息",
      },
    },
    {
      item: {
        type: "assistant_message",
        messageId: "a2",
        text: "侧边聊天的结论是对的，目前没有新消息。Order 314887 已改好，Itzel 要的下拉筛选还在排期（PSOS-6384 / 6385）。",
      },
    },
  ];

  const digest = buildRecencyWeightedStarterDigest({
    title: "Project Finance",
    cwd: "/repo",
    status: "idle",
    entries,
  });
  expect(digest.latestTurnBlock.includes("PSOS-6384 / 6385")).toBeTruthy();
  expect(digest.earlierBackgroundBlock.includes("M-311271")).toBeTruthy();
  expect(digest.earlierBackgroundBlock.includes("update_receivable_20261121_003706.csv")).toBeTruthy();
});

it("shouldUseAiStarters never contacts an AI provider when starterModelMode is off", () => {
  expect(shouldUseAiStarters({ starterModelMode: "off", requestedMode: "instant" })).toBe(false);
  expect(shouldUseAiStarters({ starterModelMode: "off", requestedMode: "ai" })).toBe(false);
  expect(shouldUseAiStarters({ starterModelMode: "smart", requestedMode: "instant" })).toBe(false);
  expect(shouldUseAiStarters({ starterModelMode: "smart", requestedMode: "ai" })).toBe(true);
  expect(shouldUseAiStarters({ starterModelMode: "fast", requestedMode: "ai" })).toBe(true);
  expect(shouldUseAiStarters({ starterModelMode: "inherit", requestedMode: "ai" })).toBe(true);
});

it("resolveStarterHelperSafetyConfig disables built-in Claude tools and prefers restrictive modes across providers", () => {
  // Claude: explicitly disables all built-in tools and MCP servers, and uses plan when available.
  const claudeWithPlan = resolveStarterHelperSafetyConfig({
    provider: "claude",
    availableModes: [{ id: "auto" }, { id: "plan" }],
  });
  expect(claudeWithPlan).toStrictEqual({
    allowed: true,
    modeId: "plan",
    options: {
      extraArgs: {
        tools: "",
        "strict-mcp-config": null,
      },
    },
  });

  // Claude without plan still explicitly disables all built-in tools and MCP servers.
  const claudeNoModes = resolveStarterHelperSafetyConfig({
    provider: "claude",
    availableModes: [],
  });
  expect(claudeNoModes).toStrictEqual({
    allowed: true,
    options: {
      extraArgs: {
        tools: "",
        "strict-mcp-config": null,
      },
    },
  });

  // Non-Claude providers prefer read-only / plan modes when available and remain enabled.
  expect(resolveStarterHelperSafetyConfig({
      provider: "codex",
      availableModes: [{ id: "default" }, { id: "read-only" }, { id: "full-access" }],
    })).toStrictEqual({ allowed: true, modeId: "read-only" });
  expect(resolveStarterHelperSafetyConfig({
      provider: "opencode",
      availableModes: [
        { id: "https://agentclientprotocol.com/protocol/session-modes#agent" },
        { id: "https://agentclientprotocol.com/protocol/session-modes#plan" },
      ],
    })).toStrictEqual({
      allowed: true,
      modeId: "https://agentclientprotocol.com/protocol/session-modes#plan",
    });
  expect(resolveStarterHelperSafetyConfig({
      provider: "codex",
      availableModes: [{ id: "default" }, { id: "auto" }, { id: "full-access" }],
    })).toStrictEqual({ allowed: true });
  expect(resolveStarterHelperSafetyConfig({
      provider: "custom-acp",
      availableModes: [],
    })).toStrictEqual({ allowed: true });
});
