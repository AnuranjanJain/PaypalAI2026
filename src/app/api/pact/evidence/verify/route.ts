import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateMilestoneInput, verifyMilestone, verifyMilestoneWithProvider } from "@/lib/pact";
import { emitPactAgentEvent } from "@/lib/agents/events";

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

function criteriaFromBrief(brief: string, title: string) {
  const criteria = brief.split(/[\n.!?]+/).map((item) => item.trim()).filter((item) => item.length >= 8).slice(0, 8);
  return criteria.length ? criteria : [title];
}

function filterMatches(snapshot: Record<string, unknown>, eventType: string, resourceId: string | null, filters: unknown): boolean {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return true;
  const candidate = filters as Record<string, unknown>;
  if (Array.isArray(candidate.eventTypes) && candidate.eventTypes.every((item) => typeof item === "string") && !candidate.eventTypes.includes(eventType)) return false;
  if (typeof candidate.resourceId === "string" && candidate.resourceId !== resourceId) return false;
  const values = (key: string) => {
    const value = candidate[key];
    if (typeof value !== "string" || !value.trim()) return true;
    const expected = (key === "pullRequest" ? value.trim().replace(/^#/, "") : value.trim()).toLowerCase();
    return [key, key === "pullRequest" ? "number" : "", key === "workflow" ? "name" : "", key === "versionId" ? "version" : "", key === "pageId" ? "page" : "", key === "frameId" ? "frame" : "", key === "nodeId" ? "node" : "", "ref", "branch"].filter(Boolean).some((snapshotKey) => {
      const actual = String(snapshot[snapshotKey] ?? "").toLowerCase();
      return actual === expected || (key === "branch" && actual.endsWith(`/${expected}`));
    });
  };
  return ["branch", "pullRequest", "workflow", "versionId", "pageId", "frameId", "nodeId"].every(values);
}

function evidenceAgeMs(occurredAt: string | null, createdAt: string): number {
  const timestamp = Date.parse(occurredAt ?? createdAt);
  return Number.isFinite(timestamp) ? Math.max(0, Date.now() - timestamp) : Number.POSITIVE_INFINITY;
}

export async function POST(request: Request) {
  let body: { pactId?: unknown; milestoneId?: unknown; submissionId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!validId(body.pactId) || !validId(body.milestoneId) || !validId(body.submissionId)) {
    return NextResponse.json({ error: "Pact, milestone, and submission are required." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to run an evidence check." }, { status: 401 });

  const { data: pact } = await supabase.from("pacts").select("workspace_id, brief, status").eq("id", body.pactId).maybeSingle();
  if (!pact) return NextResponse.json({ error: "Pact not found." }, { status: 404 });
  const [{ data: membership }, { data: milestone }, { data: submission }, { data: connectorEvidence, error: evidenceError }, { data: sourceMappings, error: mappingsError }, { data: mappedConnections, error: connectionsError }, { data: connectorEvents, error: eventsError }] = await Promise.all([
    supabase.from("workspace_members").select("role").eq("workspace_id", pact.workspace_id).eq("user_id", user.id).maybeSingle(),
    supabase.from("milestones").select("id, title").eq("id", body.milestoneId).eq("pact_id", body.pactId).maybeSingle(),
    supabase.from("pact_submissions").select("id, milestone_id, notes, links, status").eq("id", body.submissionId).eq("pact_id", body.pactId).maybeSingle(),
    supabase.from("connector_evidence").select("id, connection_id, event_id, evidence_text, source_url, snapshot, created_at").eq("pact_id", body.pactId).eq("milestone_id", body.milestoneId).order("created_at", { ascending: false }).limit(50),
    supabase.from("pact_milestone_source_mappings").select("connection_id, filters, enabled").eq("pact_id", body.pactId).eq("milestone_id", body.milestoneId).eq("enabled", true),
    supabase.from("connector_connections_public").select("id, status").eq("pact_id", body.pactId),
    supabase.from("connector_events").select("id, event_type, resource_id, occurred_at, processing_status").eq("pact_id", body.pactId).limit(200),
  ]);
  if (!pact || pact.status !== "active" || membership?.role !== "owner" || !milestone || !submission || submission.milestone_id !== body.milestoneId) {
    return NextResponse.json({ error: "Only the Pact owner can check the latest submitted evidence." }, { status: 403 });
  }
  if (submission.status !== "submitted") return NextResponse.json({ error: "This submission is no longer awaiting review." }, { status: 409 });

  const connectorQueryError = evidenceError ?? mappingsError ?? connectionsError ?? eventsError;
  if (connectorQueryError && !/relation .* does not exist|schema cache/i.test(connectorQueryError.message)) {
    return NextResponse.json({ error: "Connector evidence could not be loaded." }, { status: 503 });
  }

  const mappedSources = sourceMappings ?? [];
  const eligibleConnectorEvidence = (connectorEvidence ?? []).filter((evidence) => {
    const mapping = mappedSources.find((item) => item.connection_id === evidence.connection_id);
    const connection = (mappedConnections ?? []).find((item) => item.id === evidence.connection_id);
    const event = (connectorEvents ?? []).find((item) => item.id === evidence.event_id);
    if (!mapping || !connection || connection.status !== "active" || !event || event.processing_status !== "processed") return false;
    if (!filterMatches((evidence.snapshot && typeof evidence.snapshot === "object" && !Array.isArray(evidence.snapshot) ? evidence.snapshot : {}) as Record<string, unknown>, event.event_type, event.resource_id, mapping.filters)) return false;
    const maxAgeHours = Number(process.env.CONNECTOR_EVIDENCE_MAX_AGE_HOURS ?? 168);
    const maxAgeMs = Number.isFinite(maxAgeHours) && maxAgeHours > 0 ? maxAgeHours * 60 * 60 * 1000 : 168 * 60 * 60 * 1000;
    return evidenceAgeMs(event.occurred_at, evidence.created_at) <= maxAgeMs;
  });
  if (mappedSources.length > 0 && eligibleConnectorEvidence.length === 0) {
    return NextResponse.json({ error: "Mapped connector evidence is missing, stale, inaccessible, or no longer matches the selected scope.", code: "connector_evidence_blocked" }, { status: 409 });
  }
  const evidenceForPrompt = mappedSources.length > 0 ? eligibleConnectorEvidence : connectorEvidence ?? [];

  const input = validateMilestoneInput({
    title: milestone.title,
    acceptanceCriteria: criteriaFromBrief(pact.brief, milestone.title),
    evidence: [
      submission.notes,
      ...(Array.isArray(submission.links) ? submission.links : []),
      ...evidenceForPrompt.flatMap((item) => [
        `Connector snapshot: ${item.evidence_text}`,
        item.source_url ?? "",
        item.snapshot ? JSON.stringify(item.snapshot).slice(0, 3000) : "",
      ]).filter(Boolean),
    ],
  });
  if (!input) return NextResponse.json({ error: "The Pact evidence could not be prepared for verification." }, { status: 422 });
  const providerResult = await verifyMilestoneWithProvider(input);
  const verification = providerResult ?? verifyMilestone(input);
  const mode = providerResult ? "ai-provider" : "deterministic-fallback";
  const { error: recordError } = await supabase.rpc("record_pact_verification", {
    target_submission: body.submissionId,
    verification_mode: mode,
    verification_eligible: verification.eligible,
    verification_confidence: verification.confidence,
    verification_passed: verification.passedCriteria,
    verification_missing: verification.missingItems,
    verification_scope: verification.scopeFlags,
    verification_summary: verification.summary,
  });
  if (recordError) {
    const message = recordError.message.toLowerCase();
    if (message.includes("does not exist") || message.includes("schema cache") || recordError.code === "PGRST202") {
      return NextResponse.json({ error: "Verification storage is not enabled. Apply the latest Supabase migration." }, { status: 503 });
    }
    return NextResponse.json({ error: "The evidence check completed but could not be recorded." }, { status: 502 });
  }
  await emitPactAgentEvent(supabase, {
    pactId: body.pactId,
    aggregateType: "submission",
    aggregateId: body.submissionId,
    eventType: "verification.recorded",
    payload: {
      milestoneId: body.milestoneId,
      submissionId: body.submissionId,
      eligible: verification.eligible,
      confidence: verification.confidence,
      mode,
      missingItems: verification.missingItems,
      scopeFlags: verification.scopeFlags,
    },
    idempotencyKey: `verification.recorded:${body.submissionId}`,
  });
  return NextResponse.json({ verification, mode, submissionId: body.submissionId });
}
