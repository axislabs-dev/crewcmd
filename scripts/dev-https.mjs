#!/usr/bin/env node
/**
 * Auto-HTTPS dev proxy for LAN/Tailscale access.
 *
 * 1. Starts Next.js dev on a random internal HTTP port
 * 2. Generates a self-signed cert covering localhost + all detected IPs
 * 3. Runs an HTTPS reverse proxy on the public port (default 3000)
 *
 * No mkcert, no sudo, no external deps. Just openssl (pre-installed on macOS/Linux).
 * Users accept the browser warning once per device, then mic/camera work.
 */
import { execSync, spawn } from "node:child_process";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createNetServer, Socket } from "node:net";
import { request as httpRequest } from "node:http";
import { networkInterfaces } from "node:os";
import { mkdirSync, readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const certDir = join(process.cwd(), ".data", "certs");
mkdirSync(certDir, { recursive: true });

const keyPath = join(certDir, "dev-key.pem");
const certPath = join(certDir, "dev-cert.pem");
const hashFile = join(certDir, ".ip-hash");

// ---------------------------------------------------------------------------
// 1. Collect all IPv4 addresses (LAN, Tailscale, loopback)
// ---------------------------------------------------------------------------
const ips = new Set(["127.0.0.1"]);
const ifaces = networkInterfaces();
for (const addrs of Object.values(ifaces)) {
  if (!addrs) continue;
  for (const addr of addrs) {
    if (addr.family === "IPv4") ips.add(addr.address);
  }
}
const ipList = [...ips];

// ---------------------------------------------------------------------------
// 2. Generate cert if needed (missing, IPs changed, or >30 days old)
// ---------------------------------------------------------------------------
function needsRegen() {
  if (!existsSync(keyPath) || !existsSync(certPath)) return true;
  const age = Date.now() - statSync(certPath).mtimeMs;
  if (age > 30 * 24 * 60 * 60 * 1000) return true;
  const ipHash = createHash("sha256").update(ipList.sort().join(",")).digest("hex").slice(0, 16);
  if (!existsSync(hashFile)) return true;
  return readFileSync(hashFile, "utf8").trim() !== ipHash;
}

if (needsRegen()) {
  const san = ["DNS:localhost", ...ipList.map((ip) => `IP:${ip}`)].join(",");
  const displayIps = ipList.filter((ip) => ip !== "127.0.0.1").join(", ");
  console.log(`\n🔐 Generating HTTPS cert for: localhost${displayIps ? ", " + displayIps : ""}\n`);

  try {
    execSync(
      [
        "openssl req -x509",
        "-newkey ec -pkeyopt ec_paramgen_curve:prime256v1",
        `-keyout "${keyPath}"`,
        `-out "${certPath}"`,
        "-days 365 -nodes",
        "-subj '/CN=CrewCmd Dev'",
        `-addext "subjectAltName=${san}"`,
      ].join(" "),
      { stdio: "pipe" }
    );
  } catch (err) {
    console.error("❌ Failed to generate certificate. Is openssl installed?");
    console.error(err.stderr?.toString() || err.message);
    process.exit(1);
  }

  const ipHash = createHash("sha256").update(ipList.sort().join(",")).digest("hex").slice(0, 16);
  writeFileSync(hashFile, ipHash);
  console.log("✅ Certificate ready\n");
} else {
  console.log("\n🔐 Existing certificate is valid (IPs unchanged)\n");
}

// ---------------------------------------------------------------------------
// 3. Find a free port for the internal Next.js HTTP server
// ---------------------------------------------------------------------------
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const publicPort = parseInt(process.env.PORT || "3000", 10);
const internalPort = await getFreePort();

// ---------------------------------------------------------------------------
// 4. Start Next.js dev on internal HTTP port
// ---------------------------------------------------------------------------
const nextDev = spawn("npx", ["next", "dev", "--port", String(internalPort)], {
  stdio: "inherit",
  env: { ...process.env, PORT: String(internalPort) },
});

// ---------------------------------------------------------------------------
// 5. HTTPS reverse proxy (HTTP requests + WebSocket upgrades)
// ---------------------------------------------------------------------------
const key = readFileSync(keyPath);
const cert = readFileSync(certPath);

const proxy = createHttpsServer({ key, cert }, (req, res) => {
  const proxyReq = httpRequest(
    {
      hostname: "127.0.0.1",
      port: internalPort,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: req.headers.host || `localhost:${internalPort}` },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502);
      res.end("Next.js not ready yet — retry in a moment");
    }
  });
  req.pipe(proxyReq);
});

// WebSocket upgrade passthrough (HMR, future WS endpoints)
proxy.on("upgrade", (req, clientSocket, head) => {
  const upstream = new Socket();
  upstream.connect(internalPort, "127.0.0.1", () => {
    // Reconstruct the HTTP upgrade request to send to Next.js
    const reqHeaders = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${reqHeaders}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);

    // Bi-directional pipe
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
});

proxy.listen(publicPort, "0.0.0.0", () => {
  console.log("\n🔒 HTTPS proxy ready — access from any device:\n");
  for (const ip of ipList) {
    if (ip === "127.0.0.1") continue;
    console.log(`  https://${ip}:${publicPort}`);
  }
  console.log(`  https://localhost:${publicPort}`);
  console.log(`\n⚠️  First visit: accept the self-signed certificate in your browser.`);
  console.log("   iOS: tap 'Show Details' → 'visit this website' → 'Visit Website'\n");
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
function cleanup() {
  nextDev.kill();
  proxy.close();
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
nextDev.on("exit", (code) => {
  proxy.close();
  process.exit(code || 0);
});
