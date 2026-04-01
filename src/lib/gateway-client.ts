/**
 * OpenClaw Gateway WebSocket RPC Client
 *
 * Connects to an OpenClaw gateway via WebSocket, performs the handshake,
 * and provides typed RPC methods for agent/model/skill discovery.
 *
 * Used server-side only (API routes). Never runs in the browser.
 */

import WebSocket from "ws";

// ─── Types ──────────────────────────────────────────────────────────

export interface GatewayAgent {
  id: string;
  name?: string;
  identity?: {
    name?: string;
    theme?: string;
    emoji?: string;
    avatar?: string;
    avatarUrl?: string;
  };
}

export interface GatewayAgentsListResult {
  defaultId: string;
  mainKey: string;
  scope: "per-sender" | "global";
  agents: GatewayAgent[];
}

export interface GatewayModel {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  reasoning?: boolean;
}

export interface GatewayModelsListResult {
  models: GatewayModel[];
}

export interface GatewayFileEntry {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
  content?: string;
}

export interface GatewayFilesListResult {
  agentId: string;
  workspace: string;
  files: GatewayFileEntry[];
}

export interface GatewayFileGetResult {
  agentId: string;
  workspace: string;
  file: GatewayFileEntry;
}

export interface DiscoveredAgent {
  id: string;
  name: string;
  emoji: string;
  title: string;
  description: string;
  model?: string;
  workspace?: string;
  identityRaw?: string;
  soulRaw?: string;
}

export interface ProbeResult {
  ok: boolean;
  error?: string;
  version?: string;
  agents: DiscoveredAgent[];
  models: GatewayModel[];
  defaultAgentId?: string;
}

// ─── RPC Client ─────────────────────────────────────────────────────

export class GatewayClient {
  private ws: WebSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private connected = false;
  private serverVersion?: string;
  private grantedScopes: string[] = [];

  constructor(
    private gatewayUrl: string,
    private authToken: string,
    private timeoutMs = 15000
  ) {}

  /**
   * Connect to the gateway and perform the handshake.
   */
  async connect(): Promise<{ version: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close();
        reject(new Error("Connection timeout"));
      }, this.timeoutMs);

      try {
        this.ws = new WebSocket(this.gatewayUrl);
      } catch (err) {
        clearTimeout(timer);
        reject(new Error(`Failed to create WebSocket: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }

      this.ws.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`WebSocket error: ${err.message}`));
      });

      this.ws.on("close", () => {
        this.connected = false;
        // Reject any pending requests
        for (const [, pending] of this.pendingRequests) {
          pending.reject(new Error("Connection closed"));
        }
        this.pendingRequests.clear();
      });

      // Gateway protocol: wait for connect.challenge event, then send connect frame
      this.ws.on("message", (data) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }

        // Step 1: Gateway sends connect.challenge event with a nonce
        if (msg.type === "event") {
          const event = msg.event as string;
          if (event === "connect.challenge") {
            const payload = msg.payload as { nonce?: string } | undefined;
            const nonce = payload?.nonce;
            if (!nonce) {
              clearTimeout(timer);
              reject(new Error("Gateway challenge missing nonce"));
              return;
            }
            // Send connect as an RPC request (type: "req", method: "connect")
            const connectId = `crewcmd-connect-${++this.requestId}`;
            // Register handler for the connect response
            this.pendingRequests.set(connectId, {
              resolve: (value) => {
                clearTimeout(timer);
                this.connected = true;
                const helloOk = value as Record<string, unknown>;
                const server = helloOk.server as { version?: string } | undefined;
                this.serverVersion = server?.version || "unknown";
                const authInfo = helloOk.auth as { scopes?: string[] } | undefined;
                this.grantedScopes = authInfo?.scopes ?? [];
                resolve({ version: this.serverVersion });
              },
              reject: (err) => {
                clearTimeout(timer);
                reject(err);
              },
            });
            const connectFrame = {
              type: "req",
              id: connectId,
              method: "connect",
              params: {
                minProtocol: 1,
                maxProtocol: 1,
                client: {
                  id: "gateway-client" as const,
                  displayName: "CrewCmd",
                  version: "1.0.0",
                  platform: "server",
                  mode: "backend" as const,
                },
                scopes: ["operator.read", "operator.write"],
                auth: {
                  token: this.authToken,
                },
              },
            };
            this.ws!.send(JSON.stringify(connectFrame));
            return;
          }
          // Ignore other events during handshake
          return;
        }

        // Handle RPC responses (gateway uses type: "res")
        // This handles both the connect response and subsequent RPC calls
        if (msg.type === "res") {
          const reqId = msg.id as string;
          const pending = this.pendingRequests.get(reqId);
          if (pending) {
            this.pendingRequests.delete(reqId);
            if (msg.ok === false || msg.error) {
              const errObj = msg.error as { message?: string; code?: string } | undefined;
              const errDetail = errObj?.message || JSON.stringify(msg.error) || "RPC error";
              pending.reject(new Error(errDetail));
            } else {
              pending.resolve(msg.payload ?? msg);
            }
          }
        }
      });
    });
  }

  /**
   * Send an RPC request and wait for the response.
   */
  private async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.connected || !this.ws) {
      throw new Error("Not connected to gateway");
    }

    const requestId = `crewcmd-${++this.requestId}`;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`RPC timeout: ${method}`));
      }, this.timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      // OpenClaw gateway uses RequestFrameSchema: { type: "req", id, method, params }
      const frame = {
        type: "req",
        id: requestId,
        method,
        params,
      };

      this.ws!.send(JSON.stringify(frame));
    });
  }

  /**
   * List all agents on the gateway.
   */
  async listAgents(): Promise<GatewayAgentsListResult> {
    return this.rpc<GatewayAgentsListResult>("agents.list", {});
  }

  /**
   * List available models.
   */
  async listModels(): Promise<GatewayModelsListResult> {
    return this.rpc<GatewayModelsListResult>("models.list", {});
  }

  /**
   * List workspace files for an agent.
   */
  async listAgentFiles(agentId: string): Promise<GatewayFilesListResult> {
    return this.rpc<GatewayFilesListResult>("agents.files.list", { agentId });
  }

  /**
   * Get a specific workspace file for an agent.
   */
  async getAgentFile(agentId: string, name: string): Promise<GatewayFileGetResult> {
    return this.rpc<GatewayFileGetResult>("agents.files.get", { agentId, name });
  }

  /**
   * Create an agent on the gateway.
   */
  async createAgent(params: {
    name: string;
    workspace: string;
    emoji?: string;
    avatar?: string;
  }): Promise<{ ok: true; agentId: string; name: string; workspace: string }> {
    return this.rpc("agents.create", params);
  }

  /**
   * Update an agent on the gateway.
   */
  async updateAgent(params: {
    agentId: string;
    name?: string;
    workspace?: string;
    model?: string;
    avatar?: string;
  }): Promise<{ ok: true; agentId: string }> {
    return this.rpc("agents.update", params);
  }

  /**
   * Write a workspace file for an agent.
   */
  async setAgentFile(
    agentId: string,
    name: string,
    content: string
  ): Promise<{ ok: true }> {
    return this.rpc("agents.files.set", { agentId, name, content });
  }

  /**
   * Close the WebSocket connection.
   */
  close(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;
  }
}

// ─── High-Level Probe ───────────────────────────────────────────────

/**
 * Probe a gateway: connect, discover agents + models, read identity files.
 * Returns a structured ProbeResult. Always closes the connection.
 */
export async function probeGateway(
  gatewayUrl: string,
  authToken: string
): Promise<ProbeResult> {
  const client = new GatewayClient(gatewayUrl, authToken);

  try {
    const { version } = await client.connect();

    // Fetch agents and models in parallel
    const [agentsResult, modelsResult] = await Promise.all([
      client.listAgents().catch(() => null),
      client.listModels().catch(() => null),
    ]);

    if (!agentsResult) {
      return { ok: false, error: "Failed to list agents", agents: [], models: [] };
    }

    // For each agent, try to read IDENTITY.md and SOUL.md
    const discoveredAgents: DiscoveredAgent[] = [];

    // Batch file reads (but don't fail if some are missing)
    const fileReads = agentsResult.agents.map(async (agent) => {
      let identityRaw: string | undefined;
      let soulRaw: string | undefined;

      try {
        const identityResult = await client.getAgentFile(agent.id, "IDENTITY.md");
        if (identityResult.file && !identityResult.file.missing) {
          identityRaw = identityResult.file.content;
        }
      } catch {
        // Identity file doesn't exist, that's fine
      }

      try {
        const soulResult = await client.getAgentFile(agent.id, "SOUL.md");
        if (soulResult.file && !soulResult.file.missing) {
          soulRaw = soulResult.file.content;
        }
      } catch {
        // Soul file doesn't exist, that's fine
      }

      // Parse identity data
      const parsed = parseAgentIdentity(agent, identityRaw, soulRaw);
      discoveredAgents.push(parsed);
    });

    await Promise.all(fileReads);

    return {
      ok: true,
      version,
      agents: discoveredAgents,
      models: modelsResult?.models ?? [],
      defaultAgentId: agentsResult.defaultId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, agents: [], models: [] };
  } finally {
    client.close();
  }
}

// ─── Identity Parsing ───────────────────────────────────────────────

function parseAgentIdentity(
  agent: GatewayAgent,
  identityRaw?: string,
  soulRaw?: string
): DiscoveredAgent {
  let name = agent.identity?.name || agent.name || agent.id;
  let emoji = agent.identity?.emoji || "🤖";
  let title = "Agent";
  let description = "";

  // Parse IDENTITY.md for structured data
  if (identityRaw) {
    const nameMatch = identityRaw.match(/\*\*Name:\*\*\s*(.+)/);
    const emojiMatch = identityRaw.match(/\*\*Emoji:\*\*\s*(.+)/);
    const vibeMatch = identityRaw.match(/\*\*Vibe:\*\*\s*(.+)/);
    const creatureMatch = identityRaw.match(/\*\*Creature:\*\*\s*(.+)/);

    if (nameMatch?.[1]?.trim() && !nameMatch[1].includes("pick something")) {
      name = nameMatch[1].trim();
    }
    if (emojiMatch?.[1]?.trim()) {
      emoji = emojiMatch[1].trim();
    }
    if (creatureMatch?.[1]?.trim() && !creatureMatch[1].includes("_")) {
      title = creatureMatch[1].trim();
    }
    if (vibeMatch?.[1]?.trim() && !vibeMatch[1].includes("_")) {
      description = vibeMatch[1].trim();
    }
  }

  // Parse SOUL.md for richer description
  if (soulRaw) {
    // Look for the first paragraph after any header
    const lines = soulRaw.split("\n").filter((l) => l.trim());
    const descLine = lines.find(
      (l) => !l.startsWith("#") && !l.startsWith("_") && !l.startsWith("-") && l.length > 20
    );
    if (descLine && !description) {
      description = descLine.trim().slice(0, 200);
    }
  }

  return {
    id: agent.id,
    name,
    emoji,
    title,
    description,
    identityRaw,
    soulRaw,
  };
}
