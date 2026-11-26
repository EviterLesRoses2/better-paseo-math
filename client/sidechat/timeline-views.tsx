import { MarkdownView } from "../components/markdown/markdown-view";
import { NoticeCallout } from "../components/notice-callout";
import { ReasoningCard } from "../components/reasoning-trace";
import { TaskList } from "../components/task-list";
import { todoTaskListData } from "../components/todo-task-list-data";
import { radiusV2, space, useThemeTokens, type ExtendedThemeTokens } from "../components/theme-tokens";
import { ToolCallout } from "../components/tool-callouts";
import { isImagePath, useImageFile } from "../image-file";
import { revealWithSetting } from "../i18n/file-open-error";
import { useEnhancerPreferences, type EnhancerPreferences } from "../preferences";
import { createReasoningSegmenter } from "../reasoning/segment";
import { classifyTool } from "../tools/classify";
import { toolErrorText } from "../tools/error-text";
import { PathContext, usePathContextValue } from "../ui/path-text";
import { TYPE } from "../ui/tokens/typography";
import { useCopy } from "../ui/use-copy";
import { revealPathRpc } from "../../shared/file-rpc";
import { sidechatColors } from "./design";
import type { PluginTheme } from "@getpaseo/plugin";
import { useAgent, useRpc, type PluginHostProps } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/ui";
import type {
  AgentPermissionRequest,
  AgentPermissionResponse,
} from "@getpaseo/protocol/agent-types";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { HostAppearanceSettings } from "../../shared/sidechat/appearance";
import { formatWorkSummaryLabel } from "../../shared/sidechat/messages";
import {
  type ProjectedRow,
  type SidechatAssistantItem,
  type SidechatPluginItem,
  type SidechatThoughtItem,
  type SidechatToolCallItem,
  type SidechatUserItem,
  type WorkSummaryCounts,
} from "../../shared/sidechat/timeline";
import {
  type EvaluatedExternalTimelinePlugin,
  ExternalPluginTimelineItemView,
} from "./external-timeline-plugins";
import type { useMessages } from "./messages";
import { Spinner } from "./spinner";
import { codeScopeProps, pointerCursorStyle } from "./web";

type TranslateFn = ReturnType<typeof useMessages>["t"];

interface SharedRowVisualProps {
  tokens: ExtendedThemeTokens;
  appearance: HostAppearanceSettings;
  compact: boolean;
  locale: string;
  t: TranslateFn;
}

const USER_COLLAPSE_CHAR_LIMIT = 360;
const USER_COLLAPSE_LINE_LIMIT = 7;

const UserMessageRow = memo(function UserMessageRow({
  item,
  tokens,
  appearance,
  compact,
  t,
}: SharedRowVisualProps & { item: SidechatUserItem }) {
  const [expandedText, setExpandedText] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const colors = sidechatColors(tokens);

  const lineCount = item.body.split("\n").length;
  const isLong =
    item.body.length > USER_COLLAPSE_CHAR_LIMIT || lineCount > USER_COLLAPSE_LINE_LIMIT;
  const displayedText =
    isLong && !expandedText
      ? item.body
          .split("\n")
          .slice(0, USER_COLLAPSE_LINE_LIMIT)
          .join("\n")
          .slice(0, USER_COLLAPSE_CHAR_LIMIT)
          .trimEnd() + "…"
      : item.body;

  return (
    <View style={{ alignItems: "flex-end", paddingVertical: space.xs }}>
      <View
        style={{
          maxWidth: "92%",
          backgroundColor: tokens.userSurface,
          borderWidth: 1,
          borderColor: tokens.userBorder,
          borderRadius: radiusV2.bubble,
          borderTopRightRadius: radiusV2.bubbleTail,
          paddingHorizontal: 11,
          paddingVertical: space.sm,
          gap: 6,
          opacity: item.optimistic ? 0.82 : 1,
        }}
      >
        {item.mainContext || item.quotedSelection ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {item.mainContext ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("mainContextBadge")}
                accessibilityState={{ expanded: showContext }}
                onPress={() => setShowContext((v) => !v)}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.xs,
                    paddingHorizontal: 7,
                    paddingVertical: 3,
                    borderRadius: radiusV2.chip,
                    backgroundColor: pressed || hovered ? colors.surface2 : tokens.v2.surface1,
                    borderWidth: 1,
                    borderColor: colors.border,
                  },
                  pointerCursorStyle,
                ]}
              >
                <Icon name="Link2" size={11} color={colors.accent} />
                <Text style={{ fontFamily: tokens.fontUi, fontSize: Math.max(11, appearance.uiBaseFontSize - 2), color: colors.foregroundMuted }}>
                  {t("mainContextBadge")}
                </Text>
                <Icon
                  name={showContext ? "ChevronDown" : "ChevronRight"}
                  size={11}
                  color={colors.foregroundMuted}
                />
              </Pressable>
            ) : null}

            {item.quotedSelection ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("quotedSelectionBadge")}
                accessibilityState={{ expanded: showQuote }}
                onPress={() => setShowQuote((v) => !v)}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
                  {
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.xs,
                    paddingHorizontal: 7,
                    paddingVertical: 3,
                    borderRadius: radiusV2.chip,
                    backgroundColor: pressed || hovered ? colors.surface2 : tokens.v2.surface1,
                    borderWidth: 1,
                    borderColor: colors.border,
                  },
                  pointerCursorStyle,
                ]}
              >
                <Icon name="Quote" size={11} color={colors.accent} />
                <Text style={{ fontFamily: tokens.fontUi, fontSize: Math.max(11, appearance.uiBaseFontSize - 2), color: colors.foregroundMuted }}>
                  {t("quotedSelectionBadge")}
                </Text>
                <Icon
                  name={showQuote ? "ChevronDown" : "ChevronRight"}
                  size={11}
                  color={colors.foregroundMuted}
                />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {showContext && item.mainContext ? (
          <View
            {...codeScopeProps}
            style={{
              backgroundColor: tokens.v2.surfaceCode,
              borderRadius: radiusV2.block,
              padding: 8,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text
              selectable
              style={{
                fontFamily: appearance.monoFontFamily,
                fontSize: Math.max(11, appearance.codeFontSize - 1),
                lineHeight: appearance.codeLineHeight,
                color: colors.foregroundMuted,
              }}
            >
              {item.mainContext}
            </Text>
          </View>
        ) : null}

        {showQuote && item.quotedSelection ? (
          <View
            {...codeScopeProps}
            style={{
              backgroundColor: tokens.v2.surfaceCode,
              borderRadius: radiusV2.block,
              padding: 8,
              borderLeftWidth: 2,
              borderLeftColor: colors.accent,
            }}
          >
            <Text
              selectable
              style={{
                fontFamily: appearance.monoFontFamily,
                fontSize: appearance.codeFontSize,
                lineHeight: appearance.codeLineHeight,
                color: colors.foreground,
              }}
            >
              {item.quotedSelection}
            </Text>
          </View>
        ) : null}

        <Text
          selectable
          style={{
            fontFamily: tokens.fontUi,
            fontSize: appearance.contentFontSize,
            lineHeight: appearance.contentLineHeight,
            color: tokens.userText,
          }}
        >
          {displayedText}
        </Text>

        {isLong ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expandedText ? t("showLess") : t("showMore")}
            onPress={() => setExpandedText((v) => !v)}
            style={[
              {
                alignSelf: "flex-start",
                minHeight: compact ? 32 : 22,
                justifyContent: "center",
              },
              pointerCursorStyle,
            ]}
          >
            <Text
              style={{
                fontFamily: tokens.fontUi,
                fontSize: Math.max(11, appearance.uiBaseFontSize - 1),
                fontWeight: "500",
                color: colors.accent,
              }}
            >
              {expandedText ? t("showLess") : t("showMore")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const SummaryGroupRow = memo(function SummaryGroupRow({
  id,
  icon,
  counts,
  isLoading,
  activeStepLabel,
  expanded,
  onToggle,
  tokens,
  compact,
  locale,
}: SharedRowVisualProps & {
  id: string;
  icon: "Wrench" | "Layers";
  counts: WorkSummaryCounts;
  isLoading: boolean;
  activeStepLabel?: string | null;
  expanded: boolean;
  onToggle(id: string): void;
}) {
  const colors = sidechatColors(tokens);
  const label = formatWorkSummaryLabel(counts, locale, isLoading);
  const inlineStep = isLoading && !expanded && activeStepLabel ? activeStepLabel : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={inlineStep ? `${label} · ${inlineStep}` : label}
      accessibilityState={{ expanded }}
      onPress={() => onToggle(id)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        {
          minHeight: compact ? tokens.typography.block.rowHeight.compact : tokens.typography.block.rowHeight.desktop,
          marginVertical: 2,
          paddingHorizontal: 9,
          paddingVertical: 5,
          borderRadius: radiusV2.block,
          borderWidth: 1,
          borderColor: expanded ? colors.border : "transparent",
          backgroundColor: pressed || hovered ? colors.surface2 : colors.surface1,
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
        },
        pointerCursorStyle,
      ]}
    >
      {isLoading ? (
        <Spinner size={13} color={colors.accent} label={label} />
      ) : (
        <Icon name={icon} size={13} color={colors.foregroundMuted} />
      )}
      <View
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            fontFamily: tokens.fontUi,
            flexShrink: inlineStep ? 0 : 1,
            maxWidth: inlineStep ? "62%" : "100%",
            fontSize: tokens.typography.block.label.size,
            color: isLoading ? tokens.row.targetActive : tokens.row.target,
            fontWeight: "500",
          }}
        >
          {label}
        </Text>
        {inlineStep ? (
          <Text
            numberOfLines={1}
            style={{
              fontFamily: tokens.fontUi,
              flex: 1,
              minWidth: 0,
              fontSize: tokens.typography.block.meta.size,
              color: tokens.row.meta,
            }}
          >
            {`· ${inlineStep}`}
          </Text>
        ) : null}
      </View>
      <Icon
        name={expanded ? "ChevronDown" : "ChevronRight"}
        size={13}
        color={colors.foregroundMuted}
      />
    </Pressable>
  );
});

function TurnResponseActionsBar({
  answerText,
  questionText,
  canInsertToMain,
  canSendToMain,
  onInsertToMain,
  onSendToMain,
  tokens,
  compact,
  t,
}: {
  answerText: string;
  questionText: string | null;
  canInsertToMain: boolean;
  canSendToMain: boolean;
  onInsertToMain(question: string | null, answer: string): void;
  onSendToMain(question: string | null, answer: string): void;
  tokens: ExtendedThemeTokens;
  compact: boolean;
  t: TranslateFn;
}) {
  const colors = sidechatColors(tokens);
  const { copy, copied } = useCopy();
  const btnHeight = 24;
  const btnFont = TYPE.button.size;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        flexWrap: "wrap",
        gap: space.xs,
        marginTop: 2,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("copyAnswer")}
        hitSlop={compact ? 10 : 0}
        onPress={() => { void copy(answerText); }}
        style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
          {
            minHeight: btnHeight,
            paddingHorizontal: 7,
            borderRadius: radiusV2.block,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            backgroundColor: pressed || hovered ? colors.surface2 : "transparent",
          },
          pointerCursorStyle,
        ]}
      >
        <Icon name={copied ? "Check" : "Copy"} size={12} color={copied ? tokens.success : tokens.foregroundMuted} />
        <Text style={{ fontFamily: tokens.fontUi, fontSize: btnFont, color: colors.foregroundMuted }}>
          {t("copyAnswer")}
        </Text>
      </Pressable>

      {canInsertToMain ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("insertToMain")}
          hitSlop={compact ? 10 : 0}
          onPress={() => onInsertToMain(questionText, answerText)}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            {
              minHeight: btnHeight,
              paddingHorizontal: 7,
              borderRadius: radiusV2.block,
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              backgroundColor: pressed || hovered ? colors.surface2 : "transparent",
            },
            pointerCursorStyle,
          ]}
        >
          <Icon name="CornerDownLeft" size={12} color={colors.foregroundMuted} />
          <Text style={{ fontFamily: tokens.fontUi, fontSize: btnFont, color: colors.foregroundMuted }}>
            {t("insertToMain")}
          </Text>
        </Pressable>
      ) : null}

      {canSendToMain ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("sendToMain")}
          hitSlop={compact ? 10 : 0}
          onPress={() => onSendToMain(questionText, answerText)}
          style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
            {
              minHeight: btnHeight,
              paddingHorizontal: 7,
              borderRadius: radiusV2.block,
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              backgroundColor: pressed || hovered ? colors.surface2 : "transparent",
            },
            pointerCursorStyle,
          ]}
        >
          <Icon name="Send" size={12} color={colors.foregroundMuted} />
          <Text style={{ fontFamily: tokens.fontUi, fontSize: btnFont, color: colors.foregroundMuted }}>
            {t("sendToMain")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const AssistantMessageRow = memo(function AssistantMessageRow({
  item,
  questionText,
  showActions,
  canInsertToMain,
  canSendToMain,
  onInsertToMain,
  onSendToMain,
  tokens,
  variant,
  onRevealPath,
  compact,
  t,
}: SharedRowVisualProps & {
  item: SidechatAssistantItem;
  variant: EnhancerPreferences["markdownVariant"];
  onRevealPath(path: string): void;
  questionText: string | null;
  showActions: boolean;
  canInsertToMain: boolean;
  canSendToMain: boolean;
  onInsertToMain(question: string | null, answer: string): void;
  onSendToMain(question: string | null, answer: string): void;
}) {
  return (
    <View style={{ paddingVertical: space.xs, gap: space.xs }}>
      <MarkdownView
        text={item.text}
        tokens={tokens}
        variant={variant}
        compact={compact}
        streaming={item.streaming}
        renderMath
        onRevealPath={onRevealPath}
      />

      {showActions && !item.streaming && item.text.trim() ? (
        <TurnResponseActionsBar
          answerText={item.text}
          questionText={questionText}
          canInsertToMain={canInsertToMain}
          canSendToMain={canSendToMain}
          onInsertToMain={onInsertToMain}
          onSendToMain={onSendToMain}
          tokens={tokens}
          compact={compact}
          t={t}
        />
      ) : null}
    </View>
  );
});

const PluginTimelineRow = memo(function PluginTimelineRow({
  item,
  agentId,
  host,
  layout,
  externalPlugins,
  questionText,
  showActions,
  actionText,
  canInsertToMain,
  canSendToMain,
  onInsertToMain,
  onSendToMain,
  theme,
  tokens,
  onRevealPath,
  compact,
  t,
}: SharedRowVisualProps & {
  item: SidechatPluginItem;
  theme: PluginTheme;
  onRevealPath(path: string): void;
  agentId: string;
  host: PluginHostProps["host"];
  layout: PluginHostProps["layout"];
  externalPlugins: ReadonlyArray<EvaluatedExternalTimelinePlugin>;
  questionText: string | null;
  showActions: boolean;
  actionText: string | null;
  canInsertToMain: boolean;
  canSendToMain: boolean;
  onInsertToMain(question: string | null, answer: string): void;
  onSendToMain(question: string | null, answer: string): void;
}) {
  return (
    <View style={{ paddingVertical: 2, gap: space.xs }}>
      <ExternalPluginTimelineItemView
        item={item}
        agentId={agentId}
        host={host}
        theme={theme}
        layout={layout}
        plugins={externalPlugins}
        tokens={tokens}
        onRevealPath={onRevealPath}
      />
      {showActions && actionText ? (
        <TurnResponseActionsBar
          answerText={actionText}
          questionText={questionText}
          canInsertToMain={canInsertToMain}
          canSendToMain={canSendToMain}
          onInsertToMain={onInsertToMain}
          onSendToMain={onSendToMain}
          tokens={tokens}
          compact={compact}
          t={t}
        />
      ) : null}
    </View>
  );
});

function SidechatReasoningRow({ row, tokens, compact, onToggle }: {
  row: Extract<ProjectedRow, { kind: "thought" }>;
  tokens: ExtendedThemeTokens;
  compact: boolean;
  onToggle(id: string): void;
}) {
  const segmenter = useMemo(createReasoningSegmenter, [row.id]);
  const streaming = row.item.status === "loading";
  return (
    <View style={row.nested ? { marginLeft: space.md } : undefined}>
      <ReasoningCard
        segmentation={segmenter.update(row.item.text, { streaming })}
        streaming={streaming}
        durationMs={null}
        expanded={row.expanded}
        onToggle={() => onToggle(row.id)}
        tokens={tokens}
        compact={compact}
        storeKey={`sidechat:${row.id}`}
        copyText={row.item.text}
      />
    </View>
  );
}

function SidechatToolRow({ row, agentId, tokens, compact, onToggle, onRevealPath }: {
  row: Extract<ProjectedRow, { kind: "tool_call" }>;
  agentId: string;
  tokens: ExtendedThemeTokens;
  compact: boolean;
  onToggle(id: string): void;
  onRevealPath(path: string): void;
}) {
  const pathContext = usePathContextValue(agentId, onRevealPath);
  const { item } = row;
  const view = useMemo(() => classifyTool({
    name: item.name,
    status: item.status,
    callId: item.callId,
    detail: item.detail,
    error: toolErrorText(item.error),
    metadata: item.metadata,
    approved: typeof item.metadata?.approved === "boolean" ? item.metadata.approved : undefined,
  }), [item]);
  const readsImage = (view.tool === "read" || view.tool === "write") && isImagePath(view.filePath);
  const [previewed, setPreviewed] = useState(false);
  const image = useImageFile(readsImage && (row.expanded || previewed) ? view.filePath : undefined, pathContext.cwd ?? null);
  return (
    <PathContext.Provider value={pathContext}>
      <View style={row.nested ? { marginLeft: space.md } : undefined}>
        <ToolCallout
          data={view}
          tokens={tokens}
          compact={compact}
          expanded={row.expanded}
          onExpandedChange={() => onToggle(row.id)}
          onRevealPath={onRevealPath}
          imageFile={image}
          requestImage={readsImage ? () => setPreviewed(true) : undefined}
        />
      </View>
    </PathContext.Provider>
  );
}

export function SidechatTimelineRowView({
  row,
  agentId,
  cwd,
  host,
  layout,
  externalPlugins,
  theme,
  appearance,
  compact,
  locale,
  t,
  canInsertToMain,
  canSendToMain,
  onToggleItem,
  onToggleGroup,
  onInsertToMain,
  onSendToMain,
}: Omit<SharedRowVisualProps, "tokens"> & {
  theme: PluginTheme;
  cwd: string;
  row: ProjectedRow;
  agentId: string;
  host: PluginHostProps["host"];
  layout: PluginHostProps["layout"];
  externalPlugins: ReadonlyArray<EvaluatedExternalTimelinePlugin>;
  canInsertToMain: boolean;
  canSendToMain: boolean;
  onToggleItem(id: string): void;
  onToggleGroup(id: string): void;
  onInsertToMain(question: string | null, answer: string): void;
  onSendToMain(question: string | null, answer: string): void;
}) {
  const preferences = useEnhancerPreferences();
  const tokens = useThemeTokens(theme, preferences, layout.platform);
  const revealPath = useRpc(revealPathRpc);
  const toast = useToast();
  const agentCwd = useAgent(agentId, (agent) => agent.cwd);
  const onRevealPath = useCallback((path: string) => {
    revealWithSetting(revealPath, toast, agentCwd || cwd, path);
  }, [revealPath, toast, agentCwd, cwd]);
  const shared = { tokens, appearance, compact, locale, t };
  switch (row.kind) {
    case "user_message":
      return <UserMessageRow {...shared} item={row.item} />;
    case "thought":
      return <SidechatReasoningRow row={row} tokens={tokens} compact={compact} onToggle={onToggleItem} />;
    case "tool_call":
      return <SidechatToolRow row={row} agentId={agentId} tokens={tokens} compact={compact} onToggle={onToggleItem} onRevealPath={onRevealPath} />;
    case "tool_group":
      return (
        <SummaryGroupRow
          {...shared}
          id={row.id}
          icon="Wrench"
          counts={row.counts}
          isLoading={row.isLoading}
          activeStepLabel={row.activeStepLabel}
          expanded={row.expanded}
          onToggle={onToggleGroup}
        />
      );
    case "turn_summary":
      return (
        <SummaryGroupRow
          {...shared}
          id={row.id}
          icon="Layers"
          counts={row.counts}
          isLoading={row.isLoading}
          expanded={row.expanded}
          onToggle={onToggleGroup}
        />
      );
    case "assistant_message":
      return (
        <AssistantMessageRow
          {...shared}
          variant={preferences.markdownVariant}
          onRevealPath={onRevealPath}
          item={row.item}
          questionText={row.questionText}
          showActions={row.showActions}
          canInsertToMain={canInsertToMain}
          canSendToMain={canSendToMain}
          onInsertToMain={onInsertToMain}
          onSendToMain={onSendToMain}
        />
      );
    case "plugin":
      return (
        <PluginTimelineRow
          {...shared}
          theme={theme}
          onRevealPath={onRevealPath}
          item={row.item}
          agentId={agentId}
          host={host}
          layout={layout}
          externalPlugins={externalPlugins}
          questionText={row.questionText}
          showActions={row.showActions}
          actionText={row.actionText}
          canInsertToMain={canInsertToMain}
          canSendToMain={canSendToMain}
          onInsertToMain={onInsertToMain}
          onSendToMain={onSendToMain}
        />
      );
    case "todo_list":
      return row.item.items.length ? <TaskList data={todoTaskListData(row.item.items)} tokens={tokens} compact={compact} /> : null;
    case "notification":
      return <NoticeCallout
        data={{ id: row.id, level: row.item.level, message: row.item.message, fatal: row.item.sourceType === "error" }}
        tokens={tokens} compact={compact} />;
    case "compaction":
      return <NoticeCallout
        data={{ id: row.id, level: "info", message: t(row.item.status === "loading" ? "compactingContext" : "compactedContext") }}
        tokens={tokens} compact={compact} />;
  }
}

export function PermissionRequestBanner({
  requests,
  tokens,
  appearance,
  compact,
  t,
  onRespond,
}: Omit<SharedRowVisualProps, "locale"> & {
  requests: readonly AgentPermissionRequest[];
  onRespond(requestId: string, response: AgentPermissionResponse): void;
}) {
  const req = requests[0];
  if (!req) return null;
  const colors = sidechatColors(tokens);
  const btnHeight = compact ? 38 : 28;

  return (
    <View
      style={{
        marginHorizontal: 10,
        marginBottom: 8,
        padding: 10,
        borderRadius: radiusV2.card,
        backgroundColor: tokens.warningBg,
        borderWidth: 1,
        borderColor: colors.statusWarning,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="ShieldAlert" size={14} color={colors.statusWarning} />
        <Text
          numberOfLines={1}
          style={{
            fontFamily: tokens.fontUi,
            flex: 1,
            fontSize: appearance.uiBaseFontSize,
            fontWeight: "600",
            color: colors.foreground,
          }}
        >
          {req.title || `${t("permissionRequired")}: ${req.name}`}
        </Text>
      </View>

      {req.description ? (
        <Text
          style={{
            fontFamily: tokens.fontUi,
            fontSize: Math.max(11, appearance.uiBaseFontSize - 1),
            color: colors.foregroundMuted,
          }}
        >
          {req.description}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: 2 }}>
        {req.actions && req.actions.length > 0 ? (
          req.actions.map((action) => (
            <Pressable
              key={action.id}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              onPress={() =>
                onRespond(req.id, {
                  behavior: action.behavior,
                  selectedActionId: action.id,
                })
              }
              style={({ pressed }) => [
                {
                  minHeight: btnHeight,
                  paddingHorizontal: 10,
                  borderRadius: radiusV2.block,
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor:
                    action.behavior === "allow" ? colors.accent : colors.surface1,
                  borderWidth: 1,
                  borderColor:
                    action.behavior === "allow" ? colors.accent : colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
                pointerCursorStyle,
              ]}
            >
              <Text
                style={{
                  fontFamily: tokens.fontUi,
                  fontSize: Math.max(12, appearance.uiBaseFontSize - 1),
                  fontWeight: "600",
                  color:
                    action.behavior === "allow"
                      ? colors.accentForeground
                      : colors.foreground,
                }}
              >
                {action.label}
              </Text>
            </Pressable>
          ))
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("allowPermission")}
              onPress={() => onRespond(req.id, { behavior: "allow" })}
              style={({ pressed }) => [
                {
                  minHeight: btnHeight,
                  paddingHorizontal: space.md,
                  borderRadius: radiusV2.block,
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor: colors.accent,
                  opacity: pressed ? 0.85 : 1,
                },
                pointerCursorStyle,
              ]}
            >
              <Text
                style={{
                  fontFamily: tokens.fontUi,
                  fontSize: Math.max(12, appearance.uiBaseFontSize - 1),
                  fontWeight: "600",
                  color: colors.accentForeground,
                }}
              >
                {t("allowPermission")}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("denyPermission")}
              onPress={() => onRespond(req.id, { behavior: "deny" })}
              style={({ pressed }) => [
                {
                  minHeight: btnHeight,
                  paddingHorizontal: space.md,
                  borderRadius: radiusV2.block,
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor: colors.surface1,
                  borderWidth: 1,
                  borderColor: colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
                pointerCursorStyle,
              ]}
            >
              <Text
                style={{
                  fontFamily: tokens.fontUi,
                  fontSize: Math.max(12, appearance.uiBaseFontSize - 1),
                  fontWeight: "500",
                  color: colors.foreground,
                }}
              >
                {t("denyPermission")}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

export function LiveTurnStatusRow({
  phase,
  startedAtMs,
  tokens,
  appearance,
  t,
}: {
  phase: "starting" | "thinking" | "working" | null;
  startedAtMs: number | null;
  tokens: ExtendedThemeTokens;
  appearance: HostAppearanceSettings;
  t: TranslateFn;
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!phase) return;
    setNowMs(Date.now());
    const interval = setInterval(() => setNowMs(Date.now()), 500);
    return () => clearInterval(interval);
  }, [phase, startedAtMs]);

  if (!phase) return null;
  const colors = sidechatColors(tokens);
  const elapsedSec =
    startedAtMs !== null ? Math.max(1, Math.floor((nowMs - startedAtMs) / 1000)) : 1;

  const label =
    phase === "starting"
      ? t("startingSession")
      : phase === "working"
        ? t("analyzingElapsed", { seconds: elapsedSec })
        : t("thinkingElapsed", { seconds: elapsedSec });

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        paddingHorizontal: space.sm,
        paddingVertical: 6,
        marginTop: 2,
      }}
    >
      <Spinner size={13} color={colors.accent} label={label} />
      <Text
        numberOfLines={1}
        style={{
          fontFamily: tokens.fontUi,
          fontSize: Math.max(12, appearance.uiBaseFontSize - 1),
          color: colors.foregroundMuted,
          fontWeight: "500",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
