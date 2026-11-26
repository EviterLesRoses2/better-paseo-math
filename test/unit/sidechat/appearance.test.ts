import { expect, it } from "vitest";
import {
  deriveSidechatPalette,
  isDarkSurface,
  isSafeFontFamily,
  parseHostAppearanceSettings,
} from "../../../shared/sidechat/appearance";

it("parseHostAppearanceSettings matches Paseo defaults when storage is empty", () => {
  const settings = parseHostAppearanceSettings(null);
  expect(settings.autoExpandReasoning).toBe(false);
  expect(settings.chatDisplay).toBe("collapseTurns");
  expect(settings.chatOutlineEnabled).toBe(true);
  expect(settings.uiBaseFontSize).toBe(13);
  expect(settings.contentFontSize).toBe(14);
  expect(settings.composerLineHeight).toBe(19.6);
  expect(settings.contentMaxWidth).toBe(820);
  expect(settings.codeFontSize).toBe(12);
  expect(settings.sendShortcut).toBe("enter");
  expect(settings.sendBehavior).toBe("steer");
});

it("parseHostAppearanceSettings honors explicit thinking, collapse, and font settings", () => {
  const settings = parseHostAppearanceSettings({
    autoExpandReasoning: true,
    chatDisplay: "collapseToolCalls",
    chatOutlineEnabled: false,
    monoFontFamily: "'JetBrains Mono', Menlo, monospace",
    uiBaseFontSize: 15,
    contentFontSize: 16,
    contentMaxWidth: 960,
    codeFontSize: 14,
    sendShortcut: "mod-enter",
    sendBehavior: "interrupt",
    theme: "claude",
  });
  expect(settings.autoExpandReasoning).toBe(true);
  expect(settings.chatDisplay).toBe("collapseToolCalls");
  expect(settings.chatOutlineEnabled).toBe(false);
  expect(settings.monoFontFamily).toBe("'JetBrains Mono', Menlo, monospace");
  expect(settings.uiBaseFontSize).toBe(15);
  expect(settings.contentFontSize).toBe(16);
  expect(settings.composerLineHeight).toBe(22.4);
  expect(settings.contentMaxWidth).toBe(960);
  expect(settings.codeFontSize).toBe(14);
  expect(settings.sendShortcut).toBe("mod-enter");
  expect(settings.sendBehavior).toBe("interrupt");
  expect(settings.themePreference).toBe("claude");
});

it("parseHostAppearanceSettings migrates legacy toolCallDetailLevel and compactToolCalls", () => {
  const fromConcise = parseHostAppearanceSettings({ toolCallDetailLevel: "concise" });
  expect(fromConcise.chatDisplay).toBe("collapseToolCalls");

  const fromDetailed = parseHostAppearanceSettings({ toolCallDetailLevel: "detailed" });
  expect(fromDetailed.chatDisplay).toBe("full");

  const fromCompact = parseHostAppearanceSettings({ compactToolCalls: true });
  expect(fromCompact.chatDisplay).toBe("collapseToolCalls");
});

it("isSafeFontFamily rejects unsafe CSS injection strings", () => {
  expect(isSafeFontFamily("SF Mono, Menlo, monospace")).toBe(true);
  expect(isSafeFontFamily("bad; color: red}")).toBe(false);
  expect(isSafeFontFamily("'unbalanced quote")).toBe(false);
});

it("isDarkSurface and deriveSidechatPalette adapt across dark and light Paseo themes", () => {
  expect(isDarkSurface("#09090b")).toBe(true);
  expect(isDarkSurface("#ffffff")).toBe(false);
  expect(isDarkSurface("rgb(248, 250, 252)")).toBe(false);

  const lightPalette = deriveSidechatPalette({
    surface0: "#ffffff",
    surface1: "#f4f4f5",
    surface2: "#e4e4e7",
    border: "#d4d4d8",
    foreground: "#18181b",
    foregroundMuted: "#71717a",
    accent: "#d97757",
    accentForeground: "#ffffff",
    statusSuccess: "#16a34a",
    statusWarning: "#d97706",
    statusDanger: "#dc2626",
  });
  expect(lightPalette.dark).toBe(false);
  expect(lightPalette.userBubbleBg).toMatch(/^#[0-9a-f]{6}$/);
  expect(lightPalette.borderAccent).toMatch(/^#[0-9a-f]{6}$/);
  expect(lightPalette.foregroundExtraMuted).toMatch(/^#[0-9a-f]{6}$/);

  const darkPalette = deriveSidechatPalette({
    surface0: "#18181b",
    surface1: "#1f1f22",
    surface2: "#27272a",
    border: "#27272a",
    foreground: "#e4e4e7",
    foregroundMuted: "#a1a1aa",
    accent: "#e4e4e7",
    accentForeground: "#18181b",
    statusSuccess: "#16a34a",
    statusWarning: "#d97706",
    statusDanger: "#dc2626",
  });
  expect(darkPalette.dark).toBe(true);
  expect(darkPalette.borderAccent).toBe("#303033");
  expect(darkPalette.foregroundExtraMuted).toMatch(/^#[0-9a-f]{6}$/);
});
