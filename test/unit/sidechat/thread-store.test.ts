import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { SidechatThreadStore } from "../../../server/sidechat/thread-store";

it("SidechatThreadStore persists, filters, and archives workspace threads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sidechat-store-test-"));
  const filePath = join(dir, "threads.json");

  try {
    const store = new SidechatThreadStore(filePath);
    await store.upsert({
      agentId: "side-1",
      workspaceId: "ws-1",
      parentAgentId: "main-1",
      title: "First question",
      cwd: "/repo",
      provider: "claude",
      model: "claude-sonnet-4-5",
      modeId: "auto",
      thinkingOptionId: "high",
      status: "idle",
      createdAt: "2026-11-21T01:00:00Z",
      updatedAt: "2026-11-21T01:00:00Z",
    });

    await store.upsert({
      agentId: "side-2",
      workspaceId: "ws-1",
      parentAgentId: "main-2",
      title: "Second question",
      cwd: "/repo",
      provider: "claude",
      model: "claude-sonnet-4-5",
      modeId: "plan",
      thinkingOptionId: null,
      status: "running",
      createdAt: "2026-11-21T01:05:00Z",
      updatedAt: "2026-11-21T01:05:00Z",
    });

    // Reload from disk with a fresh instance
    const reloaded = new SidechatThreadStore(filePath);
    const forMain1 = await reloaded.list({ workspaceId: "ws-1", parentAgentId: "main-1" });
    expect(forMain1.length).toBe(1);
    expect(forMain1[0]?.agentId).toBe("side-1");

    const allWs1 = await reloaded.list({ workspaceId: "ws-1" });
    expect(allWs1.length).toBe(2);
    expect(allWs1[0]?.agentId).toBe("side-2");

    const archivedIds = await reloaded.archiveWorkspace("ws-1");
    expect(archivedIds.length).toBe(2);
    expect((await reloaded.list({ workspaceId: "ws-1" })).length).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it.each(["plugin-data", "plugin-settings"])("migrates a standalone store under %s on concurrent first access", async (legacyBase) => {
  const dir = await mkdtemp(join(tmpdir(), "sidechat-migration-test-"));
  vi.stubEnv("PASEO_HOME", dir);
  try {
    const legacyDir = join(dir, legacyBase, "paseo-better-sidechat");
    await mkdir(legacyDir, { recursive: true });
    const legacyFile = join(legacyDir, "threads.json");
    const legacyThread = {
      agentId: "old", workspaceId: "ws", parentAgentId: null,
      title: "Original title", cwd: "/repo", provider: "codex", model: null,
      modeId: null, thinkingOptionId: null, status: "idle" as const,
      createdAt: "2026-11-21T01:00:00Z", updatedAt: "2026-11-21T01:00:00Z",
    };
    const source = JSON.stringify({ version: 1, threads: [legacyThread] });
    await writeFile(legacyFile, source);
    const store = new SidechatThreadStore();
    const filter = { workspaceId: "ws" };

    await Promise.all([
      store.list(filter),
      store.patch("old", { title: "Renamed" }),
      store.upsert({ ...legacyThread, agentId: "new", title: "New thread" }),
    ]);
    expect(await new SidechatThreadStore().list(filter)).toEqual([
      expect.objectContaining({ agentId: "old", title: "Renamed" }),
      expect.objectContaining({ agentId: "new", title: "New thread" }),
    ]);
    expect(await readFile(legacyFile, "utf8")).toBe(source);
  } finally {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  }
});
