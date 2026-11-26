import type { ExtendedThemeTokens } from "../components/theme-tokens";
import type { HostAppearanceSettings } from "../../shared/sidechat/appearance";

export function sidechatColors(tokens: ExtendedThemeTokens) {
  return {
    surface0: tokens.v2.surface0,
    surface1: tokens.v2.surface1,
    surface2: tokens.v2.surface2,
    foreground: tokens.foreground,
    foregroundMuted: tokens.foregroundMuted,
    accent: tokens.accent,
    accentForeground: tokens.accentForeground,
    border: tokens.v2.border,
    borderSubtle: tokens.v2.borderSubtle,
    statusWarning: tokens.warning,
    statusDanger: tokens.danger,
    statusSuccess: tokens.success,
  };
}

export function sidechatAppearance(host: HostAppearanceSettings, tokens: ExtendedThemeTokens): HostAppearanceSettings {
  const { content, mono, ui } = tokens.typography;
  return {
    ...host,
    uiBaseFontSize: ui.size,
    contentFontSize: content.size,
    contentLineHeight: content.lineHeight,
    composerLineHeight: content.lineHeight,
    monoFontFamily: tokens.fontMono,
    codeFontSize: mono.size,
    codeLineHeight: mono.lineHeight,
  };
}
