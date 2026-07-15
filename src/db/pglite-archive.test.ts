import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
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
});
