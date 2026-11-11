import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { hashPactInvitationToken } from "@/lib/pact-invitation";
import { createClient } from "@/lib/supabase/server";
import { acceptPactInvitation, signOutForInvitation } from "./actions";
import AcceptInvitationForm from "./AcceptInvitationForm";
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
  const invitation = Array.isArray(data) ? data[0] : data;

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
              {actionError === "wrong-email" && <p className="pact-form-error" role="alert">This link is tied to a different email address. Sign out and sign in with {invitation.invited_email}.</p>}
              {actionError === "wrong-account" && <p className="pact-form-error" role="alert">This account cannot join the Pact. Ask the owner to invite the provider account.</p>}
              {actionError === "expired" && <p className="pact-form-error" role="alert">This invitation has expired or is no longer available. Ask the owner to create a new link.</p>}
              {actionError === "setup" && <p className="pact-form-error" role="alert">Pact acceptance is not enabled in this Supabase project yet. Apply the latest migration, then try again.</p>}
              {actionError === "database" && <p className="pact-form-error" role="alert">Pact acceptance failed while saving access. Try again once, then ask the owner for a new link if it persists.</p>}
              <AcceptInvitationForm action={acceptPactInvitation.bind(null, token)} />
              {(actionError === "wrong-email" || actionError === "wrong-account") && <form action={signOutForInvitation.bind(null, token)}><button className="pact-secondary" type="submit">Sign out and use another account</button></form>}
            </>
          ) : (
            <>
              <p className="pact-eyebrow">INVITATION UNAVAILABLE</p>
              <h1>This link cannot be accepted</h1>
              <p className="pact-intro">The link may have expired, already been used, or been created for another email address. You are signed in as <strong>{user.email}</strong>. Sign in with the invited email or ask the owner to create a new link.</p>
              {error && <p className="pact-form-error" role="alert">Invitation details could not be loaded.</p>}
              {actionError === "wrong-email" && <p className="pact-form-error" role="alert">This invitation belongs to a different email address. Sign out and sign in with the invited provider account.</p>}
              <div className="pact-detail-actions">
                <Link className="pact-secondary" href="/workspace">Open your workspaces</Link>
                <form action={signOutForInvitation.bind(null, token)}><button className="pact-secondary" type="submit">Sign out and use another account</button></form>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
