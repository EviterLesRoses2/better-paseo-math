import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { pluginDataDir } from "../plugin-data";
import { sidechatThreadSchema, type SidechatThread } from "../../shared/sidechat/contracts";

const storedRecordSchema = sidechatThreadSchema.extend({
  archived: z.boolean().default(false),
});

export type StoredThreadRecord = z.infer<typeof storedRecordSchema>;

const storeFileSchema = z.object({
  version: z.literal(1),
  threads: z.array(storedRecordSchema),
});

export function defaultThreadStorePath(): string {
  return join(pluginDataDir(), "sidechat-threads.json");
}

export class SidechatThreadStore {
  private loading: Promise<void> | undefined;
  private records = new Map<string, StoredThreadRecord>();
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath = defaultThreadStorePath(),
    private readonly legacyPaths = filePath === defaultThreadStorePath()
      ? [
          join(dirname(pluginDataDir()), "paseo-better-sidechat", "threads.json"),
          join(pluginDataDir(), "..", "..", "plugin-settings", "paseo-better-sidechat", "threads.json"),
        ]
      : [],
  ) {}

  private ensureLoaded(): Promise<void> {
    this.loading ??= this.load().catch((error) => {
      this.loading = undefined;
      throw error;
    });
    return this.loading;
  }

  private async load(): Promise<void> {
    for (const path of [this.filePath, ...this.legacyPaths]) {
      let content: string;
      try {
        content = await readFile(path, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const file = storeFileSchema.parse(JSON.parse(content));
      const records = new Map(file.threads.map((thread) => [thread.agentId, thread]));
      if (path !== this.filePath) await this.persist(records);
      this.records = records;
      return;
    }
  }

  private async persist(records: Map<string, StoredThreadRecord>): Promise<void> {
    const payload = JSON.stringify({ version: 1, threads: [...records.values()] }, null, 2);
    await mkdir(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, payload, "utf8");
      await rename(temp, this.filePath);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  private update<T>(apply: (records: Map<string, StoredThreadRecord>) => T, changed: (result: T) => boolean): Promise<T> {
    const operation = this.writeChain.then(async () => {
      await this.ensureLoaded();
      const records = new Map(this.records);
      const result = apply(records);
      if (changed(result)) {
        await this.persist(records);
        this.records = records;
      }
      return result;
    });
    this.writeChain = operation.catch(() => {});
    return operation;
  }

  async list({ workspaceId, parentAgentId }: { workspaceId: string; parentAgentId?: string }): Promise<StoredThreadRecord[]> {
    await this.ensureLoaded();
    await this.writeChain;
    return [...this.records.values()]
      .filter((record) => (
        !record.archived && record.workspaceId === workspaceId &&
        (!parentAgentId || !record.parentAgentId || record.parentAgentId === parentAgentId)
      ))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  upsert(thread: SidechatThread): Promise<StoredThreadRecord> {
    return this.update((records) => {
      const existing = records.get(thread.agentId);
      const merged = { ...thread, title: thread.title || existing?.title || "", archived: false };
      records.set(thread.agentId, merged);
      return merged;
    }, () => true);
  }

  patch(agentId: string, updates: Partial<Omit<StoredThreadRecord, "agentId">>): Promise<StoredThreadRecord | null> {
    return this.update((records) => {
      const current = records.get(agentId);
      if (!current) return null;
      const updated = { ...current, ...updates };
      records.set(agentId, updated);
      return updated;
    }, Boolean);
  }

  archiveWorkspace(workspaceId: string): Promise<string[]> {
    return this.update((records) => {
      const archivedIds: string[] = [];
      const updatedAt = new Date().toISOString();
      for (const [id, record] of records) {
        if (record.workspaceId !== workspaceId || record.archived) continue;
        records.set(id, { ...record, archived: true, updatedAt });
        archivedIds.push(id);
      }
      return archivedIds;
    }, (ids) => ids.length > 0);
  }
}
