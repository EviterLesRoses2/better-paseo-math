import { expect, it } from "vitest";
import { findSvgIconProblem } from "@getpaseo/plugin";
import {
  buildContextRingSvg,
  BUILTIN_PROVIDER_SVGS,
  CLAUDE_ICON_SVG,
  CODEX_ICON_SVG,
  formatContextUsageSummary,
  formatPaseoTokenCount,
  formatProviderLabel,
  formatSessionCostUsd,
  formatShortModelLabel,
  formatShortModeLabel,
  formatShortThinkingLabel,
  formatUsageResetCountdown,
  resolveContextUsageRatio,
  resolveEffectiveProviderMode,
  resolveModeIconName,
  resolveProviderIconSvg,
  resolveToolbarDensity,
  resolveUsageWindowMetrics,
} from "../../../shared/sidechat/composer-controls";
import { sidechatSettings } from "../../../shared/sidechat/settings";

it("All builtin provider SVGs and buildContextRingSvg pass Paseo inline SVG validation", () => {
  for (const [providerId, svg] of Object.entries(BUILTIN_PROVIDER_SVGS)) {
    expect(findSvgIconProblem(svg), `Expected builtin SVG for ${providerId} to pass findSvgIconProblem`).toBe(null);
  }

  const ringSvg = buildContextRingSvg({
    ratio: 0.25,
    trackColor: "#52525b",
    progressColor: "#a1a1aa",
  });
  expect(findSvgIconProblem(ringSvg)).toBe(null);

  const sanitizedRingSvg = buildContextRingSvg({
    ratio: 0.5,
    trackColor: '" onload="alert(1)',
    progressColor: "javascript:void(0)",
  });
  expect(findSvgIconProblem(sanitizedRingSvg)).toBe(null);
});

it("resolveProviderIconSvg and formatProviderLabel support builtin and custom ACP providers", () => {
  expect(resolveProviderIconSvg("claude")).toBe(CLAUDE_ICON_SVG);
  expect(resolveProviderIconSvg("codex")).toBe(CODEX_ICON_SVG);
  expect(resolveProviderIconSvg("kimi-custom")).toBeTruthy();

  const customValidSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg>';
  expect(resolveProviderIconSvg("my-custom-acp", customValidSvg)).toBe(customValidSvg);
  expect(resolveProviderIconSvg("my-custom-acp", "<script>bad()</script>")).toBe(null);

  expect(formatProviderLabel("codex")).toBe("Codex");
  expect(formatProviderLabel("copilot")).toBe("GitHub Copilot");
  expect(formatProviderLabel("kimi", "Kimi Code CLI")).toBe("Kimi Code CLI");
  expect(formatProviderLabel("my-acp-agent")).toBe("My Acp Agent");
});

it("formatShortModelLabel strips redundant provider prefixes across Claude, OpenAI, and Copilot", () => {
  expect(formatShortModelLabel("Claude Opus 5.5")).toBe("Opus 5.5");
  expect(formatShortModelLabel("OpenAI GPT-5.4")).toBe("GPT-5.4");
  expect(formatShortModelLabel("GitHub Copilot GPT-5")).toBe("GPT-5");
  expect(formatShortModelLabel("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
  expect(formatShortModelLabel("claude-opus-4-20250514")).toBe("Opus 4");
  expect(formatShortModelLabel("Kimi K2.5")).toBe("Kimi K2.5");
  expect(formatShortModelLabel(null, "Model")).toBe("Model");
});

it("resolveEffectiveProviderMode maps permission preferences safely across Claude, Codex, Copilot, OpenCode, and zero-mode providers", () => {
  // Codex modes (`auto`, `auto-review`, `full-access`)
  const codexModes = [{ id: "auto" }, { id: "auto-review" }, { id: "full-access" }];
  expect(resolveEffectiveProviderMode({
      provider: "codex",
      defaultPermissionMode: "bypassPermissions",
      availableModes: codexModes,
      providerDefaultModeId: "auto",
    })).toBe("full-access");
  expect(resolveEffectiveProviderMode({
      provider: "codex",
      defaultPermissionMode: "plan",
      availableModes: codexModes,
      providerDefaultModeId: "auto",
    })).toBe("auto");

  // Copilot modes (`#agent`, `#plan`, `allow-all`)
  const copilotModes = [
    { id: "https://agentclientprotocol.com/protocol/session-modes#agent" },
    { id: "https://agentclientprotocol.com/protocol/session-modes#plan" },
    { id: "allow-all" },
  ];
  expect(resolveEffectiveProviderMode({
      provider: "copilot",
      defaultPermissionMode: "plan",
      availableModes: copilotModes,
    })).toBe("https://agentclientprotocol.com/protocol/session-modes#plan");

  // Zero-mode custom ACP provider returns undefined so agents.create omits unsupported modeId
  expect(resolveEffectiveProviderMode({
      provider: "kimi",
      defaultPermissionMode: "auto",
      availableModes: [],
    })).toBe(undefined);
});

it("sidechatSettings v3 migration preserves full main-session MCP tools and permission inheritance", () => {
  const fromV1Default = sidechatSettings.migrate?.(
    {
      defaultContextMode: "first_turn",
      contextTurns: 6,
      defaultClaudeMode: "auto",
      fastStartup: true,
    },
    1,
  ) as Record<string, unknown>;
  expect(fromV1Default.defaultPermissionMode).toBe("inherit");
  expect(fromV1Default.skipExternalMcp).toBe(false);
  expect(fromV1Default.inheritMainModel).toBe(true);

  const fromV2ExplicitPlan = sidechatSettings.migrate?.(
    {
      defaultContextMode: "always",
      contextTurns: 10,
      defaultPermissionMode: "plan",
      fastStartup: true,
      readOnlyGuard: false,
    },
    2,
  ) as Record<string, unknown>;
  expect(fromV2ExplicitPlan.defaultPermissionMode).toBe("plan");
  expect(fromV2ExplicitPlan.skipExternalMcp).toBe(false);
  expect(fromV2ExplicitPlan.defaultContextMode).toBe("always");
  expect(fromV2ExplicitPlan.readOnlyGuard).toBe(false);
});

it("formatShortThinkingLabel and mode helpers match Paseo composer toolbar labels & icons", () => {
  expect(formatShortThinkingLabel("low")).toBe("Low");
  expect(formatShortThinkingLabel("Medium thinking")).toBe("Medium");
  expect(formatShortThinkingLabel("High effort")).toBe("High");

  expect(resolveModeIconName("bypassPermissions")).toBe("ShieldOff");
  expect(resolveModeIconName("full-access")).toBe("ShieldOff");
  expect(resolveModeIconName("custom-mode", "ShieldAlert")).toBe("ShieldAlert");

  expect(formatShortModeLabel("bypassPermissions", "Bypass")).toBe("Bypass");
  expect(formatShortModeLabel("auto", "Default Permissions")).toBe("Default");
  expect(formatShortModeLabel("auto", "Auto mode")).toBe("Auto");
  expect(formatShortModeLabel("full-access", "Full Access")).toBe("Full Access");
});

it("resolveContextUsageRatio, formatContextUsageSummary, and resolveToolbarDensity work accurately", () => {
  const active = resolveContextUsageRatio({
    contextWindowUsedTokens: 48_000,
    contextWindowMaxTokens: 200_000,
    totalCostUsd: 0.145,
  });
  expect(active.ratio).toBe(0.24);
  expect(formatContextUsageSummary({
      contextWindowUsedTokens: 48_000,
      contextWindowMaxTokens: 200_000,
      totalCostUsd: 0.145,
    })).toBe("Context: 48k / 200k (24%) · $0.14");
  expect(resolveToolbarDensity(480, false)).toBe("full");
  expect(resolveToolbarDensity(390, false)).toBe("condensed");
  expect(resolveToolbarDensity(320, false)).toBe("iconOnly");
});

it("Paseo context window popover token, cost, quota bar, and reset countdown formatters match Paseo", () => {
  expect(formatPaseoTokenCount(75_200)).toBe("75k");
  expect(formatPaseoTokenCount(1_000_000)).toBe("1m");
  expect(formatPaseoTokenCount(850)).toBe("850");

  expect(formatSessionCostUsd(1.3)).toBe("$1.30");
  expect(formatSessionCostUsd(0.0042)).toBe("$0.0042");
  expect(formatSessionCostUsd(0)).toBe(null);

  const rem = resolveUsageWindowMetrics(
    { usedPct: 14, remainingPct: 86, tone: "ok" },
    "remaining",
  );
  expect(rem.displayPercent).toBe(86);
  expect(rem.barPercent).toBe(86);
  expect(rem.severity).toBe("ok");

  const usedWarn = resolveUsageWindowMetrics(
    { usedPct: 78, remainingPct: 22 },
    "used",
  );
  expect(usedWarn.displayPercent).toBe(78);
  expect(usedWarn.severity).toBe("warning");

  const nowMs = Date.parse("2026-11-21T03:22:00Z");
  const shortReset = formatUsageResetCountdown("2026-11-21T05:30:30Z", nowMs, "en");
  expect(shortReset?.countdown).toBe("2h 8m");

  const multiDayReset = formatUsageResetCountdown("2026-11-26T22:30:00Z", nowMs, "en");
  expect(multiDayReset?.countdown).toBe("5d 19h");
});
