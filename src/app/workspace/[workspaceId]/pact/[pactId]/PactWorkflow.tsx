"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { reviewPactSubmission, submitPactEvidence, type WorkflowActionState } from "./workflow-actions";

type Milestone = { id: string; title: string; position: number; amount_cents: number; status: string };
type Submission = { id: string; milestone_id: string; notes: string; links: string[]; status: string; decision_note: string | null; created_at: string };
type PaymentEvent = { milestone_id: string; paypal_order_id: string; approval_url: string | null; status: string };

function EvidenceForm({ workspaceId, pactId, milestoneId }: { workspaceId: string; pactId: string; milestoneId: string }) {
  const action = submitPactEvidence.bind(null, workspaceId, pactId, milestoneId);
  const [state, formAction, pending] = useActionState<WorkflowActionState, FormData>(action, {});
  const router = useRouter();
  useEffect(() => { if (state.success) router.refresh(); }, [router, state.success]);
  return <form action={formAction} className="pact-evidence-form">
    <label>What did you deliver?<textarea name="notes" rows={4} minLength={1} maxLength={10000} placeholder="Summarize the completed work and point to the evidence." required /></label>
    <label>Evidence links <span className="pact-field-hint">one per line, optional</span><textarea name="links" rows={2} placeholder="https://…" /></label>
    {state.error && <p className="pact-form-error" role="alert">{state.error}</p>}
    {state.success && <p className="pact-form-success" role="status">{state.success}</p>}
    <button className="pact-primary" type="submit" disabled={pending}>{pending ? "Submitting…" : "Submit for review"}</button>
  </form>;
}

function ReviewForm({ workspaceId, pactId, submission }: { workspaceId: string; pactId: string; submission: Submission }) {
  const action = reviewPactSubmission.bind(null, workspaceId, pactId);
  const [state, formAction, pending] = useActionState<WorkflowActionState, FormData>(action, {});
  const router = useRouter();
  useEffect(() => { if (state.success) router.refresh(); }, [router, state.success]);
  return <form action={formAction} className="pact-review-form">
    <input type="hidden" name="submissionId" value={submission.id} />
    <label>Review note <span className="pact-field-hint">optional</span><textarea name="note" rows={2} placeholder="Tell the provider what to keep or change." /></label>
    {state.error && <p className="pact-form-error" role="alert">{state.error}</p>}
    {state.success && <p className="pact-form-success" role="status">{state.success}</p>}
    <div className="pact-review-actions">
      <button className="pact-primary" name="decision" value="approved" type="submit" disabled={pending}>{pending ? "Saving…" : "Approve milestone"}</button>
      <button className="pact-secondary" name="decision" value="revision_requested" type="submit" disabled={pending}>Request revision</button>
    </div>
  </form>;
}

function CheckoutButton({ workspaceId, pactId, milestone, existingEvent }: { workspaceId: string; pactId: string; milestone: Milestone; existingEvent?: PaymentEvent }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [order, setOrder] = useState<{ orderId: string; approvalUrl?: string; captured?: boolean; payoutStatus?: string } | null>(() => existingEvent && existingEvent.status !== "failed" ? {
    orderId: existingEvent.paypal_order_id,
    approvalUrl: existingEvent.approval_url ?? undefined,
    captured: ["captured", "payout_pending", "paid_to_provider"].includes(existingEvent.status),
    payoutStatus: existingEvent.status,
  } : null);
  async function createOrder() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/pact/payment/order", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `milestone-${milestone.id}` }, body: JSON.stringify({ pactId, milestoneId: milestone.id, returnUrl: `${window.location.origin}/workspace/${workspaceId}/pact/${pactId}?payment=approved`, cancelUrl: `${window.location.origin}/workspace/${workspaceId}/pact/${pactId}?payment=cancelled` }) });
      const data = await response.json();
      if (!response.ok || !data.orderId) throw new Error(data.error ?? "PayPal checkout could not be started.");
      const approvalUrl = Array.isArray(data.links) ? data.links.find((link: { rel?: string; href?: string }) => link.rel === "approve")?.href : undefined;
      setOrder({ orderId: data.orderId, approvalUrl: approvalUrl ?? data.approvalUrl, captured: data.status === "captured" });
      if (!approvalUrl && !data.approvalUrl) setMessage("PayPal order is recorded. Approve it in the sandbox, then return here to capture.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "PayPal checkout could not be started."); }
    finally { setBusy(false); }
  }
  async function capture() {
    if (!order) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/pact/payment/order/${order.orderId}/capture`, { method: "POST", headers: { "Idempotency-Key": `capture-${order.orderId}` } });
      const data = await response.json();
      if (!response.ok || data.status !== "COMPLETED") throw new Error(data.error ?? "PayPal capture is still pending.");
      setOrder({ ...order, captured: true, payoutStatus: data.payoutStatus ?? "captured" });
      setMessage(data.payoutMessage ?? "PayPal capture completed. Provider payout remains pending until PayPal Payouts is enabled.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "PayPal capture could not be completed."); }
    finally { setBusy(false); }
  }
  return <div className="pact-checkout">
    {order?.captured ? <p className="pact-form-success" role="status">PayPal capture completed. Provider payout is {order.payoutStatus === "paid_to_provider" ? "confirmed" : "pending or blocked until Payouts eligibility is confirmed"}.</p> : order ? <><p className="pact-checkout-state">Order <code>{order.orderId}</code> is awaiting buyer approval.</p><div className="pact-review-actions"><button className="pact-primary" type="button" onClick={capture} disabled={busy}>{busy ? "Checking…" : "I approved in PayPal — capture"}</button>{order.approvalUrl && <a className="pact-secondary" href={order.approvalUrl} target="_blank" rel="noreferrer">Open PayPal approval</a>}</div></> : <button className="pact-primary" type="button" onClick={createOrder} disabled={busy}>{busy ? "Connecting to PayPal…" : `Start PayPal checkout · $${(milestone.amount_cents / 100).toFixed(2)}`}</button>}
    {message && <p className="pact-form-error" role="status">{message}</p>}
  </div>;
}

export default function PactWorkflow({ workspaceId, pactId, isOwner, pactStatus, milestones, submissions, paymentEvents, unavailable }: { workspaceId: string; pactId: string; isOwner: boolean; pactStatus: string; milestones: Milestone[]; submissions: Submission[]; paymentEvents: PaymentEvent[]; unavailable?: boolean }) {
  const latest = useMemo(() => new Map(milestones.map((milestone) => [milestone.id, submissions.find((submission) => submission.milestone_id === milestone.id)])), [milestones, submissions]);
  const payments = useMemo(() => new Map(paymentEvents.map((event) => [event.milestone_id, event])), [paymentEvents]);
  if (pactStatus !== "active") return null;
  return <section className="pact-panel pact-workflow" aria-labelledby="workflow-heading">
    <div className="pact-section-heading"><div><p className="pact-eyebrow">MILESTONE WORKFLOW</p><h2 id="workflow-heading">Evidence, review, and payment</h2></div><span>{isOwner ? "Owner review" : "Provider delivery"}</span></div>
    {unavailable ? <div className="pact-form-error" role="status">Evidence storage is not enabled yet. Apply the latest Supabase migration to activate submissions and review.</div> : <ol className="pact-workflow-list">{milestones.map((milestone) => {
      const submission = latest.get(milestone.id);
      const canSubmit = !isOwner && milestone.status !== "approved" && (!submission || submission.status === "revision_requested");
      return <li key={milestone.id} className="pact-workflow-item"><div className="pact-workflow-heading"><div><strong>{milestone.title}</strong><small>${(milestone.amount_cents / 100).toFixed(2)} · {milestone.status.replaceAll("_", " ")}</small></div>{submission && <span className={`pact-submission-status pact-submission-${submission.status}`}>{submission.status.replaceAll("_", " ")}</span>}</div>{submission && <div className="pact-submission-summary"><p>{submission.notes}</p>{submission.links.length > 0 && <ul>{submission.links.map((link) => <li key={link}><a href={link} target="_blank" rel="noreferrer">{link}</a></li>)}</ul>}{submission.decision_note && <p className="pact-decision-note">Owner note: {submission.decision_note}</p>}</div>}{canSubmit && <EvidenceForm workspaceId={workspaceId} pactId={pactId} milestoneId={milestone.id} />}{isOwner && submission?.status === "submitted" && <ReviewForm workspaceId={workspaceId} pactId={pactId} submission={submission} />}{isOwner && milestone.status === "approved" && <CheckoutButton workspaceId={workspaceId} pactId={pactId} milestone={milestone} existingEvent={payments.get(milestone.id)} />}</li>;
    })}</ol>}
  </section>;
}
