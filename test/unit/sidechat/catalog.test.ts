import { describe, expect, it, vi } from "vitest";

const daemon = vi.hoisted(() => ({
  getPluginCatalog: vi.fn(),
  invokePluginRpc: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@getpaseo/plugin/server", () => ({
  execCommand: async () => ({ stdout: '{"listen":"127.0.0.1:6767"}' }),
}));
vi.mock("../../../server/sidechat/daemon-rpc-lite", () => ({
  PaseoDaemonRpcLite: function () {
    return { ...daemon, connect: async () => {}, isConnected: true };
  },
}));

import { SidechatAttachmentService } from "../../../server/sidechat/attachments";

describe("external Sidechat contributions", () => {
  it("skips the integrated and standalone plugins during timeline discovery and relay", async () => {
    const clientBundle = `(function () {
      return { default(client) {
        client.addTimelineRenderer({});
        client.addAttachmentSource({
          id: "issues", title: "Issues", pickerTitle: "Issues",
          search: { name: "issues.search" }, icon: "List",
        });
      } };
    })`;
    daemon.getPluginCatalog.mockResolvedValue([
      { id: "better-paseo-math", clientBundle },
      { id: "paseo-better-sidechat", clientBundle },
      { id: "other-plugin", clientBundle },
    ]);
    const service = new SidechatAttachmentService(() => "paseo");
    await expect(service.listTimelinePluginBundles()).resolves.toEqual([
      { id: "other-plugin", clientBundle, clientBundleHash: expect.any(String) },
    ]);
    const sources = await service.listPluginAttachmentSources("en");
    expect(sources).toEqual([
      expect.objectContaining({ pluginId: "other-plugin", sourceId: "issues", searchMethod: "issues.search" }),
    ]);
    for (const pluginId of ["better-paseo-math", "paseo-better-sidechat"]) {
      await expect(service.invokeExternalPlugin({ pluginId, method: "test.ping" })).rejects.toThrow("recursively");
      await expect(service.searchPluginAttachmentSource({ pluginId, searchMethod: "test.search", query: "" }))
        .resolves.toMatchObject({ items: [], error: expect.stringContaining("recursively") });
    }
    expect(daemon.invokePluginRpc).not.toHaveBeenCalled();
    await service.close();
    expect(daemon.close).toHaveBeenCalledOnce();
  });
});
