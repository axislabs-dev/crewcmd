#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, platform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";

const VERSION = "0.1.1";
const REPO = "rogerchappel/crewcmd";
const DEFAULT_PORT = 3000;

function usage() {
  return `crewcmd ${VERSION}

Self-host and operate CrewCmd.

Usage:
  crewcmd init [--mode docker|node] [--port 3000] [--public-url URL] [--tailscale] [--yes] [--force]
  crewcmd doctor [--offline]
  crewcmd server start [--mode docker|node] [--version vX.Y.Z]
  crewcmd server stop
  crewcmd server restart
  crewcmd server status
  crewcmd server logs
  crewcmd server open
  crewcmd server upgrade [--version vX.Y.Z]
  crewcmd config path
  crewcmd config print
  crewcmd --help
  crewcmd --version
`;
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [name, inlineValue] = arg.slice(2).split("=", 2);
    if (["yes", "force", "offline", "tailscale", "help", "version"].includes(name)) {
      flags[name] = true;
      continue;
    }
    const value = inlineValue ?? argv[i + 1];
    if (inlineValue === undefined) i += 1;
    flags[name] = value;
  }
  return { positionals, flags };
}

function appPaths(env = process.env) {
  const home = env.HOME || homedir();
  const xdgConfig = env.XDG_CONFIG_HOME || path.join(home, ".config");
  const xdgData = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  const xdgState = env.XDG_STATE_HOME || path.join(home, ".local", "state");
  const configDir = env.CREWCMD_CONFIG_DIR || path.join(xdgConfig, "crewcmd");
  const dataDir = env.CREWCMD_DATA_DIR || path.join(xdgData, "crewcmd");
  const stateDir = env.CREWCMD_STATE_DIR || path.join(xdgState, "crewcmd");
  return {
    configDir,
    dataDir,
    stateDir,
    envPath: path.join(configDir, ".env"),
    composePath: path.join(configDir, "docker-compose.yml"),
    configPath: path.join(configDir, "config.json"),
    pidPath: path.join(stateDir, "crewcmd.pid"),
    logPath: path.join(stateDir, "crewcmd.log"),
    releasesDir: path.join(dataDir, "releases"),
  };
}

function defaultPublicUrl(port, tailscale, publicUrl) {
  if (publicUrl) return publicUrl;
  return tailscale ? "" : `http://localhost:${port}`;
}

function validateInit({ mode, port, publicUrl, tailscale }) {
  if (!["docker", "node"].includes(mode)) throw new Error("--mode must be docker or node");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be between 1 and 65535");
  if (tailscale && !publicUrl) throw new Error("--tailscale requires --public-url https://name.tailnet.ts.net");
  if (publicUrl) {
    const parsed = new URL(publicUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("--public-url must be http or https");
  }
}

function secret(bytes = 32, encoding = "base64") {
  return randomBytes(bytes).toString(encoding);
}

function renderEnv(config) {
  const postgresPassword = config.postgresPassword || secret(18, "hex");
  return [
    `POSTGRES_PASSWORD="${postgresPassword}"`,
    `AUTH_SECRET="${config.authSecret || secret(32, "base64")}"`,
    `HEARTBEAT_SECRET="${config.heartbeatSecret || secret(32, "hex")}"`,
    `NEXT_PUBLIC_APP_URL="${config.publicUrl}"`,
    `APP_PORT=${config.port}`,
    "POSTGRES_PORT=5432",
    `CREWCMD_MODE="${config.mode}"`,
    config.databaseUrl ? `DATABASE_URL="${config.databaseUrl}"` : "",
    config.openclawGatewayUrl ? `OPENCLAW_GATEWAY_URL="${config.openclawGatewayUrl}"` : "",
  ].filter(Boolean).join("\n") + "\n";
}

function renderCompose(config) {
  const image = config.image || "ghcr.io/rogerchappel/crewcmd:latest";
  return `services:
  db:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: crewcmd
      POSTGRES_USER: crewcmd
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-crewcmd}
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U crewcmd -d crewcmd"]
      interval: 5s
      timeout: 3s
      retries: 10

  app:
    image: ${image}
    restart: unless-stopped
    ports:
      - "\${APP_PORT:-${config.port}}:3000"
    environment:
      DATABASE_URL: postgresql://crewcmd:\${POSTGRES_PASSWORD:-crewcmd}@db:5432/crewcmd
      AUTH_SECRET: \${AUTH_SECRET}
      NEXT_PUBLIC_APP_URL: \${NEXT_PUBLIC_APP_URL:-http://localhost:${config.port}}
      BLOB_READ_WRITE_TOKEN: \${BLOB_READ_WRITE_TOKEN:-}
      HEARTBEAT_SECRET: \${HEARTBEAT_SECRET:-}
      OPENCLAW_GATEWAY_URL: \${OPENCLAW_GATEWAY_URL:-}
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/api/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s

volumes:
  pgdata:
`;
}

function redactedEnv(text) {
  return text.replace(/^(AUTH_SECRET|HEARTBEAT_SECRET|POSTGRES_PASSWORD|DATABASE_URL)=.*$/gm, "$1=<redacted>");
}

async function readConfig(paths = appPaths()) {
  if (!existsSync(paths.configPath)) return null;
  return JSON.parse(await readFile(paths.configPath, "utf8"));
}

async function writeConfig(config, paths = appPaths()) {
  await mkdir(paths.configDir, { recursive: true });
  await mkdir(paths.dataDir, { recursive: true });
  await mkdir(paths.stateDir, { recursive: true });
  await writeFile(paths.configPath, JSON.stringify(config, null, 2) + "\n");
  await writeFile(paths.envPath, renderEnv(config));
  if (config.mode === "docker") await writeFile(paths.composePath, renderCompose(config));
}

async function initCommand(flags) {
  const paths = appPaths();
  const port = Number(flags.port || DEFAULT_PORT);
  const mode = flags.mode || "docker";
  const publicUrl = defaultPublicUrl(port, Boolean(flags.tailscale), flags["public-url"]);
  validateInit({ mode, port, publicUrl, tailscale: Boolean(flags.tailscale) });
  if (existsSync(paths.configPath) && !flags.force) {
    throw new Error(`CrewCmd is already initialized at ${paths.configPath}; pass --force to overwrite`);
  }
  const config = {
    schemaVersion: 1,
    mode,
    port,
    publicUrl,
    tailscale: Boolean(flags.tailscale),
    bindHost: "0.0.0.0",
    repo: REPO,
    serverVersion: flags.version || `v${VERSION}`,
    createdAt: new Date().toISOString(),
  };
  await writeConfig(config, paths);
  console.log(`created ${paths.configPath}`);
  console.log(`mode: ${mode}`);
  console.log(`publicUrl: ${publicUrl}`);
}

async function health(config) {
  const url = new URL("/api/health", `http://127.0.0.1:${config?.port || DEFAULT_PORT}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function doctorCommand(flags) {
  const paths = appPaths();
  const config = await readConfig(paths);
  const checks = [];
  checks.push({ name: "config", ok: Boolean(config), detail: config ? paths.configPath : "run crewcmd init" });
  checks.push({ name: "node", ok: Number(process.versions.node.split(".")[0]) >= 20, detail: process.version });
  if (config?.mode === "docker") checks.push({ name: "compose", ok: existsSync(paths.composePath), detail: paths.composePath });
  if (config?.publicUrl) checks.push({ name: "public url", ok: true, detail: config.publicUrl });
  if (!flags.offline && config) {
    try {
      const result = await health(config);
      checks.push({ name: "health", ok: result.ok, detail: `${result.status} ${JSON.stringify(result.body)}` });
    } catch (error) {
      checks.push({ name: "health", ok: false, detail: error.message });
    }
  } else {
    checks.push({ name: "health", ok: true, detail: "offline check skipped" });
  }
  for (const check of checks) console.log(`${check.ok ? "ok" : "fail"} ${check.name}: ${check.detail}`);
  return checks.every((check) => check.ok) ? 0 : 1;
}

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: options.stdio || "inherit", cwd: options.cwd, env: options.env || process.env, detached: options.detached || false });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve(0) : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`)));
    if (options.unref) child.unref();
  });
}

async function compose(args) {
  const paths = appPaths();
  if (!existsSync(paths.composePath)) throw new Error("Docker mode is not initialized; run crewcmd init --mode docker");
  return run("docker", ["compose", "--env-file", paths.envPath, "-f", paths.composePath, ...args]);
}

async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(target, bytes);
  return createHash("sha256").update(bytes).digest("hex");
}

function releaseUrl(version) {
  const tag = version?.startsWith("v") ? version : `v${version || VERSION}`;
  return `https://github.com/${REPO}/releases/download/${tag}/crewcmd-server-${tag}.tar.gz`;
}

async function ensureReleaseBundle(version) {
  const paths = appPaths();
  const tag = version?.startsWith("v") ? version : `v${version || VERSION}`;
  const releaseDir = path.join(paths.releasesDir, tag);
  const archivePath = path.join(releaseDir, `crewcmd-server-${tag}.tar.gz`);
  if (!existsSync(archivePath)) {
    await mkdir(releaseDir, { recursive: true });
    const sha = await download(releaseUrl(tag), archivePath);
    await writeFile(path.join(releaseDir, "SHA256"), `${sha}  ${path.basename(archivePath)}\n`);
  }
  return { tag, releaseDir, archivePath };
}

async function nodeStart(config, flags) {
  const paths = appPaths();
  if (existsSync(paths.pidPath)) throw new Error(`server pid file exists at ${paths.pidPath}`);
  const { releaseDir, archivePath } = await ensureReleaseBundle(flags.version || config.serverVersion);
  await run("tar", ["-xzf", archivePath, "-C", releaseDir, "--strip-components", "1"]);
  const serverPath = path.join(releaseDir, "server.js");
  if (!existsSync(serverPath)) throw new Error(`release bundle missing server.js after extraction: ${releaseDir}`);
  const log = await import("node:fs").then((fs) => fs.openSync(paths.logPath, "a"));
  const envText = existsSync(paths.envPath) ? await readFile(paths.envPath, "utf8") : "";
  const env = { ...process.env, ...parseEnv(envText), HOSTNAME: "0.0.0.0", PORT: String(config.port), NODE_ENV: "production" };
  const child = spawn(process.execPath, [serverPath], { cwd: releaseDir, env, detached: true, stdio: ["ignore", log, log] });
  await writeFile(paths.pidPath, `${child.pid}\n`);
  child.unref();
  console.log(`started CrewCmd node server pid ${child.pid}`);
}

function parseEnv(text) {
  const env = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  return env;
}

async function nodeStop() {
  const paths = appPaths();
  if (!existsSync(paths.pidPath)) {
    console.log("CrewCmd node server is not running");
    return;
  }
  const pid = Number((await readFile(paths.pidPath, "utf8")).trim());
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
  await rm(paths.pidPath, { force: true });
  console.log(`stopped CrewCmd node server pid ${pid}`);
}

async function nodeStatus() {
  const paths = appPaths();
  if (!existsSync(paths.pidPath)) {
    console.log("stopped");
    return 1;
  }
  const pid = Number((await readFile(paths.pidPath, "utf8")).trim());
  try {
    process.kill(pid, 0);
    console.log(`running pid ${pid}`);
    return 0;
  } catch {
    console.log(`stale pid ${pid}`);
    return 1;
  }
}

async function serverCommand(action, flags) {
  const paths = appPaths();
  const config = await readConfig(paths);
  if (!config && !["status", "logs"].includes(action)) throw new Error("CrewCmd is not initialized; run crewcmd init");
  const mode = flags.mode || config?.mode || "docker";
  if (action === "start") return mode === "docker" ? compose(["up", "-d"]) : nodeStart(config, flags);
  if (action === "stop") return mode === "docker" ? compose(["down"]) : nodeStop();
  if (action === "restart") {
    await serverCommand("stop", { ...flags, mode });
    return serverCommand("start", { ...flags, mode });
  }
  if (action === "status") return mode === "docker" ? compose(["ps"]) : nodeStatus();
  if (action === "logs") return mode === "docker" ? compose(["logs", "-f", "--tail", "100"]) : run("tail", ["-f", paths.logPath]);
  if (action === "open") {
    const url = config.publicUrl || `http://localhost:${config.port}`;
    const opener = platform() === "darwin" ? "open" : "xdg-open";
    return run(opener, [url]);
  }
  if (action === "upgrade") {
    if (mode === "node") await ensureReleaseBundle(flags.version || config.serverVersion);
    if (mode === "docker") await compose(["pull"]);
    console.log("upgrade assets prepared; run crewcmd server restart");
    return;
  }
  throw new Error(`unknown server command: ${action}`);
}

async function configCommand(action) {
  const paths = appPaths();
  if (action === "path") {
    console.log(paths.configPath);
    return;
  }
  if (action === "print") {
    const config = await readConfig(paths);
    if (!config) throw new Error("CrewCmd is not initialized; run crewcmd init");
    console.log(JSON.stringify(config, null, 2));
    if (existsSync(paths.envPath)) console.log(`\n# ${paths.envPath}\n${redactedEnv(await readFile(paths.envPath, "utf8"))}`);
    return;
  }
  throw new Error(`unknown config command: ${action}`);
}

export const internals = {
  appPaths,
  defaultPublicUrl,
  parseArgs,
  redactedEnv,
  renderCompose,
  renderEnv,
  validateInit,
};

export async function main(argv = process.argv.slice(2)) {
  const { positionals, flags } = parseArgs(argv);
  if (flags.help || positionals[0] === "help" || argv.length === 0) {
    console.log(usage());
    return 0;
  }
  if (flags.version || positionals[0] === "version") {
    console.log(VERSION);
    return 0;
  }
  const [command, subcommand] = positionals;
  if (command === "init") return initCommand(flags);
  if (command === "doctor") return doctorCommand(flags);
  if (command === "server") return serverCommand(subcommand, flags);
  if (command === "config") return configCommand(subcommand);
  throw new Error(`unknown command: ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code ?? 0;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
