import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emitPactAgentEvent } from "@/lib/agents/events";

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

export async function POST(request: Request) {
  let body: { pactId?: unknown; milestoneId?: unknown; submissionId?: unknown; category?: unknown; statement?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!validId(body.pactId) || (body.milestoneId !== undefined && body.milestoneId !== null && !validId(body.milestoneId)) || (body.submissionId !== undefined && body.submissionId !== null && !validId(body.submissionId)) || typeof body.category !== "string" || typeof body.statement !== "string") {
    return NextResponse.json({ error: "Pact, category, and statement are required." }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to open a dispute." }, { status: 401 });
  const { data: disputeId, error } = await supabase.rpc("open_pact_dispute", {
    target_pact: body.pactId,
    target_milestone: body.milestoneId ?? null,
    target_submission: body.submissionId ?? null,
    target_category: body.category,
    target_statement: body.statement,
  });
  if (error || typeof disputeId !== "string") return NextResponse.json({ error: error?.message ?? "Dispute could not be opened." }, { status: 403 });
  await emitPactAgentEvent(supabase, { pactId: body.pactId, aggregateType: "dispute", aggregateId: disputeId, eventType: "dispute.opened", payload: { disputeId, milestoneId: body.milestoneId ?? null, category: body.category, statement: body.statement }, idempotencyKey: `dispute.opened:${disputeId}` });
  return NextResponse.json({ disputeId, status: "open" });
}

export async function PATCH(request: Request) {
  let body: { disputeId?: unknown; status?: unknown; resolutionType?: unknown; resolutionNote?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!validId(body.disputeId) || (body.status !== "resolved" && body.status !== "dismissed") || (body.resolutionType !== undefined && body.resolutionType !== null && typeof body.resolutionType !== "string") || typeof body.resolutionNote !== "string" || body.resolutionNote.trim().length < 1 || body.resolutionNote.length > 10000) {
    return NextResponse.json({ error: "A dispute, resolution status, and note are required." }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to resolve a dispute." }, { status: 401 });
  const { error } = await supabase.rpc("resolve_pact_dispute", {
    target_dispute: body.disputeId,
    target_status: body.status,
    target_resolution_type: typeof body.resolutionType === "string" ? body.resolutionType : "owner_review",
    target_resolution_note: body.resolutionNote.trim(),
  });
  if (error) return NextResponse.json({ error: error.message.includes("Owner") ? "Only the Pact owner can resolve this dispute." : "The dispute could not be resolved." }, { status: 403 });
  return NextResponse.json({ disputeId: body.disputeId, status: body.status });
}
