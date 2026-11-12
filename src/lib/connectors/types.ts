export type ConnectorProvider = "github" | "figma";

export type ConnectorConnection = {
  id: string;
  pact_id: string;
  provider: ConnectorProvider;
  connected_by: string;
  external_account_id: string;
  external_account_name: string | null;
  resource_id: string | null;
  resource_name: string | null;
  resource_url: string | null;
  resource_filters: Record<string, unknown>;
  scopes: string[];
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: string | null;
  webhook_id: string | null;
  webhook_secret_ciphertext: string | null;
  status: "awaiting_resource" | "active" | "degraded" | "disconnected";
  last_error: string | null;
};

export type GitHubResourceFilters = {
  branch?: string;
  pullRequestStates?: Array<"open" | "closed" | "merged" | "all">;
  workflowNames?: string[];
  workflowConclusions?: string[];
};

export type NormalizedConnectorEvent = {
  eventKey: string;
  externalId: string | null;
  eventType: string;
  occurredAt: string | null;
  actor: string | null;
  resourceId: string | null;
  sourceUrl: string | null;
  summary: string;
  snapshot: Record<string, unknown>;
};

export function isConnectorProvider(value: unknown): value is ConnectorProvider {
  return value === "github" || value === "figma";
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function asNumberString(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : asString(value);
}

export function parseGitHubResourceFilters(value: unknown): GitHubResourceFilters | null {
  if (value === undefined || value === null) return {};
  const candidate = asRecord(value);
  if (!candidate) return null;
  const filters: GitHubResourceFilters = {};
  if (candidate.branch !== undefined) {
    if (typeof candidate.branch !== "string" || candidate.branch.trim().length < 1 || candidate.branch.length > 250 || /[\r\n]/.test(candidate.branch)) return null;
    filters.branch = candidate.branch.trim();
  }
  for (const key of ["pullRequestStates", "workflowNames", "workflowConclusions"] as const) {
    const raw = candidate[key];
    if (raw === undefined) continue;
    if (!Array.isArray(raw) || raw.length > 20 || !raw.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 120)) return null;
    if (key === "pullRequestStates") {
      const states = raw.map((item) => item.trim()).filter((item): item is "open" | "closed" | "merged" | "all" => ["open", "closed", "merged", "all"].includes(item));
      if (states.length !== raw.length) return null;
      filters.pullRequestStates = [...new Set(states)];
    } else if (key === "workflowNames") {
      filters.workflowNames = [...new Set(raw.map((item) => item.trim()))];
    } else {
      filters.workflowConclusions = [...new Set(raw.map((item) => item.trim().toLowerCase()))];
    }
  }
  return filters;
}
