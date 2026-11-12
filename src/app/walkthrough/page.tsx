"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { VerificationResult } from "@/lib/pact";
import { parsePendingPayment, PENDING_PAYMENT_KEY } from "@/lib/pending-payment";

type Status = "paid" | "review" | "revision" | "approval" | "locked";
type Milestone = { id: number; label: string; title: string; amount: number; status: Status; detail: string; paymentState: "captured" | "pending" | "blocked"; paypalOrderId?: string; paypalApprovalUrl?: string };
const seed: Milestone[] = [
  { id: 1, label: "30%", title: "Discovery & direction", amount: 300, status: "paid", detail: "Brief, moodboard, and visual direction approved.", paymentState: "captured", paypalOrderId: "PP-PACT-001" },
  { id: 2, label: "50%", title: "Three logo concepts", amount: 200, status: "review", detail: "Sample deliverables are ready for evidence review.", paymentState: "pending" },
  { id: 3, label: "75%", title: "Approved revision", amount: 250, status: "locked", detail: "Unlocks after the concept milestone is accepted.", paymentState: "blocked" },
  { id: 4, label: "100%", title: "Final brand package", amount: 250, status: "locked", detail: "Final exports and source assets.", paymentState: "blocked" },
];

export default function Home() {
  const [milestones, setMilestones] = useState(seed); const [activeId, setActiveId] = useState(2); const [notice, setNotice] = useState("Review the submitted evidence before approving a payment."); const [scope, setScope] = useState(false); const [evidenceOpen, setEvidenceOpen] = useState(false); const [verification, setVerification] = useState<{ milestoneId: number; result: VerificationResult; mode: string } | null>(null); const [paymentBusy, setPaymentBusy] = useState(false); const [paymentError, setPaymentError] = useState(""); const [paymentPhase, setPaymentPhase] = useState<"idle" | "creating" | "capturing">("idle"); const paymentCancelled = useRef(false); const [role, setRole] = useState<"owner" | "provider">("owner"); const [activeNav, setActiveNav] = useState<"overview" | "pacts" | "payments" | "settings">("overview");
  const active = milestones.find((m) => m.id === activeId) ?? milestones[1]; const paid = useMemo(() => milestones.filter((m) => m.status === "paid").reduce((a, m) => a + m.amount, 0), [milestones]);
  useEffect(() => {
    if (!scope && !evidenceOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setScope(false); setEvidenceOpen(false); } };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [scope, evidenceOpen]);
  useEffect(() => {
    let pending;
    try { pending = parsePendingPayment(sessionStorage.getItem(PENDING_PAYMENT_KEY)); } catch { return; }
    if (!pending) return;
    const saved = pending;
    const frame = requestAnimationFrame(() => {
      setMilestones((current) => current.map((milestone) => milestone.id === saved.milestoneId ? { ...milestone, status: "approval", paymentState: "pending", paypalOrderId: saved.orderId, paypalApprovalUrl: saved.approvalUrl, detail: "PayPal order restored. Approve it in the sandbox before capturing." } : milestone));
      setActiveId(saved.milestoneId);
      const result = new URLSearchParams(window.location.search).get("paypal");
      setNotice(result === "cancelled" ? "PayPal approval was cancelled. The order remains unpaid; you can retry approval." : "Pending PayPal order restored. Confirm buyer approval before capture.");
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  const update = (status: Status, detail: string, payment?: Pick<Milestone, "paymentState" | "paypalOrderId" | "paypalApprovalUrl">) => setMilestones((xs) => xs.map((m) => m.id === activeId ? { ...m, status, detail, ...payment } : m));
  const captureApprovedPayment = async () => { if (paymentBusy || !active.paypalOrderId) return; setPaymentBusy(true); setPaymentPhase("capturing"); try { const capture = await fetch(`/api/paypal/order/${active.paypalOrderId}/capture`, { method: "POST", headers: { "Idempotency-Key": `pact-capture-${active.id}-${active.paypalOrderId}` } }).then((response) => response.json()); if (capture.mode !== "paypal-sandbox" || capture.status !== "COMPLETED") throw new Error(capture.error ?? "PayPal did not confirm this capture."); try { sessionStorage.removeItem(PENDING_PAYMENT_KEY); } catch {} update("paid", "Owner approved. PayPal sandbox capture completed.", { paymentState: "captured" }); setNotice(`$${active.amount} captured in PayPal sandbox. Order ${active.paypalOrderId}.`); setActiveId(Math.min(activeId + 1, 4)); } catch (error) { const message = error instanceof Error ? error.message : "Payment could not be completed."; setPaymentError(message); setNotice(message); } finally { setPaymentBusy(false); setPaymentPhase("idle"); } };
  const approve = async () => { if (paymentBusy) return; if (verification?.milestoneId !== active.id || !verification.result.eligible) { setNotice("Open View evidence and complete an eligible verification before approving payment."); return; } paymentCancelled.current = false; setPaymentError(""); setPaymentBusy(true); setPaymentPhase("creating"); try { const idempotencyKey = `pact-${active.id}-${Date.now()}`; const order = await fetch("/api/paypal/order", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify({ amount: active.amount, currency: "USD", returnUrl: `${window.location.origin}/?paypal=approved`, cancelUrl: `${window.location.origin}/?paypal=cancelled` }) }).then((response) => response.json()); if (paymentCancelled.current) return; if (order.mode !== "paypal-sandbox" || !order.orderId) throw new Error(order.error ?? "PayPal Sandbox order creation failed."); const approvalUrl = Array.isArray(order.links) ? order.links.find((link: { rel?: string; href?: string }) => link.rel === "approve")?.href : undefined; const pending = parsePendingPayment(JSON.stringify({ milestoneId: active.id, orderId: order.orderId, approvalUrl })); if (!pending) throw new Error("PayPal did not return a valid sandbox approval link."); try { sessionStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(pending)); } catch { throw new Error("Unable to retain the pending order in this browser."); } update("approval", "PayPal order created. Approve the sandbox order, then return here to capture the milestone.", { paymentState: "pending", paypalOrderId: order.orderId, paypalApprovalUrl: approvalUrl }); setNotice("PayPal sandbox approval is required before this milestone can be captured."); return; } catch (error) { if (!paymentCancelled.current) { const message = error instanceof Error ? error.message : "Payment could not be completed."; setPaymentError(message); setNotice(message); } } finally { if (!paymentCancelled.current) setPaymentPhase("idle"); setPaymentBusy(false); } };  const cancelPayment = () => { paymentCancelled.current = true; setPaymentBusy(false); setPaymentPhase("idle"); setPaymentError(""); setNotice("Payment attempt cancelled locally. No milestone was marked paid."); };
  const revise = () => { update("revision", "Revision requested: add the missing accessibility lockup."); setNotice("Revision requested. Payment remains blocked until evidence is resubmitted."); };
  const resubmit = () => { if (active.status !== "revision") return; setVerification(null); update("review", "New evidence received. Delivery Agent is ready to re-check."); setNotice("Evidence resubmitted. Open the evidence report to run the check."); };
  const selectNav = (view: "overview" | "pacts" | "payments" | "settings") => {
    setActiveNav(view);
    const messages = {
      overview: "Overview shows the current Pact decision path.",
      pacts: "My Pacts is focused on Brand identity kit in this sample journey.",
      payments: "Payments is showing the milestone ledger for this sample Pact.",
      settings: "Settings are available from your authenticated workspace account.",
    };
    setNotice(messages[view]);
  };
  const exportLedger = () => {
    const rows = [
      ["Event", "Actor", "Result", "Payment state", "Amount", "Transaction"],
      ["Pact created", "You", "Approved", "-", "-", "PACT_8F2A"],
      ...milestones.map((milestone) => [
        `Milestone ${milestone.id} payment`,
        milestone.paymentState === "captured" ? "PayPal" : milestone.status === "approval" ? "Owner" : "Delivery Agent",
        milestone.paymentState === "captured" ? "Captured" : milestone.status === "review" ? "Awaiting owner" : milestone.status === "approval" ? "Awaiting PayPal approval" : "Locked",
        milestone.paymentState === "captured" ? "CAPTURED" : milestone.status === "approval" ? "AWAITING PAYPAL" : milestone.paymentState === "pending" ? "PENDING APPROVAL" : "BLOCKED",
        `$${milestone.amount.toFixed(2)}`,
        milestone.paypalOrderId ?? "-",
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "paypal-pact-ledger.csv";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Ledger exported as paypal-pact-ledger.csv.");
  };
  return <main className="app-shell">
<header className="topbar"><div className="brand"><Image src="/pact-supplied-icon.png" alt="" width={36} height={36} /><span>PayPal <strong>Pact</strong></span></div><div className="topbar-actions"><div className="role-switch" aria-label="Choose dashboard role"><button className={role === "owner" ? "selected" : ""} aria-pressed={role === "owner"} onClick={() => setRole("owner")}>Owner</button><button className={role === "provider" ? "selected" : ""} aria-pressed={role === "provider"} onClick={() => setRole("provider")}>Provider</button></div><span className="owner-view">{role === "owner" ? "Owner view" : "Provider view"}</span><i aria-hidden="true" /> Sample walkthrough <Link href="/workspace" className="owner-view">Account</Link></div></header>
    <div className="workspace"><aside className="sidebar"><label>Workspace</label>{(["overview", "pacts", "payments", "settings"] as const).map((view, i) => { const labels = ["⌂ Overview", "◫ My Pacts", "◌ Payments", "⚙ Settings"]; return <button className={activeNav === view ? "nav active" : "nav"} aria-current={activeNav === view ? "page" : undefined} key={view} onClick={() => selectNav(view)}>{labels[i]}</button>; })}<div className="side-bottom"><label>Current Pact</label><div className="mini"><span aria-hidden="true">✦</span><div><strong>Brand identity kit</strong><small>pact_8F2A · $1,000</small></div></div></div></aside>
      <section className="content"><div className="heading"><div><small>{role === "owner" ? "OWNER REVIEW" : "PROVIDER WORKSPACE"} · PACT_8F2A</small><h1>Brand identity kit</h1><p>{role === "owner" ? "A four-step agreement between you and Studio North." : "Your next delivery is ready for evidence submission."}</p></div>{role === "owner" && <div className="heading-actions"><Link className="outline" href="/workspace?manage=1">＋ Create Pact</Link><button className="outline" onClick={() => setScope(true)}>＋ Request change</button></div>}</div>
        {role === "provider" && <section className="provider-banner"><div className="provider-mark">✦</div><div><strong>Milestone 2 · Three logo concepts</strong><p>Submit the remaining accessibility lockup to unlock the $200 progress payment.</p></div><span className="provider-deadline">Due in 2 days</span></section>}
        {notice && <div className="notice" role="status">✦ <span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
        <div className="stats"><div><span>Total Pact value</span><b>$1,000</b><small>USD · sandbox Pact</small></div><div><span>Paid so far</span><b>${paid}</b><small>{paid / 10}% of agreement</small></div><div><span>Next deadline</span><b>2 days</b><small>Sample deadline · Oct 18</small></div><div><span>Agreement health</span><b className="green">● On track</b><small>Checked just now</small></div></div>
        <div className="columns"><section className="panel"><div className="panel-head"><div><h2>Milestone timeline</h2><p>Each payment unlocks when work is verified and accepted.</p></div><em>✓ Pact active</em></div><div className="timeline" role="list" aria-label="Pact milestones">{milestones.map((m, i) => <div className="node-wrap" key={m.id} role="listitem"><button className={`node ${m.status}`} aria-label={`${m.label} ${m.title}, ${m.status === "locked" ? "locked" : "select milestone"}`} aria-current={m.id === activeId ? "step" : undefined} disabled={m.status === "locked"} onClick={() => setActiveId(m.id)}>{m.status === "paid" ? "✓" : m.status === "revision" ? "!" : m.status === "approval" ? "↗" : m.id}</button>{i < milestones.length - 1 && <span aria-hidden="true" className={m.status === "paid" ? "connector done" : "connector"} />}</div>)}</div><div className="milestone"><div><small>{active.label}</small><h3>{active.title}</h3></div><strong className={active.status === "paid" ? "green" : "blue"}>{active.status === "paid" ? "Paid" : `+$${active.amount}`}</strong><p>{active.detail}</p><footer><span className={`pill ${active.status}`}>{active.status === "review" ? "Ready for your review" : active.status === "revision" ? "Revision requested" : active.status === "approval" ? "Awaiting PayPal approval" : active.status === "paid" ? "Payment complete" : "Locked"}</span><span>✦ Delivery Agent {active.status === "approval" ? "ready for PayPal approval" : active.status === "review" ? (verification?.milestoneId === active.id ? (verification.result.eligible ? "passed" : "needs revision") : "not checked") : "verified"}</span></footer></div>{role === "provider" && <div className="evidence-box"><div><strong>Evidence checklist</strong><span>2 of 3 items complete</span></div><ul><li className="done">Three concept PNGs</li><li className="done">Editable source file</li><li>Accessibility lockup <small>Missing · add before resubmitting</small></li></ul>{active.status === "revision" && <button className="primary" onClick={resubmit}>Resubmit evidence</button>}</div>}</section>
          <aside className="panel review"><div className="panel-head"><div><h2>Two-step verification</h2><p>Both checks are required before payment.</p></div></div><div className="verify"><div><b aria-hidden="true">✦</b><span><strong>1 · Delivery Agent</strong><small>Objective evidence check</small></span><i>{verification?.milestoneId === active.id ? (verification.result.eligible ? "✓" : "!") : "—"}</i></div><button className="evidence-link" onClick={() => setEvidenceOpen(true)} aria-haspopup="dialog">View evidence</button><hr /><div><b>AJ</b><span><strong>2 · You</strong><small>Owner acceptance</small></span><i className={active.status === "review" ? "pending" : ""}>{active.status === "review" ? "2" : "✓"}</i></div></div>{role === "owner" && active.status === "review" && <div className="actions"><button className="primary" disabled={paymentBusy} onClick={approve}>{paymentPhase === "creating" ? "Creating PayPal order…" : paymentPhase === "capturing" ? "Capturing payment…" : `Approve & pay $${active.amount}`}</button>{paymentBusy && <button className="text cancel-payment" onClick={cancelPayment}>Cancel attempt</button>}{paymentError && !paymentBusy && <div className="payment-error" role="alert"><strong>Payment not completed</strong><span>{paymentError}</span><button className="text" onClick={approve}>Retry payment</button></div>}{!paymentBusy && !paymentError && <button className="text" onClick={revise}>Request revision</button>}</div>}
{role === "owner" && active.status === "approval" && <div className="actions approval-actions"><p>Order <span className="mono">{active.paypalOrderId}</span> is ready. Approve it in the PayPal sandbox, then return here.</p>{active.paypalApprovalUrl && <a className="primary approval-link" href={active.paypalApprovalUrl}>Open PayPal sandbox approval</a>}<button className="primary" disabled={paymentBusy} onClick={captureApprovedPayment}>{paymentBusy ? "Capturing payment…" : "I approved in PayPal — capture payment"}</button></div>}{active.status === "revision" && <div className="actions">{role === "provider" ? <button className="primary" onClick={resubmit}>Resubmit evidence</button> : <p>Payment is blocked until the provider resubmits evidence.</p>}<p>Payment is blocked until the missing requirement is resolved.</p></div>}{active.status === "approval" && role === "provider" && <div className="success approval-wait">✓ <span><strong>Awaiting owner PayPal approval</strong><small>The owner must approve and capture this milestone.</small></span></div>}{active.status === "paid" && <div className="success">✓ <span><strong>Payment captured</strong><small>PayPal sandbox or fallback adapter · milestone_{active.id} · just now</small></span></div>}</aside></div>
        <section className="panel ledger"><div className="panel-head"><div><h2>Pact Ledger</h2><p>Explainable record of every decision and payment event.</p></div><button className="outline" onClick={exportLedger}>Export ledger</button></div><div className="table-wrap"><table><thead><tr><th>Event</th><th>Actor</th><th>Result</th><th>Payment state</th><th>Amount</th><th>Transaction</th></tr></thead><tbody><tr><td>● Pact created</td><td>You</td><td>Approved</td><td>—</td><td>—</td><td>PACT_8F2A</td></tr>{milestones.map((m) => <tr key={m.id}><td>● Milestone {m.id} payment</td><td>{m.paymentState === "captured" ? "PayPal" : m.status === "approval" ? "Owner" : "Delivery Agent"}</td><td className={m.paymentState === "captured" ? "green" : m.status === "review" || m.status === "approval" ? "orange" : "muted"}>{m.paymentState === "captured" ? "Captured" : m.status === "review" ? "Awaiting owner" : m.status === "approval" ? "Awaiting PayPal approval" : "Locked"}</td><td><span className={`payment-state ${m.paymentState}`}>{m.paymentState === "captured" ? "CAPTURED" : m.status === "approval" ? "AWAITING PAYPAL" : m.paymentState === "pending" ? "PENDING APPROVAL" : "BLOCKED"}</span></td><td>${m.amount.toFixed(2)}</td><td className="mono">{m.paypalOrderId ?? "—"}</td></tr>)}</tbody></table></div></section><footer><span>PayPal Pact · Progressive settlement for human work</span><span>Built for the PayPal AI Hackathon · Sandbox mode</span></footer></section></div>
    {evidenceOpen && <EvidenceReview milestone={active} onVerified={(result, mode) => setVerification({ milestoneId: active.id, result, mode })} onClose={() => setEvidenceOpen(false)} />}
    {scope && <div className="modal-bg" role="presentation" onClick={() => setScope(false)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="scope-title" onClick={(e) => e.stopPropagation()}><div className="modal-dialog-head"><h2 id="scope-title">Scope change detected</h2><button className="modal-close" aria-label="Close scope change dialog" autoFocus onClick={() => setScope(false)}>×</button></div><p>“Also create a mobile app” adds a new deliverable outside this Pact.</p><div className="change"><small>New change order</small><strong>Mobile app design</strong><span>AI suggests +$400 · +7 days</span></div><button className="primary" onClick={() => { setScope(false); setNotice("Change order drafted. Owner approval is required before work begins."); }}>Review change order</button></div></div>}
  </main>;
}

function EvidenceReview({ milestone, onClose, onVerified }: { milestone: Milestone; onClose: () => void; onVerified: (result: VerificationResult, mode: string) => void }) {
  const [report, setReport] = useState<{ result: VerificationResult; mode: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const criteria = ["Three concept PNGs", "Editable source file", "Accessibility lockup"];
  const evidence = milestone.status === "revision" ? criteria.slice(0, 2) : criteria;
  async function runCheck() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/pact/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: milestone.title, acceptanceCriteria: criteria, evidence }) });
      if (!response.ok) throw new Error("Verification could not be completed. Try again.");
      const data = await response.json() as { verification: VerificationResult; mode: string };
      setReport({ result: data.verification, mode: data.mode }); onVerified(data.verification, data.mode);
    } catch { setError("Verification could not be completed. Try again."); } finally { setLoading(false); }
  }
  return <div className="modal-bg" role="presentation" onClick={onClose}>
    <section className="modal evidence-review" role="dialog" aria-modal="true" aria-labelledby="evidence-title" onClick={(event) => event.stopPropagation()}>
      <div className="wizard-head"><div><small>DELIVERY AGENT REPORT · {milestone.label}</small><h2 id="evidence-title">Evidence review</h2><p>{milestone.title}</p></div><button className="modal-close" aria-label="Close evidence review" autoFocus onClick={onClose}>×</button></div>
      <div className="agent-mode"><span aria-hidden="true">✦</span><div><strong>{report ? (report.mode === "ai-provider" ? "Muse verification" : "Deterministic verifier") : "Evidence check"}</strong><small>Owner decision still required</small></div><b>{report ? (report.result.eligible ? "Eligible" : "Needs revision") : "Not checked"}</b></div>
      <div className="evidence-columns"><div><h3>Acceptance criteria</h3><ul>{criteria.map((item) => <li key={item}>{item}</li>)}</ul></div><div><h3>Sample evidence</h3><ul>{evidence.map((item) => <li className="evidence-found" key={item}>✓ {item}</li>)}{report?.result.missingItems.map((item) => <li className="evidence-missing" key={item}>Missing: {item}</li>)}</ul></div></div>
      {report && <div className="evidence-summary"><strong>{report.result.eligible ? "Eligible for owner review" : "Payment blocked pending revision"}</strong><span>{report.result.summary}</span></div>}
      {error && <p role="alert">{error}</p>}
      <button className="primary" onClick={runCheck} disabled={loading}>{loading ? "Checking evidence..." : "Run evidence check"}</button>
      <div className="modal-actions"><button className="outline" onClick={onClose}>Close report</button></div>
    </section>
  </div>;
}
