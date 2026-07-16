import { PGlite } from "@electric-sql/pglite";
import {
  access,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  acquirePgliteProcessLock,
  getPgliteProcessLockStatus,
} from "./pglite-process-lock";

interface ArchiveOptions {
  archivePath: string;
  dataDir: string;
}

export function parseArchiveCommand(argv: string[]): {
  archiveArgument: string;
  command: "backup" | "restore";
} {
  const [command, ...argumentsAfterCommand] = argv;
  const archiveArgument =
    argumentsAfterCommand[0] === "--"
      ? argumentsAfterCommand[1]
      : argumentsAfterCommand[0];

  if (!archiveArgument || (command !== "backup" && command !== "restore")) {
    throw new Error(
      "Usage: pglite-archive <backup|restore> <archive.tar.gz>",
    );
  }

  return { archiveArgument, command };
}

export function resolvePgliteDataDir(
  cwd = process.cwd(),
  configuredPath = process.env.CREWCMD_PGLITE_DATA_DIR,
): string {
  return configuredPath
    ? path.resolve(cwd, configuredPath)
    : path.join(cwd, ".data", "pglite");
}

async function assertStopped(dataDir: string): Promise<void> {
  try {
    await access(path.join(dataDir, "postmaster.pid"));
  } catch {
    return;
  }

  const lockStatus = getPgliteProcessLockStatus(dataDir);
  if (lockStatus.state === "stale") return;

  throw new Error(
    `PGlite appears to be running at ${dataDir}. Stop CrewCMD before backing it up.`,
  );
}

export async function backupPglite({
  archivePath,
  dataDir,
}: ArchiveOptions): Promise<void> {
  const entries = await readdir(dataDir).catch(() => []);
  if (entries.length === 0) {
    throw new Error(`No PGlite database found at ${dataDir}.`);
  }
  await assertStopped(dataDir);

  const releaseProcessLock = acquirePgliteProcessLock(dataDir);
  let client: PGlite | undefined;
  try {
    client = await PGlite.create(dataDir);
    const archive = await client.dumpDataDir("gzip");
    const bytes = new Uint8Array(await archive.arrayBuffer());
    await mkdir(path.dirname(archivePath), { recursive: true });
    await writeFile(archivePath, bytes, { flag: "wx", mode: 0o600 });
  } finally {
    await client?.close();
    releaseProcessLock();
  }
}

export async function restorePglite({
  archivePath,
  dataDir,
}: ArchiveOptions): Promise<void> {
  const entries = await readdir(dataDir).catch(() => []);
  if (entries.length > 0) {
    throw new Error(
      `Refusing to overwrite non-empty PGlite data directory: ${dataDir}`,
    );
  }

  const archiveBytes = await readFile(archivePath);
  const archive = new Blob([new Uint8Array(archiveBytes)]);
  await mkdir(path.dirname(dataDir), { recursive: true });

  const releaseProcessLock = acquirePgliteProcessLock(dataDir);
  try {
    const client = await PGlite.create({ dataDir, loadDataDir: archive });
    await client.close();
  } finally {
    releaseProcessLock();
  }
}

async function main(): Promise<void> {
  if (process.env.DATABASE_URL) {
    throw new Error(
      "PGlite archive commands cannot be used while DATABASE_URL is configured.",
    );
  }

  const { archiveArgument, command } = parseArchiveCommand(
    process.argv.slice(2),
  );

  const dataDir = resolvePgliteDataDir();
  const archivePath = path.resolve(process.cwd(), archiveArgument);

  if (command === "backup") {
    await backupPglite({ archivePath, dataDir });
    console.log(`PGlite backup written to ${archivePath}`);
    return;
  }

  await restorePglite({ archivePath, dataDir });
  console.log(`PGlite backup restored to ${dataDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
