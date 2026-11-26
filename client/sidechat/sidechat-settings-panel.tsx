import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { Text } from "react-native";
import { PlainButton, Section, SectionNote, Segmented, SettingRow, Toggle, settingsTextStyle, type PageLook } from "../settings-controls";
import { DEFAULT_SIDECHAT_SETTINGS, sidechatSettings, type SidechatSettingsValues } from "../../shared/sidechat/settings";
import { notifyComposerPillPreference } from "./handoff";
import { useMessages } from "./messages";
import { useHostAppearance } from "./web";

export function SidechatSettingsPanel({ look, theme }: { look: PageLook; theme: PluginTheme }) {
  const settings = useSettings(sidechatSettings);
  const appearance = useHostAppearance(theme);
  const { locale, t } = useMessages();
  const { tokens } = look;
  const values = settings.status === "ready" ? settings.values : DEFAULT_SIDECHAT_SETTINGS;
  const revision = settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  const disabled = settings.saving || settings.status !== "ready";
  const textStyle = [settingsTextStyle(tokens, -1), { color: tokens.foregroundMuted, fontFamily: tokens.fontUi }];

  const save = (patch: Partial<SidechatSettingsValues>) => {
    if (disabled || !revision) return;
    void settings.save({ ...values, ...patch }, revision).then((saved) => {
      if (saved && patch.showComposerPill !== undefined) notifyComposerPillPreference(patch.showComposerPill);
    });
  };

  const choices = <T extends string>(
    title: string,
    description: string,
    value: T,
    options: ReadonlyArray<{ label: string; value: T }>,
    onChange: (next: T) => void,
    first = false,
  ) => (
    <SettingRow first={first} title={title} description={description} look={look} stacked disabled={disabled}
      control={<Segmented label={title} look={look} value={value} options={options} onChange={onChange} disabled={disabled} contentWidth wrap={look.compact && options.length > 3} />} />
  );

  const switches = [
    { key: "inheritMainModel", label: "settingInheritModelLabel", hint: "settingInheritModelHint" },
    { key: "readOnlyGuard", label: "settingReadOnlyGuardLabel", hint: "settingReadOnlyGuardHint" },
    { key: "skipExternalMcp", label: "settingFastStartupLabel", hint: "settingFastStartupHint" },
    { key: "showComposerPill", label: "settingComposerPillLabel", hint: "settingComposerPillHint" },
  ] as const;

  const collapse = t(appearance.chatDisplay === "collapseTurns" ? "hostCollapseTurns" :
    appearance.chatDisplay === "collapseToolCalls" ? "hostCollapseTools" : "hostCollapseFull");
  const shortcut = t(appearance.sendShortcut === "mod-enter" ? "modEnterShortcut" : "enterShortcut");
  const sendBehavior = t(appearance.sendBehavior === "queue" ? "sendBehaviorQueue" :
    appearance.sendBehavior === "interrupt" ? "sendBehaviorInterrupt" : "sendBehaviorSteer");
  const sync = [
    { title: t("hostLanguageLabel"), value: locale },
    { title: t("hostThemeLabel"), value: `${appearance.themePreference} (${t(tokens.isDark ? "darkMode" : "lightMode")})` },
    { title: t("hostReasoningLabel"), value: t(appearance.autoExpandReasoning ? "hostReasoningExpanded" : "hostReasoningCollapsed") },
    { title: t("hostCollapseLabel"), value: collapse },
    { title: t("hostTypographyLabel"), value: t("hostTypographyValue", { content: tokens.typography.content.size, code: tokens.typography.mono.size, shortcut }) },
    { title: t("hostSendBehaviorLabel"), value: sendBehavior },
  ];
  const status = settings.status === "loading" ? look.t.syncLoading :
    settings.status === "error" || settings.status === "invalid" ? settings.error : settings.saveError;

  return (
    <>
      <Section title={t("settingsBehaviorSection")} look={look}>
        {status ? <SectionNote text={status} look={look} /> : null}
        {choices(t("settingContextModeLabel"), t("settingContextModeHint"), values.defaultContextMode, [
          { label: t("contextModeFirstTurn"), value: "first_turn" },
          { label: t("contextModeAlways"), value: "always" },
          { label: t("contextModeManual"), value: "manual" },
        ], (defaultContextMode) => save({ defaultContextMode }), true)}
        {choices(t("settingContextTurnsLabel"), t("settingContextTurnsHint"), String(values.contextTurns), [
          ...new Set([3, 6, 10, 20, values.contextTurns]),
        ].sort((a, b) => a - b).map((count) => ({ label: String(count), value: String(count) })),
        (count) => save({ contextTurns: Number(count) }))}
        {choices(t("settingDefaultModeLabel"), t("settingDefaultModeHint"), values.defaultPermissionMode, [
          { label: t("defaultModeInherit"), value: "inherit" },
          { label: t("defaultModeAuto"), value: "auto" },
          { label: t("defaultModePlan"), value: "plan" },
          { label: t("defaultModeAsk"), value: "default" },
          { label: t("defaultModeBypass"), value: "bypassPermissions" },
        ], (defaultPermissionMode) => save({ defaultPermissionMode }))}
        {switches.map(({ key, label, hint }) => (
          <SettingRow key={key} title={t(label)} description={t(hint)} look={look} disabled={disabled}
            control={<Toggle label={t(label)} value={values[key]} onChange={(value) => save({ [key]: value })} look={look} disabled={disabled} />} />
        ))}
        {choices(t("settingStarterModelLabel"), t("settingStarterModelHint"), values.starterModelMode, [
          { label: t("starterModelSmart"), value: "smart" },
          { label: t("starterModelInherit"), value: "inherit" },
          { label: t("starterModelFast"), value: "fast" },
          { label: t("starterModelOff"), value: "off" },
        ], (starterModelMode) => save({ starterModelMode }))}
        <SettingRow title={t("resetDefaultsLabel")} description={t("resetDefaultsHint")} look={look}
          control={<PlainButton label={t("resetAction")} look={look} disabled={!revision || settings.saving} onPress={() => {
            void settings.reset().then((saved) => {
              if (saved) notifyComposerPillPreference(DEFAULT_SIDECHAT_SETTINGS.showComposerPill);
            });
          }} />} />
      </Section>
      <Section title={t("settingsHostSyncSection")} look={look}>
        {sync.map(({ title, value }, index) => (
          <SettingRow key={title} title={title} first={index === 0} look={look} control={<Text style={textStyle}>{value}</Text>} />
        ))}
      </Section>
    </>
  );
}
