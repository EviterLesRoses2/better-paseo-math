import { expect, it } from "vitest";
import { defineSidechatMessages } from "../../../client/sidechat/messages";
import { formatTransferToMainPrompt } from "../../../shared/sidechat/context";
import { allLocaleResources, formatWorkSummaryLabel } from "../../../shared/sidechat/messages";

const PASEO_SUPPORTED_LANGUAGES = [
  "en",
  "zh-CN",
  "ja",
  "ko",
  "es",
  "fr",
  "pt-BR",
  "ru",
  "ar",
] as const;

it("defineTranslations validates all Paseo built-in languages and placeholders", () => {
  const messages = defineSidechatMessages();
  for (const lang of PASEO_SUPPORTED_LANGUAGES) {
    expect(lang in messages.resources, `Missing Paseo language resource: ${lang}`).toBeTruthy();
    expect(lang in allLocaleResources, `Missing locale table: ${lang}`).toBeTruthy();
  }
});

it("formatWorkSummaryLabel and formatTransferToMainPrompt localize across Paseo languages", () => {
  const counts = {
    thoughtCount: 1,
    readFileCount: 2,
    editedFileCount: 0,
    commandCount: 1,
    searchCount: 0,
    otherToolCount: 0,
  };

  expect(formatWorkSummaryLabel(counts, "zh-CN")).toMatch(/思考 1 次 · 读取 2 个文件 · 执行 1 条命令/);
  expect(formatWorkSummaryLabel(counts, "ja")).toMatch(/思考 1回 · 2 件のファイルを読込/);
  expect(formatWorkSummaryLabel(counts, "ko")).toMatch(/사고 1회 · 파일 2개 읽음/);
  expect(formatWorkSummaryLabel(counts, "en")).toMatch(/Thought 1x · Read 2 files · Ran 1 command/);

  const jaTransfer = formatTransferToMainPrompt({
    question: "なぜ再レンダリングされる？",
    answer: "参照が毎回変わるためです。",
    mode: "send",
    locale: "ja",
  });
  expect(jaTransfer).toMatch(/サイドチャットの結論/);
});
