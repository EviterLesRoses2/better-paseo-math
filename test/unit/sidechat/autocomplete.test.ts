import { expect, it } from "vitest";
import {
  applyFileMentionReplacement,
  applySlashCommandReplacement,
  findActiveFileMention,
  findActiveSlashCommand,
  rankSlashAutocompleteEntries,
  resolveImmediateClientSlashCommand,
  SIDECHAT_CLIENT_COMMANDS,
  type SlashCommandItem,
} from "../../../shared/sidechat/autocomplete";

it("findActiveFileMention and applyFileMentionReplacement match Paseo @files behavior", () => {
  expect(findActiveFileMention({ text: "@comp", cursorIndex: 5 })).toStrictEqual({
    start: 0,
    end: 5,
    query: "comp",
  });

  expect(findActiveFileMention({ text: "Check @client/web", cursorIndex: 17 })).toStrictEqual({
    start: 6,
    end: 17,
    query: "client/web",
  });

  // Email addresses must NOT trigger @files
  expect(findActiveFileMention({ text: "contact oli@anydream.dev", cursorIndex: 24 })).toBe(null);

  // Whitespace after `@` closes mention
  expect(findActiveFileMention({ text: "Check @client/web.ts now", cursorIndex: 24 })).toBe(null);

  const mention = findActiveFileMention({ text: "Inspect @comp please", cursorIndex: 13 })!;
  const replaced = applyFileMentionReplacement({
    text: "Inspect @comp please",
    mention,
    relativePath: "client/composer-bar.tsx",
  });
  expect(replaced.text).toBe('Inspect "client/composer-bar.tsx" please');
});

it("findActiveSlashCommand and applySlashCommandReplacement distinguish start vs inline skills", () => {
  expect(findActiveSlashCommand({ text: "/adv", cursorIndex: 4 })).toStrictEqual({
    start: 0,
    end: 4,
    query: "adv",
    position: "start",
  });

  expect(findActiveSlashCommand({ text: "Please use /archify", cursorIndex: 19 })).toStrictEqual({
      start: 11,
      end: 19,
      query: "archify",
      position: "inline",
    });

  // URLs or mid-word slashes must NOT trigger slash commands
  expect(findActiveSlashCommand({ text: "https://github.com/org", cursorIndex: 22 })).toBe(null);
  expect(findActiveSlashCommand({ text: "client/web.ts", cursorIndex: 13 })).toBe(null);

  const inlineCmd = findActiveSlashCommand({
    text: "Use /arch",
    cursorIndex: 9,
  })!;
  const applied = applySlashCommandReplacement({
    text: "Use /arch",
    command: inlineCmd,
    commandName: "archify",
  });
  expect(applied.text).toBe("Use /archify ");
  expect(applied.cursorIndex).toBe("Use /archify ".length);
});

it("rankSlashAutocompleteEntries shows commands + skills at start, and skills-only inline", () => {
  const providerCommands: SlashCommandItem[] = [
    {
      name: "compact",
      description: "Compact conversation history",
      argumentHint: "[instructions]",
      kind: "command",
    },
    {
      name: "archify",
      description: "Create standalone architecture SVG diagrams",
      argumentHint: "",
      kind: "skill",
    },
    {
      name: "anthropic-skills:skill-creator",
      description: "Create and benchmark skills",
      argumentHint: "",
      kind: "skill",
    },
  ];

  const clientCommands = SIDECHAT_CLIENT_COMMANDS.map((def) => ({
    def,
    description: def.action,
  }));

  const atStartAll = rankSlashAutocompleteEntries({
    providerCommands,
    clientCommands,
    query: "",
    position: "start",
  });
  expect(atStartAll.length).toBe(5);
  expect(atStartAll[0]?.name).toBe("compact");
  expect(atStartAll[3]?.name).toBe("clear");

  // Inline `/` only surfaces `kind === "skill"`
  const inlineAll = rankSlashAutocompleteEntries({
    providerCommands,
    clientCommands,
    query: "",
    position: "inline",
  });
  expect(inlineAll.map((e) => e.name)).toStrictEqual(["archify", "anthropic-skills:skill-creator"]);

  // Segment-boundary search (`skill-creator` matched via `creator`)
  const creatorSearch = rankSlashAutocompleteEntries({
    providerCommands,
    clientCommands,
    query: "skill-creator",
    position: "start",
  });
  expect(creatorSearch[0]?.name).toBe("anthropic-skills:skill-creator");
});

it("resolveImmediateClientSlashCommand matches /clear, /new, /exit, and /archive only without attachments", () => {
  expect(resolveImmediateClientSlashCommand({
      text: "/new",
      hasAttachments: false,
      hasActiveThread: true,
    })?.action).toBe("new-thread");
  expect(resolveImmediateClientSlashCommand({
      text: "/archive",
      hasAttachments: false,
      hasActiveThread: true,
    })?.action).toBe("archive-thread");
  expect(resolveImmediateClientSlashCommand({
      text: "/new",
      hasAttachments: true,
      hasActiveThread: true,
    })).toBe(null);
});
