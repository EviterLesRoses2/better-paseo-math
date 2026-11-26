import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ForkOrigin } from "../../shared/conversation-actions-rpc";
import { conversationStrings } from "../i18n/conversation-strings";
import { resolveLanguage } from "../i18n/settings-strings";
import { useEnhancerPreferences } from "../preferences";
import { radiusV2, useThemeTokens } from "./theme-tokens";

export function ForkOriginCard({ item, theme, layout }: PluginTimelineItemProps<ForkOrigin>) {
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  const words = conversationStrings[resolveLanguage(preferences.language)];
  const [open, setOpen] = useState(false);
  const { sourceTitle, itemCount, transcriptExcerpt, summaryLines, nodePreview } = item.data;
  const title = words.origin(sourceTitle, itemCount);
  return <View style={{ backgroundColor: tokens.surface1, borderWidth: 1, borderColor: tokens.v2.border, borderRadius: radiusV2.block }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }}
      onPress={() => setOpen(!open)} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8,
        paddingHorizontal: 12, minHeight: layout.compact ? 44 : 36, borderRadius: radiusV2.block,
        backgroundColor: pressed ? tokens.v2.surface2 : undefined })}>
      <Icon name="GitBranch" size={15} color={tokens.accent} />
      <Text numberOfLines={1} style={{ flex: 1, color: tokens.foregroundMuted, fontFamily: tokens.fontUi }}>{title}</Text>
      <Icon name={open ? "ChevronUp" : "ChevronDown"} size={15} color={tokens.foregroundMuted} />
    </Pressable>
    {open ? <Text selectable style={{ padding: 12, color: tokens.foreground, fontFamily: tokens.fontUi }}>
      {transcriptExcerpt || summaryLines.join("\n") || nodePreview}
    </Text> : null}
  </View>;
}
