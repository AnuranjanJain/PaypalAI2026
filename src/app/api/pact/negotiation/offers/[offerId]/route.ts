import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emitPactAgentEvent } from "@/lib/agents/events";

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

export async function POST(request: Request, context: { params: Promise<{ offerId: string }> }) {
  const { offerId } = await context.params;
  if (!validId(offerId)) return NextResponse.json({ error: "A valid offer is required." }, { status: 400 });
  let body: { decision?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (body.decision !== "accepted" && body.decision !== "rejected") return NextResponse.json({ error: "Choose accepted or rejected." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to respond to a negotiation offer." }, { status: 401 });
  const { data: offer } = await supabase.from("negotiation_offers").select("id, pact_id, session_id").eq("id", offerId).maybeSingle();
  if (!offer) return NextResponse.json({ error: "Negotiation offer not found." }, { status: 404 });
  const { error } = await supabase.rpc("respond_to_negotiation_offer", { target_offer: offerId, target_decision: body.decision });
  if (error) return NextResponse.json({ error: error.message }, { status: 403 });
  await emitPactAgentEvent(supabase, { pactId: offer.pact_id, aggregateType: "negotiation", aggregateId: offer.session_id, eventType: "negotiation.offer_responded", payload: { offerId, decision: body.decision }, idempotencyKey: `negotiation.offer_responded:${offerId}:${user.id}` });
  return NextResponse.json({ offerId, status: body.decision });
}
