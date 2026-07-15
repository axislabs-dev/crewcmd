import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  acquirePgliteProcessLock,
  getPgliteProcessLockDir,
  getPgliteProcessLockStatus,
} from "./pglite-process-lock";

const temporaryRoots: string[] = [];

async function createDataDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "crewcmd-pglite-lock-"));
  temporaryRoots.push(root);
  return path.join(root, "pglite");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("PGlite process lock", () => {
  it("acquires and releases an owner-only sibling lock", async () => {
    const dataDir = await createDataDir();
    const processIsRunning = (pid: number) => pid === 4242;

    const release = acquirePgliteProcessLock(dataDir, {
      pid: 4242,
      processIsRunning,
    });

    expect(getPgliteProcessLockStatus(dataDir, processIsRunning)).toEqual({
      state: "active",
      pid: 4242,
    });
    release();
    expect(getPgliteProcessLockStatus(dataDir, processIsRunning)).toEqual({
      state: "missing",
    });
  });

  it("reclaims a lock whose owning process has stopped", async () => {
    const dataDir = await createDataDir();
    acquirePgliteProcessLock(dataDir, {
      pid: 1111,
      processIsRunning: () => true,
    });

    const processIsRunning = (pid: number) => pid === 2222;
    const release = acquirePgliteProcessLock(dataDir, {
      pid: 2222,
      processIsRunning,
    });

    expect(getPgliteProcessLockStatus(dataDir, processIsRunning)).toEqual({
      state: "active",
      pid: 2222,
    });
    release();
  });

  it("refuses a lock held by another live process", async () => {
    const dataDir = await createDataDir();
    const release = acquirePgliteProcessLock(dataDir, {
      pid: 1111,
      processIsRunning: () => true,
    });

    expect(() =>
      acquirePgliteProcessLock(dataDir, {
        pid: 2222,
        processIsRunning: () => true,
      }),
    ).toThrow(`PGlite is already active at ${dataDir}.`);
    release();
  });

  it("fails closed when a lock owner cannot be identified", async () => {
    const dataDir = await createDataDir();
    await mkdir(getPgliteProcessLockDir(dataDir), { recursive: true });

    expect(() => acquirePgliteProcessLock(dataDir)).toThrow(
      `PGlite is already active at ${dataDir}.`,
    );
  });
});
