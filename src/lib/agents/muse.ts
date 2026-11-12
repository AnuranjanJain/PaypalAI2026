import { createHash } from "node:crypto";
import { sanitizeAgentContext, validateAgentOutput, type AgentContext, type AgentName, type AgentOutput, type MuseResult } from "./contracts.ts";

const PROMPT_VERSION = "agent-runtime-v1";

function timeoutMs(): number {
  const configured = Number(process.env.AI_TIMEOUT_MS ?? 30000);
  return Number.isFinite(configured) ? Math.max(5000, Math.min(60000, Math.floor(configured))) : 30000;
}

const PROMPTS: Record<AgentName, string> = {
  progress: "Assess project progress from the supplied Pact context. Return JSON with state (on_track, at_risk, blocked, complete), percent 0..100, confidence 0..1, blockers[], nextActions[], forecastDueAt (ISO string or null), evidenceRefs[], and summary. Do not approve payments or change Pact data.",
  scope_shield: "Compare the requested work with the recorded Pact scope. Return JSON with inScope, severity (low, medium, high, critical), changedItems[], rationale, amountDeltaCents, scheduleDeltaDays, and recommendedAction (none, owner_review, draft_change_order). Use numeric 0 for amountDeltaCents or scheduleDeltaDays when there is no change; never use null. Detection is advisory and must not mutate terms.",
  dispute_shield: "Triage the supplied Pact disagreement. Return JSON with category (scope, quality, delivery, payment, communication, other), riskScore 0..1, affectedRefs[], contradictions[], recommendedResolution (human_review, request_evidence, pause_payment, close_as_unfounded), paymentHold, and summary. Never resolve the dispute.",
  negotiation: "Draft a human-reviewable negotiation proposal. Return JSON with terms.deliverables[], terms.amountDeltaCents, terms.scheduleDeltaDays, rationale, confidence 0..1, and nextMessage. Do not accept terms or change money automatically.",
};

function responseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ text?: unknown }> }> };
  if (typeof value.output_text === "string") return value.output_text;
  const text = value.output?.flatMap((item) => item.content ?? []).map((item) => item.text).find((item): item is string => typeof item === "string");
  return text ?? null;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(trimmed);
}

function hashInput(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function result<T extends AgentOutput>(base: Omit<MuseResult<T>, "validationErrors"> & { validationErrors?: string[] }): MuseResult<T> {
  return { ...base, validationErrors: base.validationErrors ?? [] };
}

export { PROMPT_VERSION };

/** Server-side Meta Muse boundary. No model output is trusted until the typed validator accepts it. */
export async function runMuseStructured(agent: AgentName, context: AgentContext): Promise<MuseResult<AgentOutput>> {
  const model = process.env.AI_MODEL ?? "muse-wonder-1.0";
  const endpoint = process.env.AI_API_URL ?? "https://api.meta.ai/v1/responses";
  const apiKey = process.env.AI_API_KEY ?? process.env.MODEL_API_KEY;
  const requestId = crypto.randomUUID();
  const safeContext = sanitizeAgentContext(context);
  const inputSha256 = hashInput(safeContext);
  const started = Date.now();
  if (!apiKey) {
    return result({ value: null, mode: "provider-unavailable", provider: "meta-muse", model, requestId, inputSha256, latencyMs: 0, errorCode: "provider_not_configured", errorMessage: "Meta Muse is not configured." });
  }
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Request-Id": requestId },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: [{ type: "input_text", text: `${PROMPTS[agent]} Return only a single JSON object. Prompt version: ${PROMPT_VERSION}.` }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(safeContext) }] },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(timeoutMs()),
      cache: "no-store",
    });
    if (!response.ok) return result({ value: null, mode: "provider-unavailable", provider: "meta-muse", model, requestId, inputSha256, latencyMs: Date.now() - started, errorCode: `provider_http_${response.status}`, errorMessage: "Meta Muse returned an unavailable response." });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return result({ value: null, mode: "provider-invalid", provider: "meta-muse", model, requestId, inputSha256, latencyMs: Date.now() - started, errorCode: "provider_invalid_json", errorMessage: "Meta Muse returned invalid JSON.", validationErrors: ["response_json_invalid"] });
    }
    const text = responseText(payload);
    if (!text) return result({ value: null, mode: "provider-invalid", provider: "meta-muse", model, requestId, inputSha256, latencyMs: Date.now() - started, errorCode: "provider_empty_output", errorMessage: "Meta Muse returned no structured output.", validationErrors: ["output_text_missing"] });
    let parsed: unknown;
    try {
      parsed = parseJson(text);
    } catch {
      return result({ value: null, mode: "provider-invalid", provider: "meta-muse", model, requestId, inputSha256, latencyMs: Date.now() - started, errorCode: "provider_invalid_json", errorMessage: "Meta Muse returned invalid structured JSON.", validationErrors: ["output_json_invalid"] });
    }
    const value = validateAgentOutput(agent, parsed);
    if (!value) return result({ value: null, mode: "provider-invalid", provider: "meta-muse", model, requestId, inputSha256, latencyMs: Date.now() - started, errorCode: "provider_schema_invalid", errorMessage: "Meta Muse returned output outside the agent schema.", validationErrors: ["schema_invalid"] });
    return result({ value, mode: "ai-provider", provider: "meta-muse", model, requestId, inputSha256, latencyMs: Date.now() - started });
  } catch (error) {
    const errorCode = error instanceof DOMException && error.name === "TimeoutError" ? "provider_timeout" : "provider_request_failed";
    return result({ value: null, mode: "provider-unavailable", provider: "meta-muse", model, requestId, inputSha256, latencyMs: Date.now() - started, errorCode, errorMessage: "Meta Muse could not be reached." });
  }
}
