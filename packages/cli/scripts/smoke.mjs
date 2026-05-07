#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tmp = await mkdtemp(path.join(tmpdir(), "crewcmd-smoke-"));
const env = {
  ...process.env,
  CREWCMD_CONFIG_DIR: path.join(tmp, "config"),
  CREWCMD_DATA_DIR: path.join(tmp, "data"),
  CREWCMD_STATE_DIR: path.join(tmp, "state"),
};

try {
  execFileSync("node", ["bin/crewcmd.js", "--help"], { cwd: root, env, stdio: "inherit" });
  execFileSync("node", ["bin/crewcmd.js", "--version"], { cwd: root, env, stdio: "inherit" });
  execFileSync("node", ["bin/crewcmd.js", "init", "--mode", "docker", "--yes", "--force", "--port", "3000", "--public-url", "http://localhost:3000"], { cwd: root, env, stdio: "inherit" });
  execFileSync("node", ["bin/crewcmd.js", "doctor", "--offline"], { cwd: root, env, stdio: "inherit" });
} finally {
  await rm(tmp, { recursive: true, force: true });
}
