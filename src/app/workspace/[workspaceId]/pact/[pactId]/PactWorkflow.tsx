"use client";

import { useEffect, useMemo, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { reviewPactSubmission, submitPactEvidence, type WorkflowActionState } from "./workflow-actions";

type Milestone = { id: string; title: string; position: number; amount_cents: number; status: string };
type Submission = { id: string; milestone_id: string; notes: string; links: string[]; status: string; decision_note: string | null; created_at: string };
type PaymentEvent = { milestone_id: string; paypal_order_id: string; approval_url: string | null; status: string; payout_status?: string | null };
type PactVerification = { submission_id: string; mode: string; eligible: boolean; confidence: number; passed_criteria: string[]; missing_items: string[]; scope_flags: string[]; summary: string; created_at: string };

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

function ReviewForm({ workspaceId, pactId, submission, verification }: { workspaceId: string; pactId: string; submission: Submission; verification?: PactVerification }) {
  const action = reviewPactSubmission.bind(null, workspaceId, pactId);
  const [state, formAction, pending] = useActionState<WorkflowActionState, FormData>(action, {});
  const router = useRouter();
  useEffect(() => { if (state.success) router.refresh(); }, [router, state.success]);
  return <form action={formAction} className="pact-review-form">
    <input type="hidden" name="submissionId" value={submission.id} />
    <label>Review note <span className="pact-field-hint">optional</span><textarea name="note" rows={2} placeholder="Tell the provider what to keep or change." /></label>
    {state.error && <p className="pact-form-error" role="alert">{state.error}</p>}
    {state.success && <p className="pact-form-success" role="status">{state.success}</p>}
    {!verification?.eligible && <p className="pact-field-hint">Run an eligible Delivery Agent check before approving. You can still request a revision.</p>}
    <div className="pact-review-actions">
      <button className="pact-primary" name="decision" value="approved" type="submit" disabled={pending || !verification?.eligible}>{pending ? "Saving…" : "Approve milestone"}</button>
      <button className="pact-secondary" name="decision" value="revision_requested" type="submit" disabled={pending}>Request revision</button>
    </div>
  </form>;
}

function EvidenceCheck({ pactId, milestoneId, submissionId, existing }: { pactId: string; milestoneId: string; submissionId: string; existing?: PactVerification }) {
  const [result, setResult] = useState<PactVerification | undefined>(existing);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function runCheck() {
    setPending(true); setMessage("");
    try {
      const response = await fetch("/api/pact/evidence/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pactId, milestoneId, submissionId }) });
      const data = await response.json();
      if (!response.ok || !data.verification) throw new Error(data.error ?? "Evidence check could not be completed.");
      setResult({ ...data.verification, mode: data.mode, submission_id: submissionId, created_at: new Date().toISOString() });
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Evidence check could not be completed."); }
    finally { setPending(false); }
  }
  const modeLabel = result?.mode === "ai-provider" ? "Muse response" : result ? "Deterministic fallback" : "Not checked";
  return <div className="pact-evidence-check">
    <div className="pact-evidence-check-heading"><strong>Delivery Agent check</strong><span>{modeLabel}{result ? ` · ${Math.round(result.confidence * 100)}% confidence` : ""}</span></div>
    {result && <div className={`pact-evidence-result ${result.eligible ? "eligible" : "needs-revision"}`} role="status"><strong>{result.eligible ? "Eligible for owner review" : "Needs revision"}</strong><p>{result.summary}</p>{result.missing_items.length > 0 && <ul>{result.missing_items.map((item) => <li key={item}>{item}</li>)}</ul>}</div>}
    {message && <p className="pact-form-error" role="alert">{message}</p>}
    <button className="pact-secondary" type="button" onClick={runCheck} disabled={pending}>{pending ? "Checking evidence…" : result ? "Run evidence check again" : "Run evidence check"}</button>
  </div>;
}

function CheckoutButton({ workspaceId, pactId, milestone, existingEvent }: { workspaceId: string; pactId: string; milestone: Milestone; existingEvent?: PaymentEvent }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const existingPaymentIsCaptured = Boolean(existingEvent && (existingEvent.status === "captured" || existingEvent.status === "payout_pending" || existingEvent.status === "paid_to_provider" || (existingEvent.status === "failed" && existingEvent.payout_status === "failed")));
  const [order, setOrder] = useState<{ orderId: string; approvalUrl?: string; captured?: boolean; payoutStatus?: string } | null>(() => existingEvent && (existingEvent.status !== "failed" || existingEvent.payout_status === "failed") ? {
    orderId: existingEvent.paypal_order_id,
    approvalUrl: existingEvent.approval_url ?? undefined,
    captured: existingPaymentIsCaptured,
    payoutStatus: existingEvent.payout_status ?? "not_requested",
  } : null);
  async function createOrder() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/pact/payment/order", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `milestone-${milestone.id}` }, body: JSON.stringify({ pactId, milestoneId: milestone.id, returnUrl: `${window.location.origin}/workspace/${workspaceId}/pact/${pactId}?payment=approved`, cancelUrl: `${window.location.origin}/workspace/${workspaceId}/pact/${pactId}?payment=cancelled` }) });
      const data = await response.json();
      if (!response.ok || !data.orderId) throw new Error(data.error ?? "PayPal checkout could not be started.");
      const approvalUrl = Array.isArray(data.links) ? data.links.find((link: { rel?: string; href?: string }) => link.rel === "approve")?.href : undefined;
      const captured = ["captured", "payout_pending", "paid_to_provider"].includes(data.status) || (data.status === "failed" && data.payoutStatus === "failed");
      setOrder({ orderId: data.orderId, approvalUrl: approvalUrl ?? data.approvalUrl, captured, payoutStatus: data.payoutStatus ?? "not_requested" });
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
      if (data.status === "FAILED") setOrder(null);
      if (!response.ok || data.status !== "COMPLETED") throw new Error(data.error ?? "PayPal capture is still pending.");
      setOrder({ ...order, captured: true, payoutStatus: data.payoutStatus ?? "not_requested" });
      setMessage(data.payoutMessage ?? "PayPal capture completed. Provider payout remains pending until PayPal Payouts is enabled.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "PayPal capture could not be completed."); }
    finally { setBusy(false); }
  }
  async function requestPayout() {
    if (!order?.captured) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/pact/payment/order/${order.orderId}/payout`, { method: "POST", headers: { "Idempotency-Key": `payout-${order.orderId}` } });
      const data = await response.json();
      if (!response.ok && data.payoutStatus !== "blocked") throw new Error(data.error ?? "Provider payout could not be requested.");
      const payoutStatus = data.payoutStatus ?? "blocked";
      setOrder({ ...order, payoutStatus });
      setMessage(data.error ?? (payoutStatus === "paid_to_provider" ? "Provider payout confirmed by PayPal." : payoutStatus === "payout_pending" ? "PayPal accepted the payout request; it is still pending." : payoutStatus === "failed" ? "PayPal reported a failed payout. Retry the provider payout after checking the account." : "Provider payout is blocked until PayPal Payouts is enabled."));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Provider payout could not be requested."); }
    finally { setBusy(false); }
  }
  const payoutLabel = order?.payoutStatus === "paid_to_provider" ? "paid to provider" : order?.payoutStatus === "payout_pending" ? "pending" : order?.payoutStatus === "failed" ? "failed" : order?.payoutStatus === "blocked" ? "blocked" : "not requested";
  return <div className="pact-checkout">
    {order?.captured ? <><p className="pact-form-success" role="status">PayPal capture completed. Provider payout is <strong>{payoutLabel}</strong>.</p>{order.payoutStatus !== "paid_to_provider" && <button className="pact-secondary" type="button" onClick={requestPayout} disabled={busy}>{busy ? "Checking PayPal Payouts…" : order.payoutStatus === "failed" ? "Retry provider payout" : "Request provider payout"}</button>}</> : order ? <><p className="pact-checkout-state">Order <code>{order.orderId}</code> is awaiting buyer approval.</p><div className="pact-review-actions"><button className="pact-primary" type="button" onClick={capture} disabled={busy}>{busy ? "Checking…" : "I approved in PayPal — capture"}</button>{order.approvalUrl && <a className="pact-secondary" href={order.approvalUrl} target="_blank" rel="noreferrer">Open PayPal approval</a>}</div></> : <button className="pact-primary" type="button" onClick={createOrder} disabled={busy}>{busy ? "Connecting to PayPal…" : `Start PayPal checkout · $${(milestone.amount_cents / 100).toFixed(2)}`}</button>}
    {message && <p className="pact-form-error" role="status">{message}</p>}
  </div>;
}

function ProviderPaymentState({ event }: { event?: PaymentEvent }) {
  if (!event) return null;
  const state = event.status === "paid_to_provider"
    ? "Paid to provider"
    : event.status === "payout_pending"
      ? "Payout pending"
      : event.status === "captured"
        ? "Payment captured"
        : event.status === "failed"
          ? "Payment needs attention"
          : "Awaiting owner payment";
  return <p className={`pact-payment-state pact-payment-state-${event.status}`} role="status">Payment status: <strong>{state}</strong></p>;
}

export default function PactWorkflow({ workspaceId, pactId, isOwner, pactStatus, milestones, submissions, paymentEvents, verifications, unavailable }: { workspaceId: string; pactId: string; isOwner: boolean; pactStatus: string; milestones: Milestone[]; submissions: Submission[]; paymentEvents: PaymentEvent[]; verifications: PactVerification[]; unavailable?: boolean }) {
  const latest = useMemo(() => new Map(milestones.map((milestone) => [milestone.id, submissions.find((submission) => submission.milestone_id === milestone.id)])), [milestones, submissions]);
  const payments = useMemo(() => new Map(paymentEvents.map((event) => [event.milestone_id, event])), [paymentEvents]);
  const verificationMap = useMemo(() => new Map(verifications.map((verification) => [verification.submission_id, verification])), [verifications]);
  if (pactStatus !== "active") return null;
  return <section className="pact-panel pact-workflow" aria-labelledby="workflow-heading">
    <div className="pact-section-heading"><div><p className="pact-eyebrow">MILESTONE WORKFLOW</p><h2 id="workflow-heading">Evidence, review, and payment</h2></div><span>{isOwner ? "Owner review" : "Provider delivery"}</span></div>
    {unavailable ? <div className="pact-form-error" role="status">Evidence storage is not enabled yet. Apply the latest Supabase migration to activate submissions and review.</div> : <ol className="pact-workflow-list">{milestones.map((milestone) => {
      const submission = latest.get(milestone.id);
      const canSubmit = !isOwner && milestone.status !== "approved" && (!submission || submission.status === "revision_requested");
      return <li key={milestone.id} className="pact-workflow-item"><div className="pact-workflow-heading"><div><strong>{milestone.title}</strong><small>${(milestone.amount_cents / 100).toFixed(2)} · {milestone.status.replaceAll("_", " ")}</small></div>{submission && <span className={`pact-submission-status pact-submission-${submission.status}`}>{submission.status.replaceAll("_", " ")}</span>}</div>{submission && <div className="pact-submission-summary"><p>{submission.notes}</p>{submission.links.length > 0 && <ul>{submission.links.map((link) => <li key={link}><a href={link} target="_blank" rel="noreferrer">{link}</a></li>)}</ul>}{submission.decision_note && <p className="pact-decision-note">Owner note: {submission.decision_note}</p>}</div>}{!isOwner && <ProviderPaymentState event={payments.get(milestone.id)} />}{canSubmit && <EvidenceForm workspaceId={workspaceId} pactId={pactId} milestoneId={milestone.id} />}{isOwner && submission?.status === "submitted" && <><EvidenceCheck pactId={pactId} milestoneId={milestone.id} submissionId={submission.id} existing={verificationMap.get(submission.id)} /><ReviewForm workspaceId={workspaceId} pactId={pactId} submission={submission} verification={verificationMap.get(submission.id)} /></>}{isOwner && milestone.status === "approved" && <CheckoutButton workspaceId={workspaceId} pactId={pactId} milestone={milestone} existingEvent={payments.get(milestone.id)} />}</li>;
    })}</ol>}
  </section>;
}
