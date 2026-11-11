"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createPactInvitationToken, hashPactInvitationToken } from "@/lib/pact-invitation";
import { createClient } from "@/lib/supabase/server";

export type InviteActionState = { error?: string };

export async function createPactInvitation(
  workspaceId: string,
  pactId: string,
  _previousState: InviteActionState,
  formData: FormData,
): Promise<InviteActionState> {
  if (![workspaceId, pactId].every((id) => /^[0-9a-f-]{36}$/i.test(id))) {
    return { error: "This Pact link is invalid. Return to your workspace and open it again." };
  }
  const emailValue = formData.get("email");
  if (typeof emailValue !== "string" || emailValue.trim().length > 254 || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(emailValue.trim())) {
    return { error: "Enter a valid provider email address." };
  }

  const requestHeaders = await headers();
  const configuredUrl = process.env.APP_URL?.trim();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const baseUrl = configuredUrl || (host ? `${protocol}://${host}` : "");
  let invitationUrl: URL;
  try {
    const parsedBase = new URL(baseUrl);
    if (parsedBase.protocol !== "https:" && parsedBase.hostname !== "localhost") return { error: "Set APP_URL to the HTTPS address of this app before creating invitations." };
    invitationUrl = new URL("/invite/", parsedBase.origin);
  } catch {
    return { error: "Set APP_URL to the address of this app before creating invitations." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const token = createPactInvitationToken();
  invitationUrl.pathname += token;
  const tokenHash = hashPactInvitationToken(token);
  if (!tokenHash) return { error: "Could not create a secure invitation. Please try again." };
  const { error } = await supabase.rpc("create_pact_invitation", {
    target_workspace: workspaceId,
    target_pact: pactId,
    target_email: emailValue.trim().toLowerCase(),
    target_token_hash: tokenHash,
  });
  if (error) return { error: "Could not create this invitation. Check that you own this draft Pact and use a different email." };

  redirect(`/workspace/${workspaceId}/pact/${pactId}/invite?link=${encodeURIComponent(invitationUrl.toString())}`);
}
