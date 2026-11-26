import { expect, it } from "vitest";
import { findSvgIconProblem } from "@getpaseo/plugin";
import { extractAttachmentSourcesFromClientBundle } from "../../../server/sidechat/attachments";
import {
  deriveEffectivePromptLabel,
  detectForgeFromRemoteUrl,
  FORGE_BRAND_SVGS,
  resolveForgePresentation,
  splitSidechatAttachmentsForSubmit,
  toggleForgeComposerAttachment,
  togglePluginResourceComposerAttachment,
  type SidechatComposerAttachment,
} from "../../../shared/sidechat/attachments";

it("all Forge brand SVGs pass Paseo findSvgIconProblem validation", () => {
  for (const [forge, svg] of Object.entries(FORGE_BRAND_SVGS)) {
    expect(findSvgIconProblem(svg), `Expected ${forge} brand SVG to have no SVG validation problems`).toBe(null);
  }
});

it("detectForgeFromRemoteUrl and resolveForgePresentation handle GitHub, GitLab, Gitea, and Codeberg", () => {
  expect(detectForgeFromRemoteUrl("git@github.com:Norman-else/paseo-better-sidechat.git")).toBe("github");
  expect(detectForgeFromRemoteUrl("https://gitlab.com/acme/platform.git")).toBe("gitlab");
  expect(detectForgeFromRemoteUrl("https://codeberg.org/org/repo")).toBe("codeberg");
  expect(detectForgeFromRemoteUrl("ssh://git@gitea.example.internal:2222/org/repo.git")).toBe("gitea");
  expect(detectForgeFromRemoteUrl(null)).toBe("github");

  const gh = resolveForgePresentation("github");
  expect(gh.isMergeRequest).toBe(false);
  expect(gh.numberPrefix).toBe("#");
  expect(gh.changeRequestAbbrev).toBe("PR");

  const gl = resolveForgePresentation("gitlab");
  expect(gl.isMergeRequest).toBe(true);
  expect(gl.numberPrefix).toBe("!");
  expect(gl.changeRequestAbbrev).toBe("MR");
});

it("splitSidechatAttachmentsForSubmit produces exact Paseo wire images and attachments", () => {
  let list: SidechatComposerAttachment[] = [
    {
      kind: "image",
      id: "img_1",
      fileName: "screen.png",
      mimeType: "image/png",
      size: 2048,
      dataBase64: "iVBORw0KGgoAAA==",
    },
    {
      kind: "file",
      id: "upload_1",
      attachment: {
        type: "uploaded_file",
        id: "upload_1",
        fileName: "report.pdf",
        mimeType: "application/pdf",
        size: 8192,
        path: "/tmp/uploads/upload_1/report.pdf",
      },
    },
  ];

  list = toggleForgeComposerAttachment(list, {
    kind: "change_request",
    forge: "github",
    number: 42,
    title: "Reuse Paseo attachment menu",
    url: "https://github.com/Norman-else/paseo-better-sidechat/pull/42",
    baseRefName: "master",
    headRefName: "feat/plus-menu",
  });

  list = togglePluginResourceComposerAttachment(list, {
    pluginId: "paseo-jira",
    sourceId: "jira",
    sourceTitle: "Jira ticket",
    iconName: "Ticket",
    item: {
      id: "10042",
      identifier: "PSOS-6413",
      title: "Fix sidechat attachment picker",
      subtitle: "In Progress · Norman",
      url: "https://acme.atlassian.net/browse/PSOS-6413",
      text: "Jira ticket PSOS-6413: Fix sidechat attachment picker",
      resourceType: "issue",
    },
  });

  const split = splitSidechatAttachmentsForSubmit(list);
  expect(split.images.length).toBe(1);
  expect(split.images[0]).toStrictEqual({
    data: "iVBORw0KGgoAAA==",
    mimeType: "image/png",
  });

  expect(split.attachments.length).toBe(3);
  expect(split.attachments[0]).toStrictEqual({
    type: "uploaded_file",
    id: "upload_1",
    fileName: "report.pdf",
    mimeType: "application/pdf",
    size: 8192,
    path: "/tmp/uploads/upload_1/report.pdf",
  });
  expect(split.attachments[1]).toStrictEqual({
    type: "forge_change_request",
    mimeType: "application/paseo-forge-change-request",
    forge: "github",
    number: 42,
    title: "Reuse Paseo attachment menu",
    url: "https://github.com/Norman-else/paseo-better-sidechat/pull/42",
    baseRefName: "master",
    headRefName: "feat/plus-menu",
  });
  expect(split.attachments[2]).toStrictEqual({
    type: "text",
    mimeType: "text/plain",
    title: "PSOS-6413 Fix sidechat attachment picker",
    text: "Jira ticket PSOS-6413: Fix sidechat attachment picker",
    externalResource: {
      provider: "paseo-jira",
      providerLabel: "Jira ticket",
      resourceType: "issue",
      id: "10042",
      identifier: "PSOS-6413",
      title: "Fix sidechat attachment picker",
      url: "https://acme.atlassian.net/browse/PSOS-6413",
    },
  });

  expect(deriveEffectivePromptLabel("", list)).toBe("screen.png, report.pdf, #42 Reuse Paseo attachment menu, PSOS-6413 Fix sidechat attachment picker");
});

it("extractAttachmentSourcesFromClientBundle extracts Jira-style plugin attachment sources", () => {
  const sampleBundle = `(function(require) {
    const exports = {};
    const module = { exports };
    const { defineAttachmentSource, defineRpc } = require("@getpaseo/plugin");
    const { z } = require("zod");
    const searchTicketsRpc = defineRpc({
      name: "jira.search",
      input: z.object({ query: z.string() }),
      output: z.object({ items: z.array(z.unknown()) }),
    });
    const jiraSource = defineAttachmentSource({
      id: "jira",
      title: "Jira ticket",
      icon: "Ticket",
      pickerTitle: "Attach Jira ticket",
      searchPlaceholder: "Ticket key, number or text",
      search: searchTicketsRpc,
    });
    module.exports.default = function contribute(client) {
      client.addAttachmentSource(jiraSource);
      return () => {};
    };
    return module.exports;
  })`;

  const extracted = extractAttachmentSourcesFromClientBundle("paseo-jira", sampleBundle);
  expect(extracted.length).toBe(1);
  expect(extracted[0]?.id).toBe("jira");
  expect(extracted[0]?.title).toBe("Jira ticket");
  expect(extracted[0]?.pickerTitle).toBe("Attach Jira ticket");
  expect(extracted[0]?.searchPlaceholder).toBe("Ticket key, number or text");
  expect(extracted[0]?.icon).toBe("Ticket");
  expect(extracted[0]?.searchMethod).toBe("jira.search");
});
