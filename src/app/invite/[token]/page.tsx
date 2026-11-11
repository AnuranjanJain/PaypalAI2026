import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { hashPactInvitationToken } from "@/lib/pact-invitation";
import { createClient } from "@/lib/supabase/server";
import { acceptPactInvitation } from "./actions";
import "../../login/signin.css";

export const instant = false;

export default async function AcceptInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error: actionError } = await searchParams;
  await connection();
  const tokenHash = hashPactInvitationToken(token);
  if (!tokenHash) redirect("/workspace");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const { data, error } = await supabase.rpc("get_pact_invitation", { target_token_hash: tokenHash });
  const invitation = Array.isArray(data) ? data[0] : null;

  return (
    <main className="pact-page">
      <header className="pact-topbar">
        <Link className="signin-brand" href="/workspace">Pact <span>by PayPal</span></Link>
        <Link href="/workspace">Your workspaces</Link>
      </header>
      <div className="pact-page-content">
        <section className="pact-panel pact-invitation">
          {invitation && !error ? (
            <>
              <p className="pact-eyebrow">PACT INVITATION</p>
              <h1>{invitation.pact_title}</h1>
              <p className="pact-intro">{invitation.workspace_name} invited <strong>{invitation.invited_email}</strong> to join this project.</p>
              <p className="pact-invitation-account">You are signed in as {user.email}. Accepting makes the agreement active for both participants.</p>
              {actionError === "accept" && <p className="pact-form-error" role="alert">This invitation could not be accepted. It may have expired or already been used.</p>}
              <form action={acceptPactInvitation.bind(null, token)}><button className="pact-primary" type="submit">Accept Pact and continue</button></form>
            </>
          ) : (
            <>
              <p className="pact-eyebrow">INVITATION UNAVAILABLE</p>
              <h1>This link cannot be accepted</h1>
              <p className="pact-intro">The link may have expired, already been used, or been created for another email address. Sign in with the invited email or ask the owner to create a new link.</p>
              {error && <p className="pact-form-error" role="alert">Invitation details could not be loaded.</p>}
              <Link className="pact-secondary" href="/workspace">Open your workspaces</Link>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
