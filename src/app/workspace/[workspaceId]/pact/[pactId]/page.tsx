import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import PactWorkflow from "./PactWorkflow";
import "../../../../login/signin.css";

export const instant = false;

export default async function PactDetail({ params }: { params: Promise<{ workspaceId: string; pactId: string }> }) {
  const { workspaceId, pactId } = await params;
  await connection();
  if (![workspaceId, pactId].every((id) => /^[0-9a-f-]{36}$/i.test(id))) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/workspace");

  const { data: pact, error } = await supabase.from("pacts")
    .select("title, brief, budget_cents, status, milestones(id, title, position, amount_cents, status)")
    .eq("workspace_id", workspaceId).eq("id", pactId).maybeSingle();
  if (error) throw new Error("Unable to load Pact.");
  if (!pact) notFound();

  const { data: submissions, error: submissionsError } = await supabase.from("pact_submissions")
    .select("id, milestone_id, notes, links, status, decision_note, created_at")
    .eq("pact_id", pactId)
    .order("created_at", { ascending: false });
  const { data: verifications } = await supabase.from("pact_verification_results")
    .select("submission_id, mode, eligible, confidence, passed_criteria, missing_items, scope_flags, summary, created_at")
    .eq("pact_id", pactId)
    .order("created_at", { ascending: false });

  const isOwner = membership.role === "owner";
  const { data: paymentEvents } = isOwner ? await supabase.from("pact_payment_events")
    .select("milestone_id, paypal_order_id, approval_url, status, payout_status")
    .eq("pact_id", pactId)
    .in("status", ["created", "captured", "payout_pending", "paid_to_provider"])
    .order("created_at", { ascending: false }) : { data: [] };
  const milestones = [...pact.milestones].sort((a, b) => a.position - b.position);
  return (
    <main className="pact-page">
      <header className="pact-topbar">
        <Link className="signin-brand" href="/workspace">Pact <span>by PayPal</span></Link>
        <nav aria-label="Workspace navigation">
          <Link href={`/workspace/${workspaceId}`}>Workspace overview</Link>
          <Link href="/workspace">All workspaces</Link>
        </nav>
      </header>
      <div className="pact-page-content">
        <Link className="pact-back-link" href={`/workspace/${workspaceId}`}>← Workspace overview</Link>
        <div className="pact-detail-grid">
          <section className="pact-panel pact-detail">
            <div className="pact-title-row">
              <div>
                <p className={`pact-status pact-status-${pact.status}`}>{pact.status}</p>
                <h1>{pact.title}</h1>
                <p className="pact-intro">{pact.brief}</p>
              </div>
              <span className="pact-role-label">{isOwner ? "Owner view" : "Provider view"}</span>
            </div>
            <div className="pact-budget"><span>Project budget</span><strong>${(pact.budget_cents / 100).toFixed(2)} USD</strong></div>
            <div className="pact-section-heading"><h2>Milestone schedule</h2><span>{milestones.length} stages</span></div>
            <ol className="pact-milestones">
              {milestones.map((milestone, index) => (
                <li key={milestone.id}>
                  <span className="pact-milestone-index">{index + 1}</span>
                  <span className="pact-milestone-copy"><strong>{milestone.title}</strong><small>{milestone.status}</small></span>
                  <strong className="pact-milestone-amount">${(milestone.amount_cents / 100).toFixed(2)}</strong>
                </li>
              ))}
            </ol>
            {pact.status === "active" && <div className="pact-active-notice"><strong>Agreement active</strong><span>The provider accepted this Pact. Both participants can review the agreed milestone schedule.</span></div>}
          </section>
          <aside className="pact-panel pact-next-step">
            <p className="pact-eyebrow">PACT WORKFLOW</p>
            <ol className="pact-stepper">
              <li className="complete"><span>1</span><div><strong>Draft details</strong><small>Saved to this workspace</small></div></li>
              <li className={pact.status === "draft" ? "current" : "complete"}><span>2</span><div><strong>Provider invitation</strong><small>{pact.status === "draft" ? "Invite the person doing the work" : "Provider accepted"}</small></div></li>
              <li className={pact.status === "active" ? "current" : "waiting"}><span>3</span><div><strong>Agreement active</strong><small>{pact.status === "active" ? "Ready for the next project step" : "Begins when the provider accepts"}</small></div></li>
            </ol>
            {pact.status === "draft" && isOwner ? (
              <div className="pact-detail-actions">
                <Link className="pact-primary" href={`/workspace/${workspaceId}/pact/${pactId}/invite`}>Continue setup <span aria-hidden="true">→</span></Link>
                <Link className="pact-secondary" href={`/workspace/${workspaceId}/pact/${pactId}/edit`}>Edit Pact details</Link>
              </div>
            ) : (
              <div className="pact-detail-actions">
                <Link className="pact-secondary" href={`/workspace/${workspaceId}`}>Return to workspace</Link>
              </div>
            )}
            {pact.status === "active" && <p className="pact-next-note">The next step is evidence review. PayPal checkout appears only after the owner approves a milestone.</p>}
          </aside>
        </div>
        <PactWorkflow
          workspaceId={workspaceId}
          pactId={pactId}
          isOwner={isOwner}
          pactStatus={pact.status}
          milestones={milestones}
          paymentEvents={paymentEvents ?? []}
          verifications={(verifications ?? []).map((verification) => ({
            ...verification,
            passed_criteria: Array.isArray(verification.passed_criteria) ? verification.passed_criteria : [],
            missing_items: Array.isArray(verification.missing_items) ? verification.missing_items : [],
            scope_flags: Array.isArray(verification.scope_flags) ? verification.scope_flags : [],
          }))}
          submissions={(submissions ?? []).map((submission) => ({
            ...submission,
            links: Array.isArray(submission.links) ? submission.links : [],
          }))}
          unavailable={Boolean(submissionsError)}
        />
      </div>
    </main>
  );
}
