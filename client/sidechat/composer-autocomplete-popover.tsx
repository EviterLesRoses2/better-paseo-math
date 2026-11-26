import { radiusV2, space, type ExtendedThemeTokens } from "../components/theme-tokens";
import { sidechatColors } from "./design";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { Pressable, Text, View } from "react-native";
import { Spinner } from "./spinner";
import { pointerCursorStyle } from "./web";

export interface ComposerAutocompleteOption {
  id: string;
  label: string;
  argumentHint?: string;
  description?: string;
  tag?: string;
  iconName: "File" | "Folder" | "SquareSlash" | "Sparkles" | "SquarePen" | "Archive";
  onSelect(): void;
}

export function ComposerAutocompletePopover({
  visible,
  options,
  selectedIndex,
  isLoading,
  loadingLabel,
  emptyLabel,
  tokens,
  isTouch,
  uiFontSize,
}: {
  visible: boolean;
  options: readonly ComposerAutocompleteOption[];
  selectedIndex: number;
  isLoading: boolean;
  loadingLabel: string;
  emptyLabel: string;
  tokens: ExtendedThemeTokens;
  isTouch: boolean;
  uiFontSize: number;
}) {
  if (!visible) return null;

  const colors = sidechatColors(tokens);
  const rowHeight = isTouch ? 40 : 34;

  return (
    <View
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        marginBottom: 8,
        maxHeight: 224,
        backgroundColor: colors.surface1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radiusV2.overlay,
        ...tokens.v2.elevation.overlay,
        overflow: "hidden",
        zIndex: 65,
      }}
    >
      {options.length === 0 ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingHorizontal: space.md,
            paddingVertical: 11,
          }}
        >
          {isLoading ? <Spinner size={13} color={colors.foregroundMuted} /> : null}
          <Text
            numberOfLines={1}
            style={{
              fontFamily: tokens.fontUi,
              fontSize: Math.max(11, uiFontSize - 1),
              color: colors.foregroundMuted,
            }}
          >
            {isLoading ? loadingLabel : emptyLabel}
          </Text>
        </View>
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 222 }}>
          <View style={{ paddingVertical: space.xs }}>
            {options.map((opt, idx) => {
              const active = idx === selectedIndex;
              return (
                <Pressable
                  key={opt.id}
                  accessibilityRole="menuitem"
                  accessibilityLabel={
                    opt.description ? `${opt.label}, ${opt.description}` : opt.label
                  }
                  accessibilityState={{ selected: active }}
                  onPress={opt.onSelect}
                  style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                    {
                      minHeight: rowHeight,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      marginHorizontal: 4,
                      borderRadius: radiusV2.block,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.sm,
                      backgroundColor:
                        pressed || hovered || active ? colors.surface2 : "transparent",
                    },
                    pointerCursorStyle,
                  ]}
                >
                  <Icon
                    name={opt.iconName}
                    size={14}
                    color={
                      opt.iconName === "Sparkles"
                        ? colors.accent
                        : active
                          ? colors.foreground
                          : colors.foregroundMuted
                    }
                  />

                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: tokens.fontUi,
                      flexShrink: 0,
                      maxWidth: 210,
                      fontSize: uiFontSize,
                      fontWeight: "500",
                      color: colors.foreground,
                    }}
                  >
                    {opt.label}
                  </Text>

                  {opt.argumentHint ? (
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily: tokens.fontUi,
                        flexShrink: 1,
                        maxWidth: 120,
                        fontSize: Math.max(11, uiFontSize - 1),
                        color: colors.foregroundMuted,
                      }}
                    >
                      {opt.argumentHint}
                    </Text>
                  ) : null}

                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: tokens.fontUi,
                      flex: 1,
                      minWidth: 0,
                      fontSize: Math.max(11, uiFontSize - 1),
                      color: colors.foregroundMuted,
                    }}
                  >
                    {opt.description ?? ""}
                  </Text>

                  {opt.tag ? (
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 1.5,
                        borderRadius: radiusV2.chip,
                        backgroundColor: colors.surface0,
                        borderWidth: 1,
                        borderColor: colors.border,
                        flexShrink: 0,
                      }}
                    >
                      <Text
                        numberOfLines={1}
                        style={{
                          fontFamily: tokens.fontUi,
                          fontSize: Math.max(10, uiFontSize - 3),
                          fontWeight: "600",
                          color: colors.foregroundMuted,
                        }}
                      >
                        {opt.tag}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
