"use server";

import { redirect } from "next/navigation";
import { hashPactInvitationToken } from "@/lib/pact-invitation";
import { createClient } from "@/lib/supabase/server";

export async function acceptPactInvitation(token: string) {
  const tokenHash = hashPactInvitationToken(token);
  if (!tokenHash) redirect("/workspace");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const { data, error } = await supabase.rpc("accept_pact_invitation", { target_token_hash: tokenHash });
  const invitation = Array.isArray(data) ? data[0] : null;
  if (error || !invitation?.workspace_id || !invitation?.pact_id) {
    redirect(`/invite/${token}?error=accept`);
  }
  redirect(`/workspace/${invitation.workspace_id}/pact/${invitation.pact_id}`);
}
