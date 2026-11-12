export const AGENT_NAMES = ["progress", "scope_shield", "dispute_shield", "negotiation"] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

export const AGENT_OUTPUT_MODES = ["ai-provider", "deterministic-fallback", "blocked"] as const;
export type AgentOutputMode = (typeof AGENT_OUTPUT_MODES)[number];

export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "blocked";

export type ProgressOutput = {
  state: "on_track" | "at_risk" | "blocked" | "complete";
  percent: number;
  confidence: number;
  blockers: string[];
  nextActions: string[];
  forecastDueAt: string | null;
  evidenceRefs: string[];
  summary: string;
};

export type ScopeShieldOutput = {
  inScope: boolean;
  severity: "low" | "medium" | "high" | "critical";
  changedItems: string[];
  rationale: string;
  amountDeltaCents: number;
  scheduleDeltaDays: number;
  recommendedAction: "none" | "owner_review" | "draft_change_order";
};

export type DisputeShieldOutput = {
  category: "scope" | "quality" | "delivery" | "payment" | "communication" | "other";
  riskScore: number;
  affectedRefs: string[];
  contradictions: string[];
  recommendedResolution: "human_review" | "request_evidence" | "pause_payment" | "close_as_unfounded";
  paymentHold: boolean;
  summary: string;
};

export type NegotiationOutput = {
  terms: {
    deliverables: string[];
    amountDeltaCents: number;
    scheduleDeltaDays: number;
  };
  rationale: string;
  confidence: number;
  nextMessage: string;
};

export type AgentOutput = ProgressOutput | ScopeShieldOutput | DisputeShieldOutput | NegotiationOutput;

export type AgentContext = Record<string, unknown>;

export type AgentEvent = {
  id: string;
  pactId: string;
  workspaceId: string;
  eventType: string;
  aggregateType: "pact" | "milestone" | "submission" | "payment" | "scope_change" | "dispute" | "negotiation";
  aggregateId: string;
  payload: AgentContext;
  correlationId?: string | null;
};

export type AgentRun = {
  id: string;
  pactId: string;
  workspaceId: string;
  agentName: AgentName;
  status: AgentRunStatus;
  attempt: number;
  inputSnapshot: AgentContext;
};

export type MuseResult<T> = {
  value: T | null;
  mode: "ai-provider" | "provider-unavailable" | "provider-invalid";
  provider: "meta-muse";
  model: string;
  requestId: string;
  inputSha256: string;
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
  validationErrors: string[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength ? value.trim() : null;
}

function stringArray(value: unknown, maxItems = 50, maxLength = 500): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => stringValue(item, maxLength) !== null);
}

function numberValue(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum ? value : null;
}

function integerValue(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function validateProgress(value: unknown): ProgressOutput | null {
  if (!isObject(value)) return null;
  const state = value.state;
  if (state !== "on_track" && state !== "at_risk" && state !== "blocked" && state !== "complete") return null;
  const percent = numberValue(value.percent, 0, 100);
  const confidence = numberValue(value.confidence, 0, 1);
  const summary = stringValue(value.summary, 2000);
  const forecastDueAt = value.forecastDueAt === null || value.forecastDueAt === undefined ? null : stringValue(value.forecastDueAt, 80);
  if (percent === null || confidence === null || summary === null || !stringArray(value.blockers) || !stringArray(value.nextActions) || !stringArray(value.evidenceRefs, 50, 2048) || (value.forecastDueAt !== null && value.forecastDueAt !== undefined && forecastDueAt === null)) return null;
  return { state, percent, confidence, blockers: value.blockers.map((item) => item.trim()), nextActions: value.nextActions.map((item) => item.trim()), forecastDueAt, evidenceRefs: value.evidenceRefs.map((item) => item.trim()), summary };
}

function validateScope(value: unknown): ScopeShieldOutput | null {
  if (!isObject(value)) return null;
  if (typeof value.inScope !== "boolean") return null;
  if (value.severity !== "low" && value.severity !== "medium" && value.severity !== "high" && value.severity !== "critical") return null;
  if (value.recommendedAction !== "none" && value.recommendedAction !== "owner_review" && value.recommendedAction !== "draft_change_order") return null;
  const rationale = stringValue(value.rationale, 4000);
  // Muse sometimes uses null for an unchanged optional delta. Canonicalize
  // that representation to zero because no change is the only safe meaning
  // for a missing scope delta; all non-null values remain strictly validated.
  const amountDeltaCents = integerValue(value.amountDeltaCents ?? 0, -100000000, 100000000);
  const scheduleDeltaDays = integerValue(value.scheduleDeltaDays ?? 0, -3650, 3650);
  if (rationale === null || amountDeltaCents === null || scheduleDeltaDays === null || !stringArray(value.changedItems, 50, 500)) return null;
  return { inScope: value.inScope, severity: value.severity, changedItems: value.changedItems.map((item) => item.trim()), rationale, amountDeltaCents, scheduleDeltaDays, recommendedAction: value.recommendedAction };
}

function validateDispute(value: unknown): DisputeShieldOutput | null {
  if (!isObject(value)) return null;
  if (value.category !== "scope" && value.category !== "quality" && value.category !== "delivery" && value.category !== "payment" && value.category !== "communication" && value.category !== "other") return null;
  if (value.recommendedResolution !== "human_review" && value.recommendedResolution !== "request_evidence" && value.recommendedResolution !== "pause_payment" && value.recommendedResolution !== "close_as_unfounded") return null;
  const riskScore = numberValue(value.riskScore, 0, 1);
  const summary = stringValue(value.summary, 2000);
  if (riskScore === null || summary === null || typeof value.paymentHold !== "boolean" || !stringArray(value.affectedRefs, 50, 2048) || !stringArray(value.contradictions, 50, 1000)) return null;
  return { category: value.category, riskScore, affectedRefs: value.affectedRefs.map((item) => item.trim()), contradictions: value.contradictions.map((item) => item.trim()), recommendedResolution: value.recommendedResolution, paymentHold: value.paymentHold, summary };
}

function validateNegotiation(value: unknown): NegotiationOutput | null {
  if (!isObject(value) || !isObject(value.terms)) return null;
  const rationale = stringValue(value.rationale, 4000);
  const nextMessage = stringValue(value.nextMessage, 2000);
  const confidence = numberValue(value.confidence, 0, 1);
  const amountDeltaCents = integerValue(value.terms.amountDeltaCents, -100000000, 100000000);
  const scheduleDeltaDays = integerValue(value.terms.scheduleDeltaDays, -3650, 3650);
  if (rationale === null || nextMessage === null || confidence === null || amountDeltaCents === null || scheduleDeltaDays === null || !stringArray(value.terms.deliverables, 50, 500)) return null;
  return { terms: { deliverables: value.terms.deliverables.map((item) => item.trim()), amountDeltaCents, scheduleDeltaDays }, rationale, confidence, nextMessage };
}

export function validateAgentOutput(agent: AgentName, value: unknown): AgentOutput | null {
  if (agent === "progress") return validateProgress(value);
  if (agent === "scope_shield") return validateScope(value);
  if (agent === "dispute_shield") return validateDispute(value);
  return validateNegotiation(value);
}

const SENSITIVE_KEY = /(token|secret|password|api[_-]?key|authorization|cookie)/i;

/** Keep untrusted Pact content bounded and remove obvious credential fields before prompting Muse. */
export function sanitizeAgentContext(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (typeof value === "string") return value.length > 4000 ? `${value.slice(0, 4000)}...[truncated]` : value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeAgentContext(item, depth + 1));
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value).slice(0, 80).filter(([key]) => !SENSITIVE_KEY.test(key)).map(([key, item]) => [key, sanitizeAgentContext(item, depth + 1)]));
  }
  return "[unsupported]";
}
