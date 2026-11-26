import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../helpers/quiet-renderer";

const mocks = vi.hoisted(() => ({
  save: vi.fn(async () => true),
  reset: vi.fn(async () => true),
  reveal: vi.fn(async () => ({ revealed: "/work/example.ts", error: null })),
}));

vi.mock("react-native", () => import("../helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", async () => {
  const { DEFAULT_SIDECHAT_SETTINGS } = await import("../../../shared/sidechat/settings");
  const rpc = async () => ({ state: "idle", entries: [], error: null });
  return {
    useAgent: () => "/work",
    useRpc: (contract: { name: string }) => contract.name === "file.reveal" ? mocks.reveal : rpc,
    useSettings: () => ({ status: "ready", revision: "r1", saving: false, values: DEFAULT_SIDECHAT_SETTINGS, save: mocks.save, reset: mocks.reset }),
  };
});
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const rn = await import("../helpers/rn-mock");
  return { Icon: rn.View, ScrollView: rn.ScrollView, TextInput: rn.TextInput, useToast: () => ({ show() {}, error() {} }) };
});
vi.mock("../../../client/tasks/chunk/load", () => ({ TasksSettingsPanel: () => null }));
vi.mock("../../../client/state/preference-sync-slot", () => ({ usePreferenceSettings: () => ({ status: "ready", failed: false }) }));
vi.mock("../../../client/ui/wide-host-column", () => ({ useWideHostColumn() {} }));
vi.mock("../../../client/settings-preview", () => ({ SettingsPreview: () => null }));
vi.mock("../../../client/sidechat/external-timeline-plugins", () => ({ ExternalPluginTimelineItemView: () => null }));
vi.mock("../../../client/components/markdown/markdown-view", () => ({ MarkdownView: () => null }));
vi.mock("../../../client/components/tool-callouts", () => ({ ToolCallout: () => null }));
vi.mock("../../../client/components/reasoning-trace", () => ({ ReasoningCard: () => null }));
vi.mock("../../../client/components/task-list", () => ({ TaskList: () => null }));
vi.mock("../../../client/components/notice-callout", () => ({ NoticeCallout: () => null }));

import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { MarkdownView } from "../../../client/components/markdown/markdown-view";
import { resetEnhancerPreferences, updateEnhancerPreferences } from "../../../client/preferences";
import { BetterPaseoSettingsPage } from "../../../client/settings-page";
import { setSettingsTab } from "../../../client/settings-tab";
import { subscribeComposerPillPreference } from "../../../client/sidechat/handoff";
import { SidechatSettingsPanel } from "../../../client/sidechat/sidechat-settings-panel";
import { SidechatTimelineRowView } from "../../../client/sidechat/timeline-views";
import { parseHostAppearanceSettings } from "../../../shared/sidechat/appearance";
import { en } from "../../../shared/sidechat/messages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const host = { id: "host", label: "Test host" };
const theme: PluginSurfaceProps["theme"] = { colors: {
  surface0: "#ffffff", surface1: "#f6f6f7", surface2: "#ededef", border: "#e2e2e6",
  foreground: "#18181b", foregroundMuted: "#62626b", accent: "#2563eb", accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b", statusWarning: "#a36a00", statusDanger: "#d92d20",
} };
let renderer: ReturnType<typeof TestRenderer.create> | undefined;

afterEach(() => {
  if (renderer) act(() => renderer?.unmount());
  renderer = undefined;
  setSettingsTab("display");
  resetEnhancerPreferences();
  vi.clearAllMocks();
});

describe("Sidechat's shared presentation", () => {
  it("opens the fourth settings section from the common tab bar and updates the composer pill", async () => {
    updateEnhancerPreferences({ language: "en" });
    const listener = vi.fn();
    const unsubscribe = subscribeComposerPillPreference(listener);
    try {
      act(() => {
        renderer = TestRenderer.create(<BetterPaseoSettingsPage theme={theme} host={host} layout={{ platform: "web", compact: false }} />);
      });
      const press = (label: string, role: string) => {
        const control = renderer!.root.findAll((el) => (
          typeof el.type === "string" && el.props.accessibilityRole === role && el.props.accessibilityLabel === label
        ))[0];
        expect(control).toBeDefined();
        control!.props.onPress();
      };
      act(() => press("Sidechat", "radio"));
      expect(renderer!.root.findAllByType(SidechatSettingsPanel)).toHaveLength(1);
      await act(async () => press(en.settingComposerPillLabel, "switch"));
      expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ showComposerPill: false }), "r1");
      expect(listener).toHaveBeenCalledWith(false);
      act(() => updateEnhancerPreferences({ language: "zh" }));
      expect(renderer!.root.findAll((el) => el.props.accessibilityLabel === "侧边对话").length).toBeGreaterThan(0);
    } finally {
      unsubscribe();
    }
  });

  it.each([{ platform: "web", compact: false }, { platform: "ios", compact: true }] as const)(
    "renders streaming formulas with the shared Markdown view on $platform",
    async (layout) => {
      const text = "Inline $x^2$\n\n$$\ny=2x\n$$\n\n| formula |\n| --- |\n| $z$ |";
      updateEnhancerPreferences({ accent: "jade" });
      act(() => {
        renderer = TestRenderer.create(<SidechatTimelineRowView
          row={{ kind: "assistant_message", id: "row", questionText: null, showActions: false,
            item: { kind: "assistant_message", id: "row", text, streaming: true, timestamp: "2026-11-26T00:00:00Z" } }}
          agentId="side-agent" cwd="/workspace" host={host} layout={layout} theme={theme}
          appearance={parseHostAppearanceSettings(null)} compact={layout.compact} locale="en"
          t={(key) => en[key]} externalPlugins={[]} canInsertToMain={false} canSendToMain={false}
          onToggleItem={() => {}} onToggleGroup={() => {}} onInsertToMain={() => {}} onSendToMain={() => {}}
        />);
      });
      const markdown = renderer!.root.findByType(MarkdownView);
      expect(markdown.props).toMatchObject({ text, renderMath: true, streaming: true, compact: layout.compact });
      expect(markdown.props.tokens.accent).toBe("#10b981");
      await act(async () => { markdown.props.onRevealPath("example.ts"); });
      expect(mocks.reveal).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/work", path: "example.ts" }));
    },
  );
});
