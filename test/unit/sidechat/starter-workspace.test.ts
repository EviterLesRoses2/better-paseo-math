import { expect, it, vi } from "vitest";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerSidechatServer } from "../../../server/sidechat/register";
import { starterSuggestionsRpc } from "../../../shared/sidechat/contracts";

vi.mock("@getpaseo/plugin/server", () => ({ execCommand: vi.fn() }));

it("keeps the follow-up helper in the main workspace and uses local suggestions if creation fails", async () => {
  type RpcHandler = (input: unknown, context: unknown) => Promise<unknown>;
  const handlers = new Map<string, RpcHandler>();
  const close = registerSidechatServer({
    registerSettings: () => ({ read: async () => ({ status: "missing" }) }),
    handle: (contract: { name: string }, handler: RpcHandler) => {
      handlers.set(contract.name, handler);
    },
  } as unknown as PluginServerContext);

  const createUnplacedAgent = vi.fn();
  const createWorkspaceAgent = vi.fn().mockRejectedValue(new Error("Workspace is unavailable"));
  const archiveWorkspace = vi.fn();
  const workspaceRef = vi.fn(() => ({
    agents: { create: createWorkspaceAgent },
    archive: archiveWorkspace,
  }));
  const paseo = {
    agents: {
      create: createUnplacedAgent,
      ref: () => ({
        timeline: {
          refetch: async () => ({
            agent: {
              workspaceId: "main-workspace",
              cwd: "/work",
              provider: "codex",
              model: "model",
              status: "idle",
            },
            entries: [{ item: { type: "user_message", text: "Explain this change" } }],
          }),
        },
      }),
    },
    providers: {
      waitForReady: async () => ({ entries: [{ provider: "codex", models: [{ id: "model" }] }] }),
    },
    workspaces: { ref: workspaceRef },
  };

  try {
    const input = starterSuggestionsRpc.input.parse({
      agentId: "main",
      workspaceId: "panel-workspace",
      mode: "ai",
    });
    const result = await handlers.get(starterSuggestionsRpc.name)!(input, { paseo });

    expect(result).toMatchObject({ source: "contextual" });
    expect(workspaceRef).toHaveBeenCalledExactlyOnceWith("main-workspace");
    expect(createWorkspaceAgent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      background: true,
      config: expect.objectContaining({
        options: { sandbox_mode: "read-only", approval_policy: "never" },
      }),
    }));
    expect(createUnplacedAgent).not.toHaveBeenCalled();
    expect(archiveWorkspace).not.toHaveBeenCalled();
  } finally {
    await close();
  }
});
