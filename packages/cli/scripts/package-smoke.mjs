#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = await mkdtemp(path.join(tmpdir(), "crewcmd-package-smoke-"));

try {
  const packJson = execFileSync("npm", ["pack", "--json"], { cwd: root, encoding: "utf8" });
  const [pack] = JSON.parse(packJson);
  const tarball = path.join(root, pack.filename);
  await writeFile(path.join(tmp, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2));
  execFileSync("npm", ["install", tarball], { cwd: tmp, stdio: "inherit" });
  const env = {
    ...process.env,
    CREWCMD_CONFIG_DIR: path.join(tmp, "config"),
    CREWCMD_DATA_DIR: path.join(tmp, "data"),
    CREWCMD_STATE_DIR: path.join(tmp, "state"),
  };
  execFileSync("npx", ["crewcmd", "--help"], { cwd: tmp, env, stdio: "inherit" });
  execFileSync("npx", ["crewcmd", "--version"], { cwd: tmp, env, stdio: "inherit" });
  execFileSync("npx", ["crewcmd", "init", "--mode", "docker", "--yes", "--port", "3000", "--public-url", "http://localhost:3000"], { cwd: tmp, env, stdio: "inherit" });
  execFileSync("npx", ["crewcmd", "doctor", "--offline"], { cwd: tmp, env, stdio: "inherit" });
  console.log(`package smoke passed for ${pack.filename}`);
} finally {
  await rm(tmp, { recursive: true, force: true });
}
