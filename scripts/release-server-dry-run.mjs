#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const pkg = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(path.join(root, "package.json"), "utf8")));
const version = process.env.GITHUB_REF_NAME || `v${pkg.version}`;
const outDir = path.join(root, ".release-dry-run");
const bundleRoot = path.join(outDir, `crewcmd-server-${version}`);
const archive = path.join(outDir, `crewcmd-server-${version}.tar.gz`);

function required(file) {
  const target = path.join(bundleRoot, file);
  if (!existsSync(target)) throw new Error(`server bundle missing ${file}`);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(bundleRoot, { recursive: true });

execFileSync("pnpm", ["build"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_OUTPUT: "standalone",
    AUTH_SECRET: process.env.AUTH_SECRET || "release-dry-run-placeholder",
  },
});

execFileSync("cp", ["-R", ".next/standalone/.", bundleRoot], { cwd: root, stdio: "inherit" });
execFileSync("cp", ["-R", ".next/static", path.join(bundleRoot, ".next/static")], { cwd: root, stdio: "inherit" });
if (existsSync(path.join(root, "public"))) execFileSync("cp", ["-R", "public", path.join(bundleRoot, "public")], { cwd: root, stdio: "inherit" });
if (existsSync(path.join(root, "drizzle"))) execFileSync("cp", ["-R", "drizzle", path.join(bundleRoot, "drizzle")], { cwd: root, stdio: "inherit" });
await writeFile(path.join(bundleRoot, "crewcmd-server-manifest.json"), JSON.stringify({
  name: "crewcmd-server",
  version,
  generatedAt: new Date().toISOString(),
  entrypoint: "server.js",
}, null, 2) + "\n");

required("server.js");
required(".next/static");
required("public");
required("drizzle");
required("package.json");
required("crewcmd-server-manifest.json");

execFileSync("tar", ["-czf", archive, "-C", outDir, `crewcmd-server-${version}`], { cwd: root, stdio: "inherit" });
console.log(`server release dry-run passed: ${archive}`);
