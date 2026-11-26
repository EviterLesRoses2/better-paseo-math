import { useCallback } from "react";
import * as pluginClient from "@getpaseo/plugin/client";
import { allLocaleResources, resolveLocaleTable } from "../../shared/sidechat/messages";
import { getEnhancerPreferences, useEnhancerPreferences } from "../preferences";
import { deviceLocales, hostLanguageSetting, useHostLanguageVersion } from "../i18n/host-language";

export function defineSidechatMessages() {
  return pluginClient.defineTranslations({ resources: allLocaleResources });
}

let hostMessages: ReturnType<typeof defineSidechatMessages> | undefined;

function messages() {
  if ("defineTranslations" in pluginClient && typeof pluginClient.defineTranslations === "function") {
    hostMessages ??= defineSidechatMessages();
  }
  return hostMessages;
}

type MessageKey = keyof ReturnType<typeof resolveLocaleTable>;

type ContributionLabel = "panelTitle" | "workspacePanelTitle" | "openSidechat" | "newSidechat" |
  "slashDescription" | "slashHint" | "pillLabel";

export function sidechatLabel(key: ContributionLabel) {
  const { language } = getEnhancerPreferences();
  if (language !== "system") return resolveLocaleTable(language)[key];
  return messages()?.message(key) ?? resolveLocaleTable(fallbackHostLocale())[key];
}

function fallbackHostLocale(): string {
  const setting = hostLanguageSetting();
  return typeof setting === "string" && setting !== "system" && setting !== "auto"
    ? setting
    : deviceLocales()[0] ?? "en";
}

export function useMessages() {
  const { language } = useEnhancerPreferences();
  useHostLanguageVersion();
  const definition = messages();
  // SDK capabilities are fixed for the lifetime of the host.
  const host = definition && "useTranslation" in pluginClient ? pluginClient.useTranslation(definition) : null;
  const locale = language === "system" ? host?.locale ?? fallbackHostLocale() : language;
  const table = resolveLocaleTable(locale);
  const t = useCallback((key: MessageKey, values?: Record<string, string | number>) => (
    table[key].replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => String(values?.[name] ?? placeholder))
  ), [table]);
  return { locale, t };
}
