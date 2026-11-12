import type { AgentContext, AgentName, AgentOutput, DisputeShieldOutput, NegotiationOutput, ProgressOutput, ScopeShieldOutput } from "./contracts.ts";

function record(value: unknown): AgentContext {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AgentContext : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function contextText(context: AgentContext): string {
  const event = record(context.event);
  const submission = record(context.submission);
  const requestedScope = record(context.requestedScope);
  return [
    text(context.text),
    text(context.statement),
    text(context.notes),
    text(submission.notes),
    text(event.description),
    text(requestedScope.description),
    Array.isArray(requestedScope.deliverables) ? requestedScope.deliverables.map(text).join(" ") : "",
  ].filter(Boolean).join(" ");
}

export function fallbackProgress(context: AgentContext): ProgressOutput {
  const milestone = record(context.milestone);
  const submission = record(context.submission);
  const verification = record(context.verification);
  const payment = record(context.payment);
  const milestoneStatus = text(milestone.status);
  const submissionStatus = text(submission.status);
  const paymentStatus = text(payment.status);
  if (["captured", "payout_pending", "paid_to_provider"].includes(paymentStatus)) {
    return { state: "complete", percent: 100, confidence: 0.9, blockers: [], nextActions: [], forecastDueAt: null, evidenceRefs: [], summary: "The milestone payment has been recorded." };
  }
  if (milestoneStatus === "revision_requested" || submissionStatus === "revision_requested" || verification.eligible === false) {
    return { state: "blocked", percent: 25, confidence: 0.78, blockers: ["Evidence needs revision before owner approval."], nextActions: ["Address the missing evidence and resubmit."], forecastDueAt: null, evidenceRefs: [], summary: "Progress is blocked until the requested revision is addressed." };
  }
  if (milestoneStatus === "approved" || verification.eligible === true) {
    return { state: "on_track", percent: 75, confidence: 0.78, blockers: [], nextActions: ["Owner can review the approved milestone."], forecastDueAt: null, evidenceRefs: [], summary: "The milestone has passed the evidence gate and is ready for the owner decision." };
  }
  if (submissionStatus === "submitted" || milestoneStatus === "submitted") {
    return { state: "on_track", percent: 50, confidence: 0.68, blockers: [], nextActions: ["Run the evidence check and review the result."], forecastDueAt: null, evidenceRefs: [], summary: "Evidence is submitted and awaiting the review path." };
  }
  return { state: "on_track", percent: 0, confidence: 0.55, blockers: [], nextActions: ["Collect evidence for the next milestone."], forecastDueAt: null, evidenceRefs: [], summary: "No completed milestone evidence has been recorded yet." };
}

export function fallbackScopeShield(context: AgentContext): ScopeShieldOutput {
  const source = contextText(context).toLowerCase();
  const changedItems = [
    ["mobile app", "Mobile app deliverable"],
    ["native app", "Native app deliverable"],
    ["also create", "Additional deliverable"],
    ["new deliverable", "Additional deliverable"],
    ["outside this pact", "Work outside the Pact"],
    ["outside scope", "Work outside the agreed scope"],
  ].filter(([needle]) => source.includes(needle)).map(([, label]) => label);
  if (changedItems.length > 0) {
    return { inScope: false, severity: "high", changedItems: [...new Set(changedItems)], rationale: "The request contains a deliverable pattern that is not part of the recorded milestone scope.", amountDeltaCents: 0, scheduleDeltaDays: 0, recommendedAction: "draft_change_order" };
  }
  return { inScope: true, severity: "low", changedItems: [], rationale: "No deterministic out-of-scope deliverable was detected.", amountDeltaCents: 0, scheduleDeltaDays: 0, recommendedAction: "none" };
}

export function fallbackDisputeShield(context: AgentContext): DisputeShieldOutput {
  const statement = contextText(context).toLowerCase();
  const paymentRelated = statement.includes("payment") || statement.includes("payout") || statement.includes("charge");
  const category = paymentRelated ? "payment" : statement.includes("scope") ? "scope" : statement.includes("quality") ? "quality" : "other";
  return {
    category,
    riskScore: 0.55,
    affectedRefs: [],
    contradictions: [],
    recommendedResolution: "human_review",
    paymentHold: true,
    summary: "A human review is required before the affected payment or payout can continue.",
  };
}

export function fallbackNegotiation(context: AgentContext): NegotiationOutput {
  const requested = record(context.requestedTerms);
  const deliverables = Array.isArray(requested.deliverables) ? requested.deliverables.map(text).filter(Boolean).slice(0, 50) : [];
  return {
    terms: { deliverables, amountDeltaCents: 0, scheduleDeltaDays: 0 },
    rationale: "A structured proposal needs human confirmation before it can change Pact terms.",
    confidence: 0.35,
    nextMessage: "Please confirm the requested deliverables, amount, and schedule before sending a proposal.",
  };
}

export function deterministicFallback(agent: AgentName, context: AgentContext): AgentOutput {
  if (agent === "progress") return fallbackProgress(context);
  if (agent === "scope_shield") return fallbackScopeShield(context);
  if (agent === "dispute_shield") return fallbackDisputeShield(context);
  return fallbackNegotiation(context);
}
