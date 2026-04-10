import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export function installHookPack(sourceDir = resolve(import.meta.dirname, "..")) {
  const targetDir = resolve(homedir(), ".openclaw", "hooks", "crewcmd-hooks");
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true, force: true });
  return { targetDir, exists: existsSync(targetDir) };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result = installHookPack();
  console.log(JSON.stringify(result));
}
