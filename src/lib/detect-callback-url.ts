/**
 * Auto-detect the best callback URL for OpenClaw runtimes to reach CrewCmd.
 *
 * Matches the network segment of the gateway URL (Tailscale 100.x, LAN 192.168.x,
 * localhost) and returns a reachable CrewCmd URL on the same segment.
 */

import os from "node:os";

/**
 * Detect the best URL for a runtime to call back into CrewCmd.
 *
 * @param gatewayUrl - The WebSocket URL of the gateway (e.g. ws://100.64.1.5:18789)
 * @returns A full HTTP(S) URL like http://100.64.1.5:3000
 */
export function detectCallbackUrl(gatewayUrl: string): string {
  const parsed = new URL(gatewayUrl);
  const gatewayHost = parsed.hostname;
  const port = process.env.PORT || "3000";
  const useHttps =
    process.env.HTTPS === "true" || process.env.NODE_ENV === "production";
  const scheme = useHttps ? "https" : "http";

  // If gateway is on localhost, just use localhost
  if (
    gatewayHost === "localhost" ||
    gatewayHost === "127.0.0.1" ||
    gatewayHost === "::1"
  ) {
    return `${scheme}://localhost:${port}`;
  }

  // Determine which network prefix to match
  const gatewayPrefix = getNetworkPrefix(gatewayHost);

  // Scan all network interfaces for a matching IP
  const interfaces = os.networkInterfaces();
  for (const [, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.internal || addr.family !== "IPv4") continue;
      const addrPrefix = getNetworkPrefix(addr.address);
      if (addrPrefix && gatewayPrefix && addrPrefix === gatewayPrefix) {
        return `${scheme}://${addr.address}:${port}`;
      }
    }
  }

  // Fallback: try localhost
  console.warn(
    `[detect-callback-url] No matching network interface for gateway ${gatewayHost}, falling back to localhost`
  );
  return `${scheme}://localhost:${port}`;
}

/**
 * Get the network prefix for matching.
 * - Tailscale: 100.x.x.x → "tailscale"
 * - LAN 192.168.x.x → "192.168"
 * - LAN 10.x.x.x → "10"
 * - LAN 172.16-31.x.x → "172"
 */
function getNetworkPrefix(ip: string): string | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return null;

  // Tailscale CGNAT range: 100.64.0.0/10 (100.64.x.x – 100.127.x.x)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
    return "tailscale";
  }

  // Private networks
  if (parts[0] === 192 && parts[1] === 168) return "192.168";
  if (parts[0] === 10) return "10";
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return "172";

  // Public or unknown — match exact /24
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}
