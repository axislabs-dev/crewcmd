import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  backupPglite,
  parseArchiveCommand,
  restorePglite,
} from "./pglite-archive";

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewcmd-pglite-archive-"));
  temporaryRoots.push(root);
  return root;
}

async function createCrashedDatabase(dataDir: string): Promise<void> {
  const script = `
    import { PGlite } from "@electric-sql/pglite";
    import { mkdirSync, writeFileSync } from "node:fs";
    import path from "node:path";

    const dataDir = process.argv[1];
    const lockDir = path.join(path.dirname(dataDir), "." + path.basename(dataDir) + ".crewcmd.lock");
    mkdirSync(lockDir, { mode: 0o700 });
    writeFileSync(path.join(lockDir, "pid"), process.pid + "\\n", { mode: 0o600 });
    const db = await PGlite.create(dataDir);
    await db.exec("CREATE TABLE crash_records (value text not null); INSERT INTO crash_records VALUES ('recovered');");
    console.log("ready");
    await new Promise(() => {});
  `;
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", script, dataDir],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const ready = once(child.stdout!, "data");
  const exited = once(child, "exit").then(() => {
    throw new Error(`Crash fixture exited before it was ready: ${stderr}`);
  });
  const [chunk] = await Promise.race([ready, exited]);
  expect(String(chunk)).toContain("ready");
  expect(child.kill("SIGKILL")).toBe(true);
  await once(child, "exit");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("PGlite archives", () => {
  it("accepts pnpm's argument separator", () => {
    expect(
      parseArchiveCommand(["backup", "--", "./backup.tar.gz"]),
    ).toEqual({
      archiveArgument: "./backup.tar.gz",
      command: "backup",
    });
  });

  it(
    "backs up and restores written data",
    async () => {
      const root = await createTemporaryRoot();
      const sourceDir = path.join(root, "source");
      const restoredDir = path.join(root, "restored");
      const archivePath = path.join(root, "backups", "crewcmd.tar.gz");
      const source = await PGlite.create(sourceDir);
      await source.exec(
        "CREATE TABLE qa_records (id integer primary key, value text not null);",
      );
      await source.exec("INSERT INTO qa_records VALUES (1, 'persists');");
      await source.close();

      await backupPglite({ archivePath, dataDir: sourceDir });
      await restorePglite({ archivePath, dataDir: restoredDir });

      const restored = await PGlite.create(restoredDir);
      const result = await restored.query<{ value: string }>(
        "SELECT value FROM qa_records WHERE id = 1;",
      );
      await restored.close();

      expect(result.rows).toEqual([{ value: "persists" }]);
    },
    15_000,
  );

  it("refuses to overwrite a non-empty target", async () => {
    const root = await createTemporaryRoot();
    const targetDir = path.join(root, "existing");
    const archivePath = path.join(root, "backup.tar.gz");
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, "keep.txt"), "keep");
    await writeFile(archivePath, "not read before target validation");

    await expect(
      restorePglite({ archivePath, dataDir: targetDir }),
    ).rejects.toThrow("Refusing to overwrite non-empty PGlite data directory");
  });

  it("refuses to back up a running database", async () => {
    const root = await createTemporaryRoot();
    const sourceDir = path.join(root, "running");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(path.join(sourceDir, "postmaster.pid"), "active");

    await expect(
      backupPglite({
        archivePath: path.join(root, "backup.tar.gz"),
        dataDir: sourceDir,
      }),
    ).rejects.toThrow("Stop CrewCMD before backing it up");
  });

  it(
    "recovers and archives a database after its CrewCMD process has stopped",
    async () => {
      const root = await createTemporaryRoot();
      const sourceDir = path.join(root, "source");
      const restoredDir = path.join(root, "restored");
      const archivePath = path.join(root, "crewcmd.tar.gz");
      await createCrashedDatabase(sourceDir);

      await backupPglite({ archivePath, dataDir: sourceDir });
      await restorePglite({ archivePath, dataDir: restoredDir });

      const restored = await PGlite.create(restoredDir);
      const result = await restored.query<{ value: string }>(
        "SELECT value FROM crash_records;",
      );
      await restored.close();
      expect(result.rows).toEqual([{ value: "recovered" }]);
    },
    20_000,
  );
});
