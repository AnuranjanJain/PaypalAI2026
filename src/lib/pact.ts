export type VerificationResult = {
  eligible: boolean;
  confidence: number;
  passedCriteria: string[];
  missingItems: string[];
  scopeFlags: string[];
  summary: string;
};

export type MilestoneInput = {
  title: string;
  acceptanceCriteria: string[];
  evidence: string[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 500);
}

export function validateMilestoneInput(value: unknown): MilestoneInput | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MilestoneInput>;
  if (typeof candidate.title !== "string" || candidate.title.trim().length < 1 || candidate.title.length > 200) return null;
  if (!isStringArray(candidate.acceptanceCriteria) || candidate.acceptanceCriteria.length < 1 || candidate.acceptanceCriteria.length > 25) return null;
  if (!isStringArray(candidate.evidence) || candidate.evidence.length > 50) return null;
  return { title: candidate.title.trim(), acceptanceCriteria: candidate.acceptanceCriteria.map((item) => item.trim()), evidence: candidate.evidence.map((item) => item.trim()) };
}

function parseProviderResult(value: unknown, input: MilestoneInput): VerificationResult | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Partial<VerificationResult>;
  const isResultArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length <= 500);
  if (typeof result.eligible !== "boolean" || typeof result.confidence !== "number" || !isResultArray(result.passedCriteria) || !isResultArray(result.missingItems) || !isResultArray(result.scopeFlags) || typeof result.summary !== "string") return null;
  if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1 || result.summary.length > 1000) return null;
  return { eligible: result.eligible, confidence: result.confidence, passedCriteria: result.passedCriteria, missingItems: result.missingItems, scopeFlags: result.scopeFlags, summary: result.summary || `${input.title} was reviewed.` };
}

function extractResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as { output_text?: unknown; output?: Array<{ content?: Array<{ text?: unknown }> }> };
  if (typeof value.output_text === "string") return value.output_text;
  const text = value.output?.flatMap((item) => item.content ?? []).map((item) => item.text).find((item): item is string => typeof item === "string");
  return text ?? null;
}

/** Optional Responses API provider boundary. Secrets stay server-side and failures use the safe demo result. */
export async function verifyMilestoneWithProvider(input: MilestoneInput): Promise<VerificationResult | null> {
  const endpoint = process.env.AI_API_URL ?? "https://api.meta.ai/v1/responses";
  const apiKey = process.env.AI_API_KEY ?? process.env.MODEL_API_KEY;
  if (!endpoint || !apiKey) return null;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: process.env.AI_MODEL ?? "muse-wonder-1.0", input: [{ role: "user", content: [{ type: "input_text", text: `Return only valid JSON matching VerificationResult with eligible boolean, confidence number 0..1, passedCriteria string[], missingItems string[], scopeFlags string[], and summary string. Review this milestone:\n${JSON.stringify(input)}` }] }], stream: false }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const content = extractResponseText(await response.json());
    if (!content) return null;
    return parseProviderResult(JSON.parse(content), input);
  } catch {
    return null;
  }
}

/** Deterministic fallback used by the demo until an AI provider is configured. */
export function verifyMilestone(input: MilestoneInput): VerificationResult {
  const evidence = new Set(input.evidence.map((item) => item.toLowerCase()));
  const missingItems = input.acceptanceCriteria.filter((criterion) => {
    const words = criterion.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
    return !words.some((word) => [...evidence].some((item) => item.includes(word)));
  });
  const passedCriteria = input.acceptanceCriteria.filter((criterion) => !missingItems.includes(criterion));
  const eligible = missingItems.length === 0;
  return {
    eligible,
    confidence: eligible ? 0.92 : Math.max(0.4, 0.92 - missingItems.length * 0.12),
    passedCriteria,
    missingItems,
    scopeFlags: [],
    summary: eligible ? `${input.title} is ready for owner review.` : `${input.title} needs revision before payment can proceed.`,
  };
}
