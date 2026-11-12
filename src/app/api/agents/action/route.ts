import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

export async function POST(request: Request) {
  let body: { actionId?: unknown; decision?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 }); }
  if (!validId(body.actionId) || (body.decision !== "approved" && body.decision !== "rejected")) return NextResponse.json({ error: "A valid action and owner decision are required." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to decide an agent proposal." }, { status: 401 });
  const { error } = await supabase.rpc("decide_agent_action", { target_action_id: body.actionId, target_decision: body.decision });
  if (error) return NextResponse.json({ error: error.message.includes("Owner") ? "Only the Pact owner can decide this proposal." : "The agent proposal could not be updated." }, { status: 403 });
  return NextResponse.json({ actionId: body.actionId, status: body.decision });
}
