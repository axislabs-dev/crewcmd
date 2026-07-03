import type { DiscoveredAgent, GatewayModel } from "@/lib/gateway-client";

export type SupportedRuntimeType = "openclaw" | "hermes";

export interface RuntimeConnectionRecord {
  id: string;
  runtimeType: string;
  name: string;
  gatewayUrl: string;
  httpUrl: string;
  authToken: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface RuntimeProbeInput {
  url: string;
  token?: string | null;
  name?: string | null;
}

export interface RuntimeProbeResult {
  ok: boolean;
  error?: string;
  agents: DiscoveredAgent[];
  models: GatewayModel[];
  capabilities?: Record<string, unknown>;
  defaultAgentId?: string;
}

export interface RuntimeDiscoveredModel {
  runtimeId: string;
  provider: string;
  id: string;
  name: string;
}

export interface RuntimeProvider {
  readonly type: SupportedRuntimeType;
  readonly displayName: string;

  probe?(input: RuntimeProbeInput): Promise<RuntimeProbeResult>;
  discoverModels(runtime: RuntimeConnectionRecord): Promise<RuntimeDiscoveredModel[]>;
  discoverCapabilities?(runtime: RuntimeConnectionRecord): Promise<Record<string, unknown> | null>;
  discoverSkills?(runtime: RuntimeConnectionRecord): Promise<unknown[]>;
  discoverToolsets?(runtime: RuntimeConnectionRecord): Promise<unknown[]>;
}
