import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { workspaceRoleLabel } from "@/lib/workspace-role";
import WorkspaceShell from "./WorkspaceShell";
import styles from "./WorkspaceChooser.module.css";
import "../login/signin.css";

export const instant = false;

type Membership = {
  workspace_id: string;
  role: string;
  workspaces: { name: string } | { name: string }[] | null;
};

function workspaceNameFromMembership(membership: Membership): string {
  if (Array.isArray(membership.workspaces)) return membership.workspaces[0]?.name ?? "Workspace";
  return membership.workspaces?.name ?? "Workspace";
}

function invitationTokenFromInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (/^[A-Za-z0-9_-]{43}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.search || url.hash) return null;
    const match = url.pathname.match(/^\/invite\/([A-Za-z0-9_-]{43})$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function createWorkspace(formData: FormData) {
  "use server";
  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim() || name.length > 120) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: workspaceId, error } = await supabase.rpc("create_workspace", { workspace_name: name.trim() });
  if (error || typeof workspaceId !== "string" || !/^[0-9a-f-]{36}$/i.test(workspaceId)) redirect("/workspace?error=create");
  redirect(`/workspace/${workspaceId}`);
}

async function openInvitation(formData: FormData) {
  "use server";
  const token = invitationTokenFromInput(formData.get("invitation"));
  if (!token) redirect("/workspace?manage=1&error=invite");
  redirect(`/invite/${token}`);
}

function RolePath({ kind, title, copy, href, action }: { kind: "owner" | "provider"; title: string; copy: string; href: string; action: string }) {
  return <article className={`${styles.pathCard} ${kind === "owner" ? styles.pathCardOwner : styles.pathCardProvider}`}>
    <span className={styles.roleEyebrow}>{workspaceRoleLabel(kind)}</span>
    <h3>{title}</h3>
    <p>{copy}</p>
    <a className={styles.pathLink} href={href}>{action} <span aria-hidden="true">→</span></a>
  </article>;
}

function RoleSummary({ memberships }: { memberships: Membership[] }) {
  const ownerCount = memberships.filter((membership) => membership.role === "owner").length;
  const providerCount = memberships.filter((membership) => membership.role === "provider").length;
  if (!ownerCount && !providerCount) return <p className={styles.roleSummary}><strong>No workspace access yet.</strong> Choose a path below to get started.</p>;
  return <p className={styles.roleSummary}><strong>Your account can use both paths:</strong>{ownerCount > 0 && <span className={styles.roleBadge}>Owner / Buyer · {ownerCount} workspace{ownerCount === 1 ? "" : "s"}</span>}{providerCount > 0 && <span className={`${styles.roleBadge} ${styles.roleBadgeProvider}`}>Provider / Seller · {providerCount} workspace{providerCount === 1 ? "" : "s"}</span>}</p>;
}

function WorkspaceAccess({ memberships }: { memberships: Membership[] }) {
  if (!memberships.length) return <div className="workspace-empty"><strong>You don’t have a workspace yet.</strong>Choose Owner / Buyer to start a project, or Provider / Seller to join with an invitation.</div>;
  return <div>{memberships.map((membership) => {
    const workspaceName = workspaceNameFromMembership(membership);
    const role = membership.role === "owner" ? "owner" : "provider";
    return <Link className="workspace-list-card" key={membership.workspace_id} href={`/workspace/${membership.workspace_id}`}>
      <span className="workspace-avatar" aria-hidden="true">{workspaceName.charAt(0).toUpperCase()}</span>
      <span><strong>{workspaceName}</strong><small>{workspaceRoleLabel(role)}</small></span>
      <span className={`${styles.roleBadge} ${role === "provider" ? styles.roleBadgeProvider : ""}`}>{role === "owner" ? "Owner" : "Provider"}</span>
    </Link>;
  })}</div>;
}

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ error?: string; manage?: string; deleted?: string }> }) {
  await connection();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    return <main className="signin"><section className="signin-content"><h1>Workspace setup needed</h1><p>Configure Supabase to enable accounts and persistent workspaces.</p></section></main>;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error: actionError, manage, deleted } = await searchParams;
  const { data, error } = await supabase.from("workspace_members").select("workspace_id, role, workspaces(name)");
  const memberships = (data ?? []) as Membership[];
  const managing = manage === "1";
  if (!error && !actionError && !managing && memberships.length === 1) redirect(`/workspace/${memberships[0].workspace_id}`);
  const hasMemberships = memberships.length > 0;

  return <WorkspaceShell active="workspaces" email={user.email}>
    <div className="workspace-overview-header">
      <div><p className="workspace-eyebrow">ACCOUNT / WORKSPACES</p><h1>{hasMemberships ? (managing ? "Choose a workspace" : "Your workspaces") : "Choose how to use Pact"}</h1><p>Signed in as {user.email}</p></div>
      <Link className="workspace-action secondary" href="/">Back to landing</Link>
    </div>
    {deleted === "1" && <div className="workspace-alert" role="status">Workspace deleted. Its Pact records and payment history were removed.</div>}
    {error && <div className="workspace-alert" role="alert">Workspaces could not be loaded. Check that the database migration has been applied.</div>}
    {!error && <section className="workspace-panel" aria-labelledby="path-heading">
      <div className={styles.pathIntro}><h2 id="path-heading">What are you here to do?</h2><p>Pact does not lock your account to one role. Start a project as an Owner / Buyer, join someone else’s project as a Provider / Seller, or use both paths.</p></div>
      <div className={styles.pathGrid}>
        <RolePath kind="owner" title="Fund and review work" copy="Create a workspace, define milestone payments, invite a provider, and approve completed work." href="#create-workspace" action="Start a project" />
        <RolePath kind="provider" title="Deliver and get paid" copy="Open an invitation from a project owner, submit evidence, respond to revisions, and follow payment status." href="#join-pact" action="Join a project" />
      </div>
      <RoleSummary memberships={memberships} />
    </section>}
    {!error && <section className="workspace-panel"><div className="workspace-panel-heading"><div><h2>Your workspaces</h2><p>Open a workspace to continue. Access is scoped to your role in each workspace.</p></div></div><WorkspaceAccess memberships={memberships} /></section>}
    {actionError === "create" && <div className="workspace-alert" role="alert">Could not create the workspace. Please try again.</div>}
    {actionError === "delete" && <div className="workspace-alert" role="alert">Workspace could not be deleted. Open its Settings page and try again.</div>}
    {actionError === "invite" && <div className="workspace-alert" role="alert">Paste a valid Pact invitation link or its 43-character token.</div>}
    <section id="create-workspace" className="workspace-panel"><div className="workspace-panel-heading"><div><h2>Start as Owner / Buyer</h2><p>Create a workspace for the projects you fund and review.</p></div></div><form className="workspace-form" action={createWorkspace}><label>Workspace name<input name="name" maxLength={120} required placeholder="e.g. North Studio" /></label><p className="workspace-note">You become the owner of this workspace. You can still join other Pacts as a provider with the same account.</p><button className="workspace-action" type="submit">Create owner workspace <span aria-hidden="true">→</span></button></form></section>
    <section id="join-pact" className="workspace-panel"><div className="workspace-panel-heading"><div><h2>Join as Provider / Seller</h2><p>Use the private invitation link sent by the project owner.</p></div></div><form className={styles.inviteForm} action={openInvitation}><label>Invitation link or token<input name="invitation" inputMode="url" autoComplete="off" required placeholder="https://…/invite/ or 43-character token" /></label><p className={styles.inviteHint}>The link remains bound to the invited email. Accepting it adds provider access to the Pact.</p><button className="workspace-action secondary" type="submit">Open invitation <span aria-hidden="true">→</span></button></form></section>
  </WorkspaceShell>;
}
