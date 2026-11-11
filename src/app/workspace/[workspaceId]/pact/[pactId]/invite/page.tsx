import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createPactInvitation } from "./actions";
import CopyInviteLink from "./CopyInviteLink";
import InviteProviderForm from "./InviteProviderForm";
import { createClient } from "@/lib/supabase/server";
import "../../../../../login/signin.css";

export const instant = false;

function isInvitationUrl(value: string | undefined, expectedOrigin: string): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.origin === expectedOrigin
      && (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost"))
      && !url.username && !url.password && !url.search && !url.hash
      && /^\/invite\/[A-Za-z0-9_-]{43}$/.test(url.pathname);
  } catch {
    return false;
  }
}

export default async function InviteProviderPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; pactId: string }>;
  searchParams: Promise<{ link?: string }>;
}) {
  const { workspaceId, pactId } = await params;
  const { link } = await searchParams;
  if (![workspaceId, pactId].every((id) => /^[0-9a-f-]{36}$/i.test(id))) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") redirect(`/workspace/${workspaceId}/pact/${pactId}`);

  const { data: pact, error } = await supabase.from("pacts")
    .select("title, status").eq("workspace_id", workspaceId).eq("id", pactId).maybeSingle();
  if (error) throw new Error("Unable to load Pact.");
  if (!pact) notFound();
  const createInvitation = createPactInvitation.bind(null, workspaceId, pactId);
  let appOrigin = "";
  try {
    if (process.env.APP_URL) appOrigin = new URL(process.env.APP_URL).origin;
  } catch {
    appOrigin = "";
  }
  const validLink = isInvitationUrl(link, appOrigin) ? link : null;

  return (
    <main className="pact-page">
      <header className="pact-topbar">
        <Link className="signin-brand" href="/workspace">Pact <span>by PayPal</span></Link>
        <nav aria-label="Workspace navigation">
          <Link href={`/workspace/${workspaceId}`}>Workspace overview</Link>
          <Link href={`/workspace/${workspaceId}/pact/${pactId}`}>Pact details</Link>
        </nav>
      </header>
      <div className="pact-page-content">
        <Link className="pact-back-link" href={`/workspace/${workspaceId}/pact/${pactId}`}>← Back to Pact</Link>
        <section className="pact-panel pact-setup">
          <p className="pact-eyebrow">NEXT STEP · PROVIDER INVITATION</p>
          <h1>Continue “{pact.title}”</h1>
          <p className="pact-intro">Invite the person who will complete this work. They must sign in using the invited email to accept the Pact.</p>
          {pact.status !== "draft" ? (
            <div className="pact-form-error" role="status">This Pact is already active. Open the Pact details to view its current status.</div>
          ) : validLink ? (
            <div className="pact-invite-success" role="status">
              <strong>Invitation link ready</strong>
              <p>The provider will get access to this Pact after signing in with the invited email and accepting the agreement.</p>
              <CopyInviteLink value={validLink} />
              <Link className="pact-primary pact-inline-primary" href={`/workspace/${workspaceId}/pact/${pactId}`}>Return to Pact</Link>
            </div>
          ) : (
            <>
              <ol className="pact-setup-steps">
                <li><span>1</span><div><strong>Send a private invitation</strong><small>The link is tied to one email address and expires after seven days.</small></div></li>
                <li><span>2</span><div><strong>Provider accepts the Pact</strong><small>Acceptance activates the agreement and opens this Pact to both participants.</small></div></li>
              </ol>
              <InviteProviderForm action={createInvitation} />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
