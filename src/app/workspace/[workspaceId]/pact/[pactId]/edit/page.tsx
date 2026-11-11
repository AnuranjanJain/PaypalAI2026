import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updatePactDraft } from "./actions";
import PactEditorForm from "./PactEditorForm";
import "../../../../../login/signin.css";

export const instant = false;

export default async function EditPactPage({ params }: { params: Promise<{ workspaceId: string; pactId: string }> }) {
  const { workspaceId, pactId } = await params;
  if (![workspaceId, pactId].every((id) => /^[0-9a-f-]{36}$/i.test(id))) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase.from("workspace_members")
    .select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") redirect(`/workspace/${workspaceId}/pact/${pactId}`);

  const { data: pact, error } = await supabase.from("pacts")
    .select("title, brief, budget_cents, status, milestones(id, title, position, amount_cents)")
    .eq("workspace_id", workspaceId).eq("id", pactId).maybeSingle();
  if (error) throw new Error("Unable to load Pact details.");
  if (!pact) notFound();
  const saveDraft = updatePactDraft.bind(null, workspaceId, pactId);

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
        <Link className="pact-back-link" href={`/workspace/${workspaceId}/pact/${pactId}`}>← Back to Pact</Link>
        <section className="pact-panel pact-editor">
          <p className="pact-eyebrow">DRAFT AGREEMENT</p>
          <h1>Edit Pact details</h1>
          <p className="pact-intro">Update the project brief, budget, or milestone schedule before inviting your provider.</p>
          {pact.status !== "draft" ? (
            <div className="pact-form-error" role="status">This Pact can no longer be edited because its agreement is active.</div>
          ) : (
            <PactEditorForm
              action={saveDraft}
              cancelHref={`/workspace/${workspaceId}/pact/${pactId}`}
              title={pact.title}
              brief={pact.brief}
              budgetCents={pact.budget_cents}
              milestones={[...pact.milestones].sort((a, b) => a.position - b.position)}
            />
          )}
        </section>
      </div>
    </main>
  );
}
