import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateMilestoneInput, verifyMilestone, verifyMilestoneWithProvider } from "@/lib/pact";

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

function criteriaFromBrief(brief: string, title: string) {
  const criteria = brief.split(/[\n.!?]+/).map((item) => item.trim()).filter((item) => item.length >= 8).slice(0, 8);
  return criteria.length ? criteria : [title];
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
  const [{ data: membership }, { data: milestone }, { data: submission }] = await Promise.all([
    supabase.from("workspace_members").select("role").eq("workspace_id", pact.workspace_id).eq("user_id", user.id).maybeSingle(),
    supabase.from("milestones").select("id, title").eq("id", body.milestoneId).eq("pact_id", body.pactId).maybeSingle(),
    supabase.from("pact_submissions").select("id, milestone_id, notes, links, status").eq("id", body.submissionId).eq("pact_id", body.pactId).maybeSingle(),
  ]);
  if (!pact || pact.status !== "active" || membership?.role !== "owner" || !milestone || !submission || submission.milestone_id !== body.milestoneId) {
    return NextResponse.json({ error: "Only the Pact owner can check the latest submitted evidence." }, { status: 403 });
  }
  if (submission.status !== "submitted") return NextResponse.json({ error: "This submission is no longer awaiting review." }, { status: 409 });

  const input = validateMilestoneInput({
    title: milestone.title,
    acceptanceCriteria: criteriaFromBrief(pact.brief, milestone.title),
    evidence: [submission.notes, ...(Array.isArray(submission.links) ? submission.links : [])],
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
  return NextResponse.json({ verification, mode, submissionId: body.submissionId });
}
