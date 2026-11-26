import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useAgent, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import {
  conversationCapabilitiesRpc, conversationForkRpc, conversationRewindEditRpc,
  type ConversationCapabilities, type ConversationNode, type ConversationRewindEditInput,
} from "../../shared/conversation-actions-rpc";
import { conversationStrings } from "../i18n/conversation-strings";
import { resolveLanguage } from "../i18n/settings-strings";
import { useEnhancerPreferences } from "../preferences";
import { focusAgentComposer } from "../state/composer-bridge";
import { radiusV2, type ExtendedThemeTokens } from "./theme-tokens";

export type ConversationDialogKind = "edit" | "fork";
export interface ConversationDialogProps {
  agentId: string;
  node: ConversationNode;
  tokens: ExtendedThemeTokens;
  close(): void;
}

type Words = typeof conversationStrings.en;
type RewindMode = ConversationRewindEditInput["rewindMode"];
type RewindAction = ConversationRewindEditInput["action"];

function useWords(): Words {
  return conversationStrings[resolveLanguage(useEnhancerPreferences().language)];
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function useConversationSubmission(words: Words, close: () => void) {
  const toast = useToast();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return {
    busy, error,
    dismiss: () => { if (!locked.current) close(); },
    async run(operation: () => Promise<{ ok: boolean; success: string; agentId?: string; draft?: string; error?: string }>) {
      if (locked.current) return;
      locked.current = true;
      setBusy(true);
      setError(undefined);
      try {
        const result = await operation();
        if (!result.ok && !result.agentId) {
          setError(result.error ?? words.loadingFailed);
          return;
        }
        close();
        if (result.error) toast.show(result.error, { variant: result.ok ? "warning" : "error" });
        else toast.show(result.success, { variant: "success" });
        if (result.agentId) {
          try { await focusAgentComposer(result.agentId, result.draft); }
          catch { toast.error(words.openingFailed); }
        }
      } catch (failure) {
        setError(errorText(failure));
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
  };
}

function Dialog({ title, icon, tokens, close, error, children }: {
  title: string; icon: string; tokens: ExtendedThemeTokens; close(): void; error?: string; children: ReactNode;
}) {
  return <Modal title={title} icon={<Icon name={icon} size={18} color={tokens.accent} />} open onOpenChange={(open) => { if (!open) close(); }}>
    <Modal.Content style={{ backgroundColor: tokens.surface0 }} contentContainerStyle={{ gap: 12, padding: 20 }}>
      {children}
      {error ? <Text accessibilityRole="alert" style={{ color: tokens.danger, fontFamily: tokens.fontUi }}>{error}</Text> : null}
    </Modal.Content>
  </Modal>;
}

function Field({ label, tokens, value, onChange, multiline, editable, large = false }: {
  label: string; tokens: ExtendedThemeTokens; value: string; onChange(value: string): void;
  multiline?: boolean; editable: boolean; large?: boolean;
}) {
  return <View style={{ gap: 5 }}>
    <Text style={{ color: tokens.foregroundMuted, fontFamily: tokens.fontUi }}>{label}</Text>
    <TextInput accessibilityLabel={label} editable={editable} value={value} onChangeText={onChange} multiline={multiline}
      placeholderTextColor={tokens.foregroundMuted} style={{ color: tokens.foreground, backgroundColor: tokens.surface1,
        borderColor: tokens.v2.border, borderWidth: 1, borderRadius: radiusV2.block, fontFamily: tokens.fontUi,
        minHeight: large ? 144 : multiline ? 80 : 40, padding: 10, textAlignVertical: "top" }} />
  </View>;
}

function Action({ label, tokens, press, disabled, primary, selected }: {
  label: string; tokens: ExtendedThemeTokens; press(): void; disabled?: boolean; primary?: boolean; selected?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }}
    disabled={disabled} onPress={press} style={({ pressed }) => ({ minHeight: 40, justifyContent: "center",
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: radiusV2.block, borderWidth: 1,
      borderColor: primary || selected ? tokens.accent : tokens.v2.border,
      opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      backgroundColor: primary ? tokens.accent : selected ? tokens.accentBg : tokens.surface1 })}>
    <Text style={{ fontFamily: tokens.fontUi, color: primary ? tokens.accentForeground : tokens.foreground }}>{label}</Text>
  </Pressable>;
}

const buttonRow = { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 } as const;

export function EditConversationModal({ agentId, node, tokens, close }: ConversationDialogProps) {
  const words = useWords();
  const submit = useConversationSubmission(words, close);
  const fetchCapabilities = useRpc(conversationCapabilitiesRpc);
  const edit = useRpc(conversationRewindEditRpc);
  const [capabilities, setCapabilities] = useState<ConversationCapabilities>();
  const [loadError, setLoadError] = useState<string>();
  const [text, setText] = useState(node.nodeText);
  const [mode, setMode] = useState<RewindMode>("conversation");
  const [archive, setArchive] = useState(true);
  const status = useAgent(agentId, (agent) => agent.status) ?? capabilities?.status;
  const running = status === "running" || status === "initializing";
  useEffect(() => {
    let active = true;
    void fetchCapabilities({ agentId }).then((result) => { if (active) setCapabilities(result); },
      (error) => { if (active) setLoadError(errorText(error)); });
    return () => { active = false; };
  }, [agentId, fetchCapabilities]);
  const native = Boolean(capabilities?.supportsRewindConversation);
  const nativeMode = mode === "conversation" ? native : true;
  const canEdit = Boolean(capabilities?.supportsFork) && !running && !submit.busy;
  const execute = (action: RewindAction) => submit.run(async () => {
    const result = await edit({ agentId, messageId: node.messageId, clientMessageId: node.clientMessageId,
      timestampMs: node.timestampMs, originalText: node.nodeText, editedText: text,
      action, rewindMode: mode, archiveSuperseded: archive });
    return { ok: result.ok, error: result.error, agentId: action === "files" ? undefined : result.targetAgentId,
      draft: result.restoredText, success: action === "files" ? words.filesRestored : action === "resend" ? words.edited : words.rewound };
  });
  const modes = [
    { value: "conversation", label: words.conversationMode, show: true },
    { value: "both", label: words.bothMode, show: capabilities?.supportsRewindBoth },
    { value: "files", label: words.filesMode, show: capabilities?.supportsRewindFiles },
  ] as const;
  return <Dialog title={words.edit} icon="Pencil" close={submit.dismiss} tokens={tokens} error={submit.error ?? loadError}>
    {mode !== "files" ? <Field label={words.editPrompt} tokens={tokens} value={text} onChange={setText} editable={!submit.busy} multiline large /> : null}
    {!capabilities || !capabilities.supportsFork
      ? <Text style={{ color: tokens.foregroundMuted }}>{!loadError && !capabilities ? words.loading : words.loadingFailed}</Text>
      : <>
        <Text style={{ color: nativeMode ? tokens.accent : tokens.foregroundMuted, fontFamily: tokens.fontUi }}>
          {nativeMode ? words.native : words.fallback}
        </Text>
        {native || capabilities.supportsRewindFiles || capabilities.supportsRewindBoth ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {modes.filter((entry) => entry.show).map((entry) => <Action key={entry.value} label={entry.label} tokens={tokens}
            selected={mode === entry.value} disabled={submit.busy} press={() => setMode(entry.value)} />)}
        </View> : null}
        <Text style={{ color: tokens.foregroundMuted, fontFamily: tokens.fontUi }}>
          {mode === "files" ? words.filesWarning : `${words.overwrite}${mode === "both" ? ` ${words.bothWarning}` : ""}`}
        </Text>
        {mode === "conversation" ? <Pressable accessibilityRole="switch" accessibilityLabel={words.archive}
          accessibilityState={{ checked: archive, disabled: submit.busy }} disabled={submit.busy} onPress={() => setArchive(!archive)}
          style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Icon name={archive ? "SquareCheck" : "Square"} size={18} color={archive ? tokens.accent : tokens.foregroundMuted} />
          <Text style={{ color: tokens.foreground, fontFamily: tokens.fontUi }}>{words.archive}</Text>
        </Pressable> : null}
        {native && mode === "conversation" && archive ? <Text style={{ color: tokens.foregroundMuted, fontFamily: tokens.fontUi }}>
          {words.archiveFallback}
        </Text> : null}
      </>}
    {running ? <Text accessibilityRole="alert" style={{ color: tokens.danger }}>{words.running}</Text> : null}
    <View style={buttonRow}>
      <Action label={words.cancel} disabled={submit.busy} tokens={tokens} press={submit.dismiss} />
      {mode === "files" ? <Action label={words.rewindFiles} disabled={!canEdit} tokens={tokens} primary press={() => void execute("files")} />
        : <>
          <Action label={nativeMode ? words.rewindComposer : words.moveComposer} disabled={!canEdit} tokens={tokens} press={() => void execute("composer")} />
          <Action label={words.resend} disabled={!canEdit || !text.trim()} tokens={tokens} primary press={() => void execute("resend")} />
        </>}
    </View>
  </Dialog>;
}

export function ForkConversationModal({ agentId, node, tokens, close }: ConversationDialogProps) {
  const words = useWords();
  const submit = useConversationSubmission(words, close);
  const fork = useRpc(conversationForkRpc);
  const agentTitle = useAgent(agentId, (agent) => agent.title);
  const defaultTitle = `${agentTitle?.trim() || words.conversation} (Fork)`;
  const [title, setTitle] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const execute = () => submit.run(async () => {
    const result = await fork({ ...node, agentId, title: (title ?? defaultTitle).trim(), initialPrompt: prompt.trim() ? prompt : undefined });
    return { ok: result.ok, error: result.error, agentId: result.newAgentId, draft: result.ok ? undefined : prompt, success: words.created };
  });
  return <Dialog title={words.fork} icon="GitBranch" close={submit.dismiss} tokens={tokens} error={submit.error}>
    <View style={{ padding: 10, backgroundColor: tokens.surface1, borderLeftWidth: 2, borderLeftColor: tokens.accent }}>
      <Text style={{ color: tokens.foregroundMuted, fontFamily: tokens.fontUi }}>{words.branchPoint}</Text>
      <Text numberOfLines={4} style={{ color: tokens.foreground, fontFamily: tokens.fontUi }}>{node.nodeText.slice(0, 500)}</Text>
    </View>
    <Field label={words.title} tokens={tokens} value={title ?? defaultTitle} onChange={setTitle} editable={!submit.busy} />
    <Field label={words.firstPrompt} tokens={tokens} value={prompt} onChange={setPrompt} editable={!submit.busy} multiline />
    <View style={buttonRow}>
      <Action label={words.cancel} disabled={submit.busy} tokens={tokens} press={submit.dismiss} />
      <Action label={prompt.trim() ? words.createSend : words.create} disabled={submit.busy} tokens={tokens} primary press={() => void execute()} />
    </View>
  </Dialog>;
}

export function ConversationDialog({ kind, ...props }: ConversationDialogProps & { kind: ConversationDialogKind }) {
  return kind === "edit" ? <EditConversationModal {...props} /> : <ForkConversationModal {...props} />;
}
