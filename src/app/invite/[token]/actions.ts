"use server";

import { redirect } from "next/navigation";
import { hashPactInvitationToken } from "@/lib/pact-invitation";
import { createClient } from "@/lib/supabase/server";

function acceptanceErrorReason(error: { code?: string; message?: string } | null): string {
  const message = error?.message?.toLowerCase() ?? "";
  if (message.includes("invited email")) return "wrong-email";
  if (message.includes("owner") || message.includes("another account")) return "wrong-account";
  if (message.includes("invalid") || message.includes("expired")) return "expired";
  if (error?.code === "42702" || error?.code === "42883" || error?.code === "PGRST202" || message.includes("does not exist") || message.includes("schema cache")) return "setup";
  return "database";
}

export async function signOutForInvitation(token: string) {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
}

export async function acceptPactInvitation(token: string) {
  const tokenHash = hashPactInvitationToken(token);
  if (!tokenHash) redirect(`/invite/${encodeURIComponent(token)}?error=expired`);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const { data, error } = await supabase.rpc("accept_pact_invitation", { target_token_hash: tokenHash });
  const invitation = Array.isArray(data) ? data[0] : data;
  if (error || !invitation?.workspace_id || !invitation?.pact_id) {
    redirect(`/invite/${token}?error=${acceptanceErrorReason(error)}`);
  }
  redirect(`/workspace/${invitation.workspace_id}/pact/${invitation.pact_id}`);
}
