export type SkillProviderId = "clawhub" | "manual" | "github" | "custom";

export type SkillTrustLevel =
  | "official"
  | "verified"
  | "community"
  | "private"
  | "unknown"
  | "untrusted";

export type SkillUpdateStatus =
  | "unknown"
  | "not-installed"
  | "current"
  | "update-available"
  | "pinned"
  | "blocked"
  | "error";

export interface SkillProviderSource {
  provider: SkillProviderId;
  providerSkillId: string;
  registryUrl?: string;
  sourceUrl?: string;
  ownerHandle?: string;
  version?: string;
  integrity?: string;
  installedAt?: string;
}

export interface SkillProviderTrust {
  level: SkillTrustLevel;
  isOfficial?: boolean;
  verificationTier?: string;
  scanStatus?: string;
  sourceRepo?: string;
  sourceCommit?: string;
  hasProvenance?: boolean;
  warnings?: string[];
}

export interface SkillProviderUpdate {
  status: SkillUpdateStatus;
  currentVersion?: string;
  latestVersion?: string;
  checkedAt?: string;
  message?: string;
}

export interface SkillProviderAsset {
  path: string;
  kind: "skill-md" | "script" | "asset" | "config" | "archive";
  sizeBytes?: number;
  sha256?: string;
}

export interface ExternalSkillProviderSummary {
  provider: SkillProviderId;
  slug: string;
  name: string;
  description?: string;
  version?: string;
  source: SkillProviderSource;
  trust: SkillProviderTrust;
  update?: SkillProviderUpdate;
}

export interface ExternalSkillProviderDetail extends ExternalSkillProviderSummary {
  content?: string;
  configSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  assets?: SkillProviderAsset[];
  supportsScripts?: boolean;
}

export interface ExternalSkillImportRequest {
  provider: SkillProviderId;
  slug: string;
  version?: string;
  force?: boolean;
  runtimeId?: string;
  workspaceId: string;
}

export interface ExternalSkillProvider {
  id: SkillProviderId;
  listSkills(params?: {
    query?: string;
    limit?: number;
    runtimeId?: string;
    workspaceId?: string;
  }): Promise<ExternalSkillProviderSummary[]>;
  getSkillDetail(params: {
    slug: string;
    runtimeId?: string;
    workspaceId?: string;
  }): Promise<ExternalSkillProviderDetail>;
  importSkill(params: ExternalSkillImportRequest): Promise<ExternalSkillProviderDetail>;
  checkUpdates(params: {
    slugs?: string[];
    runtimeId?: string;
    workspaceId?: string;
  }): Promise<Record<string, SkillProviderUpdate>>;
}
