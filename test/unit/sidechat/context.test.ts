import { expect, it } from "vitest";
import {
  buildMainContextDigest,
  composeSidechatPrompt,
  deriveThreadTitle,
  formatTransferToMainPrompt,
  parseSidechatUserMessage,
} from "../../../shared/sidechat/context";

it("composeSidechatPrompt and parseSidechatUserMessage round-trip cleanly", () => {
  const composed = composeSidechatPrompt({
    text: "Is there a race condition in this retry loop?",
    mainContext: "Main session: Refactor retry (claude/claude-sonnet-4-5)",
    quotedSelection: "while (attempts < 3) { await retry(); }",
  });

  const parsed = parseSidechatUserMessage(composed);
  expect(parsed.body).toBe("Is there a race condition in this retry loop?");
  expect(parsed.mainContext).toBe("Main session: Refactor retry (claude/claude-sonnet-4-5)");
  expect(parsed.quotedSelection).toBe("while (attempts < 3) { await retry(); }");
});

it("buildMainContextDigest summarizes recent turns and touched files", () => {
  const digest = buildMainContextDigest({
    agentId: "main-1",
    title: "Implement Sidechat",
    provider: "claude",
    model: "claude-sonnet-4-5",
    cwd: "/repo",
    status: "running",
    maxTurns: 4,
    entries: [
      {
        item: { type: "user_message", text: "Add sidechat support" },
      },
      {
        item: {
          type: "tool_call",
          callId: "tc1",
          name: "Edit",
          status: "completed",
          error: null,
          detail: { type: "edit", filePath: "client/sidechat-panel.tsx" },
        },
      },
      {
        item: { type: "assistant_message", text: "Updated the panel layout." },
      },
    ],
  });

  expect(digest.turnCount).toBe(1);
  expect(digest.touchedFiles).toStrictEqual(["client/sidechat-panel.tsx"]);
  expect(digest.digest).toMatch(/Implement Sidechat/);
  expect(digest.digest).toMatch(/client\/sidechat-panel\.tsx/);
});

it("formatTransferToMainPrompt localizes Chinese and English handoffs", () => {
  const zhPrompt = formatTransferToMainPrompt({
    question: "为什么这里会死锁？",
    answer: "因为持锁顺序相反。",
    mode: "send",
    locale: "zh-CN",
  });
  expect(zhPrompt).toMatch(/来自侧边聊天/);
  expect(zhPrompt).toMatch(/因为持锁顺序相反/);

  expect(deriveThreadTitle("   Explain   how   Paseo   plugins   work   ")).toBe("Explain how Paseo plugins work");
});
