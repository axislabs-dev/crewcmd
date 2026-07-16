import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export type PgliteProcessLockStatus =
  | { state: "active"; pid: number }
  | { state: "missing" }
  | { state: "stale"; pid: number }
  | { state: "unknown" };

type ProcessProbe = (pid: number) => boolean;

interface AcquireOptions {
  pid?: number;
  processIsRunning?: ProcessProbe;
}

function defaultProcessIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error
      && "code" in error
      && error.code === "ESRCH"
    );
  }
}

export function getPgliteProcessLockDir(dataDir: string): string {
  return path.join(
    path.dirname(dataDir),
    `.${path.basename(dataDir)}.crewcmd.lock`,
  );
}

export function getPgliteProcessLockStatus(
  dataDir: string,
  processIsRunning: ProcessProbe = defaultProcessIsRunning,
): PgliteProcessLockStatus {
  const lockDir = getPgliteProcessLockDir(dataDir);
  let rawPid: string;
  try {
    rawPid = readFileSync(path.join(lockDir, "pid"), "utf8").trim();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return existsSync(lockDir) ? { state: "unknown" } : { state: "missing" };
    }
    return { state: "unknown" };
  }

  const pid = Number(rawPid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return { state: "unknown" };
  return processIsRunning(pid)
    ? { state: "active", pid }
    : { state: "stale", pid };
}

export function acquirePgliteProcessLock(
  dataDir: string,
  options: AcquireOptions = {},
): () => void {
  const pid = options.pid ?? process.pid;
  const processIsRunning = options.processIsRunning ?? defaultProcessIsRunning;
  const lockDir = getPgliteProcessLockDir(dataDir);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      mkdirSync(lockDir, { recursive: false, mode: 0o700 });
      writeFileSync(path.join(lockDir, "pid"), `${pid}\n`, { mode: 0o600 });
      return () => {
        const status = getPgliteProcessLockStatus(dataDir, processIsRunning);
        if (status.state === "active" && status.pid === pid) {
          rmSync(lockDir, { recursive: true });
        }
      };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }

    const status = getPgliteProcessLockStatus(dataDir, processIsRunning);
    if (status.state === "active" && status.pid === pid) return () => {};
    if (status.state !== "stale") {
      throw new Error(`PGlite is already active at ${dataDir}.`);
    }
    rmSync(lockDir, { recursive: true });
  }

  throw new Error(`Could not acquire the PGlite process lock at ${dataDir}.`);
}
