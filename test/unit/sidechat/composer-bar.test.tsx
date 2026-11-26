import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TestRenderer, { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../helpers/quiet-renderer";

vi.mock("react-native", () => import("../helpers/rn-mock"));
vi.mock("@getpaseo/plugin/client", () => ({
  openExternalUrl: vi.fn(async () => {}),
  useRpc: () => async () => ({}),
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const rn = await import("../helpers/rn-mock");
  const Modal = Object.assign(
    ({ open, children }: { open: boolean; children?: React.ReactNode }) => (open ? React.createElement("Modal", null, children) : null),
    { Content: rn.View },
  );
  return {
    Icon: (props: Record<string, unknown>) => React.createElement("Icon", props),
    Modal,
    ScrollView: rn.ScrollView,
    TextInput: rn.TextInput,
    useToast: () => ({ show() {}, error() {} }),
  };
});

import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { buildThemeTokens } from "../../../client/components/theme-tokens";
import { SidechatComposerBar } from "../../../client/sidechat/composer-bar";
import { sidechatAppearance } from "../../../client/sidechat/design";
import { parseHostAppearanceSettings } from "../../../shared/sidechat/appearance";
import { ANTIGRAVITY_ICON_SVG } from "../../../shared/sidechat/composer-controls";
import { en } from "../../../shared/sidechat/messages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const themeColors: PluginSurfaceProps["theme"]["colors"] = {
  surface0: "#ffffff",
  surface1: "#f6f6f7",
  surface2: "#ededef",
  border: "#e2e2e6",
  foreground: "#18181b",
  foregroundMuted: "#62626b",
  accent: "#2563eb",
  accentForeground: "#ffffff",
  statusSuccess: "#1f8a5b",
  statusWarning: "#a36a00",
  statusDanger: "#d92d20",
};

let renderer: ReturnType<typeof TestRenderer.create> | undefined;
let queryClient: QueryClient | undefined;

afterEach(() => {
  if (renderer) act(() => renderer?.unmount());
  renderer = undefined;
  queryClient?.clear();
  queryClient = undefined;
  delete (globalThis as { __rnMockOS?: string }).__rnMockOS;
  vi.clearAllMocks();
});

function renderComposer(panelWidth: number) {
  (globalThis as { __rnMockOS?: string }).__rnMockOS = "web";
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  const tokens = buildThemeTokens(themeColors, undefined, { platform: "web" });
  const appearance = sidechatAppearance(parseHostAppearanceSettings(null), tokens);

  act(() => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={queryClient!}>
        <SidechatComposerBar
          hostId="host"
          cwd=""
          activeSideAgentId={null}
          mainAgentId="main-1"
          locale="en"
          tokens={tokens}
          appearance={appearance}
          panelWidth={panelWidth}
          isTouch={false}
          t={(key) => en[key]}
          draft=""
          onChangeDraft={() => {}}
          onSubmit={() => {}}
          onStop={() => {}}
          onClientCommand={() => {}}
          isBusy={false}
          canSubmit={false}
          effectiveSendBehavior="steer"
          queuedMessages={[]}
          onEditQueuedMessage={() => {}}
          onSendQueuedNow={() => {}}
          shortcutLabel="Enter"
          attachments={[]}
          onChangeAttachments={() => {}}
          hasMainAgent
          shouldAttachMainContext
          isAutoFirstTurnContext
          onToggleMainContext={() => {}}
          onPreviewMainContext={() => {}}
          candidateSelection={null}
          attachedQuote={null}
          onAttachCandidateSelection={() => {}}
          onClearQuote={() => {}}
          effectiveProvider="antigravity"
          effectiveModelId="gemini-4-hybrid"
          effectiveThinkingId="xhigh"
          providerIconSvg={null}
          selectedModelRawLabel="Gemini 4 Hybrid"
          modelMaxTokens={200_000}
          modelMenuOptions={[{ id: "antigravity/gemini-4-hybrid", label: "Gemini 4 Hybrid", selected: true, onSelect() {} }]}
          selectedThinkingRawLabel="XHigh"
          thinkingMenuOptions={[{ id: "xhigh", label: "XHigh", selected: true, onSelect() {} }]}
          effectiveModeId="full-access"
          selectedModeRawLabel="Full Access"
          selectedModeIconName={null}
          modeMenuOptions={[{ id: "full-access", label: "Full Access", selected: true, onSelect() {} }]}
          optionControls={[
            {
              type: "select",
              key: "sandbox",
              label: "Sandbox",
              icon: "Shield",
              defaultValue: "workspace",
              choices: [{ value: "workspace", label: "Workspace" }],
            },
          ]}
          effectiveOptions={{ sandbox: "workspace" }}
          onSetOption={() => {}}
          lastUsage={null}
        />
      </QueryClientProvider>,
    );
  });

  return renderer!;
}

function getToolbarSnapshot(tree: ReturnType<typeof TestRenderer.create>) {
  const toolbar = tree.root.findByProps({ testID: "sidechat-composer-toolbar" });
  const texts = toolbar.findAll((node) => String(node.type) === "Text").map((node) => {
    const child = node.props.children;
    return Array.isArray(child) ? child.join("") : String(child ?? "");
  });
  const icons = toolbar.findAll((node) => String(node.type) === "Icon").map((node) => ({
    name: node.props.name as string | undefined,
    svg: (node.props.icon as { svg?: string } | undefined)?.svg,
  }));
  return { toolbar, texts, icons };
}

describe("SidechatComposerBar responsive toolbar", () => {
  it("renders only icons (company SVG for model, icons for mode/thinking/options) when narrow and reveals labels one by one on resize", () => {
    // 345px matches a tight right-hand Sidechat panel (~293px toolbar row)
    const tree = renderComposer(345);

    // Stage 0: narrow => zero text labels and zero dropdown carets in the toolbar
    const narrow = getToolbarSnapshot(tree);
    expect(narrow.texts).toEqual([]);
    expect(narrow.icons.some((icon) => icon.svg === ANTIGRAVITY_ICON_SVG)).toBe(true);
    expect(narrow.icons.some((icon) => icon.name === "Brain")).toBe(true);
    expect(narrow.icons.some((icon) => icon.name === "ShieldOff")).toBe(true);
    expect(narrow.icons.some((icon) => icon.name === "ChevronDown")).toBe(false);

    // Stage 1: resize wider => model label reveals first; permission & thinking stay icons
    act(() => {
      narrow.toolbar.props.onLayout({ nativeEvent: { layout: { width: 380 } } });
    });
    const stage1 = getToolbarSnapshot(tree);
    expect(stage1.texts).toEqual(["Gemini 4 Hybrid"]);
    expect(stage1.icons.filter((icon) => icon.name === "ChevronDown")).toHaveLength(1);

    // Stage 2: wider still => permission mode label reveals next
    act(() => {
      narrow.toolbar.props.onLayout({ nativeEvent: { layout: { width: 520 } } });
    });
    const stage2 = getToolbarSnapshot(tree);
    expect(stage2.texts).toEqual(["Gemini 4 Hybrid", "Full Access"]);
    expect(stage2.icons.filter((icon) => icon.name === "ChevronDown")).toHaveLength(2);

    // Stage 3: wider still => thinking effort label reveals next
    act(() => {
      narrow.toolbar.props.onLayout({ nativeEvent: { layout: { width: 600 } } });
    });
    const stage3 = getToolbarSnapshot(tree);
    expect(stage3.texts).toEqual(["Gemini 4 Hybrid", "XHigh", "Full Access"]);
    expect(stage3.icons.filter((icon) => icon.name === "ChevronDown")).toHaveLength(3);

    // Stage 4: extra wide => provider select option label reveals last
    act(() => {
      narrow.toolbar.props.onLayout({ nativeEvent: { layout: { width: 720 } } });
    });
    const stage4 = getToolbarSnapshot(tree);
    expect(stage4.texts).toEqual(["Gemini 4 Hybrid", "XHigh", "Full Access", "Workspace"]);
    expect(stage4.icons.filter((icon) => icon.name === "ChevronDown")).toHaveLength(4);
  });
});
