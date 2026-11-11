import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workspaceRoleLabel } from "@/lib/workspace-role";
import WorkspaceShell from "../WorkspaceShell";
import DeleteWorkspaceForm from "../DeleteWorkspaceForm";
import "../../login/signin.css";

export const instant = false;

type Pact = { id: string; title: string; status: string; budget_cents: number; milestones: Array<{ title: string; position: number; amount_cents: number }> };
type Payment = { pact_id: string; milestone_id: string; status: string; payout_status: string | null; amount_cents: number; paypal_order_id: string; created_at: string };

async function createPact(formData: FormData) {
  "use server";
  const workspaceId = formData.get("workspaceId");
  const title = formData.get("title");
  const brief = formData.get("brief");
  const budget = formData.get("budget");
  if (typeof workspaceId !== "string" || !/^[0-9a-f-]{36}$/i.test(workspaceId)) redirect("/workspace");
  if (typeof title !== "string" || typeof brief !== "string" || typeof budget !== "string" || !/^\d{1,6}(\.\d{1,2})?$/.test(budget)) redirect(`/workspace/${workspaceId}?error=invalid`);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: pactId, error } = await supabase.rpc("create_pact_draft", { target_workspace: workspaceId, pact_title: title, pact_brief: brief, total_cents: Math.round(Number(budget) * 100), shares: [30, 20, 25, 25] });
  if (error || typeof pactId !== "string" || !/^[0-9a-f-]{36}$/i.test(pactId)) redirect(`/workspace/${workspaceId}?error=create`);
  redirect(`/workspace/${workspaceId}/pact/${pactId}`);
}

async function deleteWorkspace(formData: FormData) {
  "use server";
  const workspaceId = formData.get("workspaceId");
  if (typeof workspaceId !== "string" || !/^[0-9a-f-]{36}$/i.test(workspaceId)) redirect("/workspace?error=delete");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/workspace/${workspaceId}?view=settings`)}`);
  const { data: membership } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (membership?.role !== "owner") redirect(`/workspace/${workspaceId}?view=settings&error=delete-owner`);
  const { error } = await supabase.rpc("delete_workspace", { target_workspace: workspaceId });
  if (error) redirect(`/workspace/${workspaceId}?view=settings&error=delete`);
  redirect("/workspace?manage=1&deleted=1");
}

function PactList({ workspaceId, pacts }: { workspaceId: string; pacts: Pact[] }) {
  if (!pacts.length) return <div className="workspace-empty"><strong>No Pacts yet.</strong>Create a Pact to turn a brief into milestones and payment decisions.</div>;
  return <div>{pacts.map((pact) => <Link className="workspace-list-card" key={pact.id} href={`/workspace/${workspaceId}/pact/${pact.id}`}><span className="workspace-avatar" aria-hidden="true">{pact.title.charAt(0).toUpperCase()}</span><span><strong>{pact.title}</strong><small>{pact.status} · ${(pact.budget_cents / 100).toFixed(2)}</small></span><span className={`workspace-pill ${pact.status}`}>{pact.status}</span></Link>)}</div>;
}

function CreatePactForm({ workspaceId }: { workspaceId: string }) {
  return <form className="workspace-form" action={createPact}><input type="hidden" name="workspaceId" value={workspaceId} /><label>Title<input name="title" minLength={3} maxLength={120} required placeholder="e.g. Brand identity kit" /></label><label>Project brief<textarea name="brief" minLength={10} maxLength={2000} rows={4} required placeholder="Describe the outcome and what good work looks like." /></label><label>Budget in USD<input name="budget" type="number" min="0.05" max="1000000" step="0.01" required placeholder="1000.00" /></label><p className="workspace-note">Milestones use a 30%, 20%, 25%, 25% schedule. You can edit the draft before inviting a provider.</p><button className="workspace-action" type="submit">Create Pact <span aria-hidden="true">→</span></button></form>;
}

function Overview({ workspaceId, pacts, isOwner }: { workspaceId: string; pacts: Pact[]; isOwner: boolean }) {
  const roleLabel = workspaceRoleLabel(isOwner ? "owner" : "provider");
  return <><div className="workspace-summary-grid"><div className="workspace-summary-card"><span>Active Pacts</span><strong>{pacts.filter((pact) => pact.status === "active").length}</strong><small>Agreements in motion</small></div><div className="workspace-summary-card"><span>Total committed</span><strong>${(pacts.reduce((sum, pact) => sum + pact.budget_cents, 0) / 100).toFixed(2)}</strong><small>Across this workspace</small></div><div className="workspace-summary-card"><span>Your role</span><strong>{roleLabel}</strong><small>Permission-scoped access</small></div></div><div className="workspace-view-grid"><section className="workspace-panel"><div className="workspace-panel-heading"><div><h2>Recent Pacts</h2><p>Open an agreement to continue its setup or review.</p></div><Link className="workspace-action secondary" href={`/workspace/${workspaceId}?view=pacts`}>View all</Link></div><PactList workspaceId={workspaceId} pacts={pacts.slice(0, 4)} /></section><section className="workspace-panel"><div className="workspace-panel-heading"><div><h2>Next step</h2><p>{isOwner ? "Create a clear agreement before inviting a provider." : "Open an active Pact to submit evidence."}</p></div></div><div className="workspace-note">{isOwner ? "Start with a brief, set milestone amounts, then continue setup to invite the provider by email." : "Your provider access is limited to Pacts you have accepted. You can still create your own Owner / Buyer workspace from Switch workspace."}</div></section></div></>;
}

function PactsView({ workspaceId, pacts, isOwner }: { workspaceId: string; pacts: Pact[]; isOwner: boolean }) {
  return <><section className="workspace-panel"><div className="workspace-panel-heading"><div><h2>All Pacts</h2><p>{pacts.length} agreement{pacts.length === 1 ? "" : "s"} in this workspace.</p></div></div><PactList workspaceId={workspaceId} pacts={pacts} /></section>{isOwner && <section id="new-pact" className="workspace-panel"><div className="workspace-panel-heading"><div><h2>Create a Pact</h2><p>Define the work before you invite the provider.</p></div></div><CreatePactForm workspaceId={workspaceId} /></section>}</>;
}

function PaymentsView({ isOwner, payments, unavailable, pacts }: { isOwner: boolean; payments: Payment[]; unavailable: boolean; pacts: Pact[] }) {
  const pactNames = new Map(pacts.map((pact) => [pact.id, pact.title]));
  return <section className="workspace-panel"><div className="workspace-panel-heading"><div><h2>{isOwner ? "Payment ledger" : "My payment status"}</h2><p>{isOwner ? "Track PayPal capture events separately from provider payout status." : "Follow capture and provider payout status for the Pacts you have joined."}</p></div></div>{unavailable ? <div className="workspace-empty"><strong>Payment status unavailable</strong>Apply the provider payment visibility migration to enable this view.</div> : payments.length ? <div>{payments.map((payment) => <div className="workspace-list-card" key={`${payment.pact_id}-${payment.milestone_id}`}><span className="workspace-avatar" aria-hidden="true">$</span><span><strong>{pactNames.get(payment.pact_id) ?? "Pact"} · ${(payment.amount_cents / 100).toFixed(2)}</strong><small>{isOwner ? `Order ${payment.paypal_order_id} · ` : "PayPal capture · "}payout {payment.payout_status?.replaceAll("_", " ") ?? "not requested"}</small></span><span className="workspace-pill">{payment.status.replaceAll("_", " ")}</span></div>)}</div> : <div className="workspace-empty"><strong>No payment events yet.</strong>{isOwner ? "Events appear after an approved milestone enters PayPal checkout." : "Payment status appears after the owner approves a milestone."}</div>}</section>;
}

function SettingsView({ workspaceName, role, email, workspaceId, profile, actionError }: { workspaceName: string; role: string; email: string | null | undefined; workspaceId: string; profile: boolean; actionError?: string }) {
  const roleLabel = workspaceRoleLabel(role);
  if (profile) return <section className="workspace-panel"><div className="workspace-panel-heading"><div><h2>Profile</h2><p>Your signed-in account and workspace role.</p></div></div><div className="workspace-profile-card"><span className="workspace-profile-avatar">{(email ?? "P").slice(0, 2).toUpperCase()}</span><div><strong>{email}</strong><span>{workspaceName} · {roleLabel} access</span></div></div><p className="workspace-note">Your account can be an Owner / Buyer in one workspace and a Provider / Seller in another. Sign out from the workspace navigation when you are finished.</p></section>;
  return <div className="workspace-view-grid"><section className="workspace-panel"><div className="workspace-panel-heading"><div><h2>Workspace settings</h2><p>Access and project defaults for this workspace.</p></div></div>{actionError === "delete-owner" && <div className="workspace-alert" role="alert">Only the workspace owner can delete this workspace.</div>}{actionError === "delete" && <div className="workspace-alert" role="alert">Workspace deletion could not be completed. Confirm the latest Supabase migration is applied, then try again.</div>}<div className="workspace-profile-card"><span className="workspace-profile-avatar">{workspaceName.slice(0, 2).toUpperCase()}</span><div><strong>{workspaceName}</strong><span>{roleLabel} access · members are managed through Pact invitations</span></div></div><p className="workspace-note">Workspace renaming and role administration are not enabled in this release. Invite providers from an individual Pact to keep access scoped.</p>{role === "owner" && <DeleteWorkspaceForm workspaceId={workspaceId} workspaceName={workspaceName} action={deleteWorkspace} />}</section><section className="workspace-panel"><div className="workspace-panel-heading"><div><h2>Your profile</h2><p>Account identity used for invitations and reviews.</p></div></div><div className="workspace-profile-card"><span className="workspace-profile-avatar">{(email ?? "P").slice(0, 2).toUpperCase()}</span><div><strong>{email}</strong><span>Signed in with Supabase</span></div></div><Link className="workspace-action secondary" href={`/workspace/${workspaceId}?view=profile`}>Open profile</Link></section></div>;
}

export default async function WorkspaceDetail({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ error?: string; view?: string }> }) {
  const { workspaceId } = await params;
  const { error: actionError, view = "overview" } = await searchParams;
  await connection();
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) redirect("/workspace");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("workspace_members").select("role, workspaces(name)").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/workspace");
  const { data: pacts, error } = await supabase.from("pacts").select("id, title, status, budget_cents, milestones(title, position, amount_cents)").eq("workspace_id", workspaceId).order("created_at", { ascending: false });
  const normalizedPacts = (pacts ?? []) as Pact[];
  const workspaceName = membership.workspaces && "name" in membership.workspaces ? String(membership.workspaces.name) : "Workspace";
  const isOwner = membership.role === "owner";
  const active = view === "pacts" ? "pacts" : view === "payments" ? "payments" : view === "settings" || view === "profile" ? "settings" : "overview";
  const pactIds = normalizedPacts.map((pact) => pact.id);
  const paymentsResult = view === "payments" && pactIds.length
    ? await supabase.from("pact_payment_events").select("pact_id, milestone_id, status, payout_status, amount_cents, paypal_order_id, created_at").in("pact_id", pactIds).order("created_at", { ascending: false })
    : { data: [], error: null };
  const payments = (paymentsResult.data ?? []) as Payment[];
  const title = active === "overview" ? workspaceName : active === "pacts" ? "My Pacts" : active === "payments" ? "Payments" : view === "profile" ? "Profile" : "Settings";
  const description = active === "overview" ? (isOwner ? "Fund work through clear milestones and review each delivery before payment." : "Deliver accepted work, submit evidence, and follow each milestone payment.") : active === "pacts" ? "Open a Pact to edit milestones, invite a provider, or review progress." : active === "payments" ? (isOwner ? "Track PayPal capture events separately from provider payout status." : "Follow payment progress for the Pacts you have joined.") : view === "profile" ? "Your account and workspace access." : "Workspace preferences and access details.";
  const roleLabel = workspaceRoleLabel(membership.role);
  return <WorkspaceShell workspaceId={workspaceId} workspaceName={workspaceName} role={membership.role} email={user.email} active={active}><div className="workspace-overview-header"><div><p className="workspace-eyebrow">{active === "overview" ? `${roleLabel.toUpperCase()} WORKSPACE` : active === "pacts" ? "PROJECTS / MY PACTS" : active === "payments" ? "LEDGER / PAYMENTS" : "ACCOUNT / SETTINGS"}</p><h1>{title}</h1><p>{description}</p></div>{active === "overview" && isOwner && <Link className="workspace-action" href={`/workspace/${workspaceId}?view=pacts#new-pact`}>Create a Pact <span aria-hidden="true">+</span></Link>}</div>{actionError === "create" && <div className="workspace-alert" role="alert">Pact could not be created. Check the details and database setup.</div>}{error && <div className="workspace-alert" role="alert">Pacts could not be loaded.</div>}{active === "overview" && <Overview workspaceId={workspaceId} pacts={normalizedPacts} isOwner={isOwner} />}{active === "pacts" && <PactsView workspaceId={workspaceId} pacts={normalizedPacts} isOwner={isOwner} />}{active === "payments" && <PaymentsView isOwner={isOwner} payments={payments} pacts={normalizedPacts} unavailable={Boolean(paymentsResult.error)} />}{active === "settings" && <SettingsView workspaceName={workspaceName} role={membership.role} email={user.email} workspaceId={workspaceId} profile={view === "profile"} actionError={actionError} />}</WorkspaceShell>;
}
