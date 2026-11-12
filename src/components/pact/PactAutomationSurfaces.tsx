"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import styles from "./PactAutomationSurfaces.module.css";

export type ConnectorId = "github" | "figma";
export type ConnectorState = "connected" | "needs_auth" | "error" | "not_configured";
export type ConnectorActionState = { status: "loading" | "success" | "error"; message: string };
type DecisionActionState = { status: "loading" | "error"; message: string };

export type ConnectorResource = {
  id: string;
  name: string;
  detail?: string;
  href?: string;
  scopeOptions?: Partial<Record<"branch" | "pullRequest" | "workflow" | "versionId" | "pageId" | "frameId" | "nodeId", Array<{ value: string; label: string }>>>;
};

export type ConnectorScope = {
  branch?: string;
  pullRequest?: string;
  workflow?: string;
  versionId?: string;
  pageId?: string;
  frameId?: string;
  nodeId?: string;
};

export type Connector = {
  id: ConnectorId;
  connectionId?: string;
  name: string;
  description: string;
  state: ConnectorState;
  accountLabel?: string;
  resources: ConnectorResource[];
  selectedResourceId?: string | null;
  error?: string;
  actionState?: ConnectorActionState;
};

export type ConnectorMilestone = { id: string; title: string; sourceConnectionId?: string | null };
export type ConnectorDiscovery = { teamId?: string; projectId?: string };

const connectorStateCopy: Record<ConnectorState, string> = {
  connected: "Connected",
  needs_auth: "Needs setup",
  error: "Unavailable",
  not_configured: "Not configured",
};

function connectorMark(id: ConnectorId) {
  return id === "github" ? "GH" : "F";
}

export function ConnectorSetup({
  connectors,
  onConfigure,
  onResourceSelect,
  onResourceDiscover,
  milestones = [],
  onMilestoneSourceSelect,
  title = "Evidence sources",
  description = "Choose the repository and design file used for this Pact.",
}: {
  connectors: Connector[];
  onConfigure?: (connector: Connector) => void;
  onResourceSelect?: (connector: Connector, resourceId: string) => void;
  onResourceDiscover?: (connector: Connector, discovery: ConnectorDiscovery) => void;
  milestones?: ConnectorMilestone[];
  onMilestoneSourceSelect?: (connector: Connector, milestoneId: string, scope: ConnectorScope) => void;
  title?: string;
  description?: string;
}) {
  const connectorKey = (connector: Connector) => connector.connectionId ?? connector.id;
  const firstConnector = connectors.find((connector) => connector.state === "connected") ?? connectors[0];
  const [expanded, setExpanded] = useState<string | null>(firstConnector ? connectorKey(firstConnector) : null);
  const [localSelections, setLocalSelections] = useState<Record<string, string>>({});
  const [manualResourceValues, setManualResourceValues] = useState<Record<string, string>>({});
  const [scopeValues, setScopeValues] = useState<Record<string, ConnectorScope>>({});
  const [discoveryValues, setDiscoveryValues] = useState<Record<string, ConnectorDiscovery>>({});
  const fieldId = useId();

  function scopeFields(connector: ConnectorId) {
    return connector === "github"
      ? ([
        ["branch", "Branch", "main"],
        ["pullRequest", "Pull request", "#42"],
        ["workflow", "Workflow", "build-and-test"],
      ] as const)
      : ([
        ["versionId", "Version", "latest version id"],
        ["pageId", "Page", "page id or name"],
        ["frameId", "Frame", "frame id"],
        ["nodeId", "Node", "node id"],
      ] as const);
  }

  return (
    <section className={styles.panel} aria-labelledby={`${fieldId}-title`}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>PACT SOURCES</p>
          <h2 id={`${fieldId}-title`}>{title}</h2>
          <p className={styles.panelDescription}>{description}</p>
        </div>
        <span className={styles.sourceCount}>{connectors.length} sources</span>
      </div>
      <div className={styles.connectorList} role="list">
        {connectors.map((connector) => {
          const key = connectorKey(connector);
          const isExpanded = expanded === key;
          const resourceId = `${fieldId}-${key}-resource`;
          return (
            <div className={styles.connectorItem} key={key} role="listitem">
              <button
                type="button"
                className={styles.connectorSummary}
                aria-expanded={isExpanded}
                aria-controls={resourceId}
                onClick={() => setExpanded(isExpanded ? null : key)}
              >
                <span className={`${styles.connectorMark} ${connector.id === "figma" ? styles.connectorMarkFigma : ""}`} aria-hidden="true">{connectorMark(connector.id)}</span>
                <span className={styles.connectorText}>
                  <strong>{connector.name}</strong>
                  <small>{connector.accountLabel ?? connector.description}</small>
                </span>
                <span className={`${styles.stateBadge} ${styles[`state_${connector.state}`]}`}>
                  <span aria-hidden="true" />{connectorStateCopy[connector.state]}
                </span>
                <span className={styles.disclosure} aria-hidden="true">{isExpanded ? "−" : "+"}</span>
              </button>
              {isExpanded && (
                <div className={styles.connectorDetails} id={resourceId}>
                  {connector.state === "connected" ? (
                    connector.resources.length > 0 ? (
                      <>
                        <label className={styles.resourceField}>
                          <span>Resource for this Pact</span>
                          <select
                            value={connector.selectedResourceId ?? localSelections[key] ?? ""}
                            disabled={connector.actionState?.status === "loading"}
                            onChange={(event) => {
                              setLocalSelections((current) => ({ ...current, [key]: event.target.value }));
                              onResourceSelect?.(connector, event.target.value);
                            }}
                          >
                            <option value="" disabled>Select a resource</option>
                            {connector.resources.map((resource) => <option value={resource.id} key={resource.id}>{resource.name}</option>)}
                          </select>
                        </label>
                      </>
                    ) : (
                      <div className={styles.manualResourceField}>
                        {connector.id === "figma" && onResourceDiscover && <div className={styles.discoveryFields}>
                          <label className={styles.resourceField}>
                            <span>Figma team ID <small>optional</small></span>
                            <input value={discoveryValues[key]?.teamId ?? ""} placeholder="Team ID" onChange={(event) => setDiscoveryValues((current) => ({ ...current, [key]: { ...current[key], teamId: event.target.value } }))} />
                          </label>
                          <label className={styles.resourceField}>
                            <span>Project ID <small>optional</small></span>
                            <input value={discoveryValues[key]?.projectId ?? ""} placeholder="Project ID" onChange={(event) => setDiscoveryValues((current) => ({ ...current, [key]: { ...current[key], projectId: event.target.value } }))} />
                          </label>
                          <button type="button" className={styles.secondaryButton} disabled={connector.actionState?.status === "loading"} onClick={() => onResourceDiscover(connector, discoveryValues[key] ?? {})}>{connector.actionState?.status === "loading" ? "Loading private files…" : "Load private files"}</button>
                        </div>}
                        <label className={styles.resourceField}>
                          <span>{connector.id === "github" ? "Repository (owner/name)" : "Figma file key"}</span>
                          <input
                            id={`${fieldId}-${key}-manual`}
                            value={manualResourceValues[key] ?? ""}
                            placeholder={connector.id === "github" ? "acme/launch-kit" : "Paste the file key from the Figma URL"}
                            onChange={(event) => setManualResourceValues((current) => ({ ...current, [key]: event.target.value }))}
                          />
                        </label>
                        {onResourceSelect && <button type="button" className={styles.secondaryButton} disabled={connector.actionState?.status === "loading"} onClick={() => {
                          const value = manualResourceValues[key]?.trim();
                          if (value) onResourceSelect(connector, value);
                        }}>{connector.actionState?.status === "loading" ? "Attaching resource…" : "Attach resource"}</button>}
                      </div>
                    )
                  ) : (
                    <div className={styles.connectorNotice} role={connector.state === "error" ? "alert" : "status"}>
                      <p>{connector.error ?? (connector.state === "needs_auth" ? "Connect this source before evidence can be checked." : "This source is unavailable for the current Pact.")}</p>
                      {onConfigure && <button type="button" className={styles.secondaryButton} onClick={() => onConfigure(connector)}>{connector.state === "needs_auth" ? "Configure source" : "Review setup"}</button>}
                    </div>
                  )}
                  {connector.state === "connected" && connector.selectedResourceId && (
                    <>
                      <p className={styles.resourceHint}>
                        {connector.resources.find((resource) => resource.id === connector.selectedResourceId)?.detail ?? "Selected resource will be included in the next evidence snapshot."}
                      </p>
                      {milestones.length > 0 && onMilestoneSourceSelect && <div className={styles.milestoneMapping}>
                        <span>Use this source for a milestone</span>
                        <div className={styles.scopeFields}>
                          {scopeFields(connector.id).map(([key, label, placeholder]) => (
                            <label className={styles.scopeField} key={key}>
                              <span>{label}</span>
                              {(() => {
                                const options = connector.resources.find((resource) => resource.id === connector.selectedResourceId)?.scopeOptions?.[key];
                                const value = scopeValues[connectorKey(connector)]?.[key] ?? "";
                                const onChange = (nextValue: string) => setScopeValues((current) => ({
                                  ...current,
                                  [connectorKey(connector)]: { ...current[connectorKey(connector)], [key]: nextValue },
                                }));
                                return options?.length ? <select value={value} aria-label={label} onChange={(event) => onChange(event.target.value)}>
                                  <option value="">Any {label.toLowerCase()}</option>
                                  {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select> : <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
                              })()}
                            </label>
                          ))}
                        </div>
                        <div className={styles.milestoneMappingList}>
                          {milestones.map((milestone) => <button type="button" key={milestone.id} disabled={connector.actionState?.status === "loading"} className={`${styles.mappingButton} ${milestone.sourceConnectionId === connector.connectionId ? styles.mappingButtonActive : ""}`} onClick={() => {
                            const scope = Object.fromEntries(Object.entries(scopeValues[connectorKey(connector)] ?? {}).filter(([, value]) => value?.trim())) as ConnectorScope;
                            onMilestoneSourceSelect(connector, milestone.id, scope);
                          }}>{milestone.title}</button>)}
                        </div>
                      </div>}
                    </>
                  )}
                  {connector.actionState && <p className={`${styles.actionStatus} ${styles[`action_${connector.actionState.status}`]}`} role={connector.actionState.status === "error" ? "alert" : "status"}>{connector.actionState.message}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export type AgentActivityStep = {
  id: string;
  label: string;
  detail?: string;
  status: "complete" | "running" | "blocked" | "pending";
  timestamp?: string;
};

export type ProvenanceItem = {
  id: string;
  source: string;
  reference?: string;
  observedAt?: string;
  href?: string;
};

const activityStatusCopy: Record<AgentActivityStep["status"], string> = {
  complete: "Complete",
  running: "In progress",
  blocked: "Blocked",
  pending: "Pending",
};

export function AgentActivity({
  steps,
  provenance = [],
  onOpenSource,
}: {
  steps: AgentActivityStep[];
  provenance?: ProvenanceItem[];
  onOpenSource?: (item: ProvenanceItem) => void;
}) {
  const titleId = useId();
  return (
    <section className={styles.panel} aria-labelledby={`${titleId}-title`}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>DELIVERY AGENT</p>
          <h2 id={`${titleId}-title`}>Activity and provenance</h2>
        </div>
        <span className={styles.liveIndicator}><span aria-hidden="true" />Policy aware</span>
      </div>
      <ol className={styles.activityList} aria-label="Delivery Agent activity" aria-live="polite">
        {steps.map((step) => (
          <li className={`${styles.activityStep} ${styles[`activity_${step.status}`]}`} key={step.id}>
            <span className={styles.activityMarker} aria-hidden="true">{step.status === "complete" ? "✓" : step.status === "blocked" ? "!" : step.status === "running" ? "…" : ""}</span>
            <span className={styles.activityCopy}>
              <strong>{step.label}</strong>
              {step.detail && <small>{step.detail}</small>}
            </span>
            <span className={styles.activityState}>{activityStatusCopy[step.status]}{step.timestamp ? ` · ${step.timestamp}` : ""}</span>
          </li>
        ))}
      </ol>
      <div className={styles.provenance}>
        <div className={styles.subsectionHeader}><h3>Evidence snapshot</h3><span>{provenance.length} references</span></div>
        {provenance.length > 0 ? (
          <ul className={styles.provenanceList}>
            {provenance.map((item) => (
              <li key={item.id}>
                <span className={styles.provenanceDot} aria-hidden="true" />
                <span className={styles.provenanceCopy}>
                  {item.href ? <a href={item.href} target="_blank" rel="noreferrer" onClick={() => onOpenSource?.(item)}>{item.source}</a> : <strong>{item.source}</strong>}
                  <small>{[item.reference, item.observedAt ? `observed ${item.observedAt}` : ""].filter(Boolean).join(" · ") || "Reference details unavailable"}</small>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.inlineNote}>No evidence snapshot has been recorded yet.</p>
        )}
      </div>
    </section>
  );
}

export type ExceptionSeverity = "high" | "medium" | "low";
export type ExceptionCategory = "payment" | "evidence" | "scope" | "access";

export type PactException = {
  id: string;
  actionId?: string;
  title: string;
  detail: string;
  severity: ExceptionSeverity;
  category: ExceptionCategory;
  milestone?: string;
  amountCents?: number;
  currency?: string;
  createdAt?: string;
  actionLabel?: string;
};

const exceptionFilters: Array<{ id: "open" | ExceptionCategory; label: string }> = [
  { id: "open", label: "Open" },
  { id: "payment", label: "Payments" },
  { id: "evidence", label: "Evidence" },
  { id: "scope", label: "Scope" },
  { id: "access", label: "Access" },
];

function formatAmount(amountCents: number | undefined, currency = "USD") {
  if (typeof amountCents !== "number" || !Number.isFinite(amountCents)) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountCents / 100);
}

export function ExceptionInbox({
  items,
  onSelect,
  onAction,
  onReject,
  emptyMessage = "No exceptions need attention.",
}: {
  items: PactException[];
  onSelect?: (item: PactException) => void;
  onAction?: (item: PactException) => Promise<void> | void;
  onReject?: (item: PactException) => Promise<void> | void;
  emptyMessage?: string;
}) {
  const [filter, setFilter] = useState<"open" | ExceptionCategory>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionStates, setActionStates] = useState<Record<string, DecisionActionState>>({});
  const visibleItems = useMemo(() => filter === "open" ? items : items.filter((item) => item.category === filter), [filter, items]);
  const titleId = useId();

  function selectItem(item: PactException) {
    setSelectedId((current) => current === item.id ? null : item.id);
    onSelect?.(item);
  }

  async function runAction(item: PactException, action: (() => Promise<void> | void) | undefined) {
    if (!action || actionStates[item.id]?.status === "loading") return;
    setActionStates((current) => ({ ...current, [item.id]: { status: "loading", message: "Saving decision…" } }));
    try {
      await action();
      setActionStates((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    } catch (error) {
      setActionStates((current) => ({
        ...current,
        [item.id]: { status: "error", message: error instanceof Error ? error.message : "This decision could not be saved." },
      }));
    }
  }

  return (
    <section className={styles.panel} aria-labelledby={`${titleId}-title`}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>CONTROL DESK</p>
          <h2 id={`${titleId}-title`}>Exception inbox</h2>
        </div>
        <span className={`${styles.inboxCount} ${items.length > 0 ? styles.inboxCountActive : ""}`}>{items.length} open</span>
      </div>
      <div className={styles.filterBar} role="group" aria-label="Filter exceptions">
        {exceptionFilters.map((option) => (
          <button type="button" key={option.id} className={`${styles.filterButton} ${filter === option.id ? styles.filterButtonActive : ""}`} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>{option.label}</button>
        ))}
      </div>
      {visibleItems.length === 0 ? <p className={styles.emptyState}>{emptyMessage}</p> : (
        <ul className={styles.exceptionList}>
          {visibleItems.map((item) => {
            const isSelected = selectedId === item.id;
            const amount = formatAmount(item.amountCents, item.currency);
            return (
              <li className={`${styles.exceptionItem} ${styles[`severity_${item.severity}`]}`} key={item.id}>
                <button type="button" className={styles.exceptionRow} aria-expanded={isSelected} onClick={() => selectItem(item)}>
                  <span className={styles.severityMark} aria-hidden="true">{item.severity === "high" ? "!" : item.severity === "medium" ? "·" : "i"}</span>
                  <span className={styles.exceptionCopy}><strong>{item.title}</strong><small>{[item.milestone, amount, item.createdAt].filter(Boolean).join(" · ")}</small></span>
                  <span className={styles.disclosure} aria-hidden="true">{isSelected ? "−" : "+"}</span>
                </button>
                {isSelected && <div className={styles.exceptionDetail}>
                  <p>{item.detail}</p>
                  {(onAction || onReject) && <div className={styles.exceptionActions}>
                    {onAction && item.actionId && <button type="button" className={styles.secondaryButton} disabled={actionStates[item.id]?.status === "loading"} onClick={() => runAction(item, () => onAction(item))}>{actionStates[item.id]?.status === "loading" ? "Saving…" : item.actionLabel ?? "Approve proposal"}</button>}
                    {onReject && item.actionId && <button type="button" className={styles.textButton} disabled={actionStates[item.id]?.status === "loading"} onClick={() => runAction(item, () => onReject(item))}>Reject</button>}
                  </div>}
                  {actionStates[item.id] && <p className={`${styles.actionStatus} ${styles[`action_${actionStates[item.id].status}`]}`} role={actionStates[item.id].status === "error" ? "alert" : "status"}>{actionStates[item.id].message}</p>}
                </div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export type PaymentStage = "policy_review" | "awaiting_owner_approval" | "awaiting_buyer_approval" | "captured" | "payout_pending" | "paid_to_provider" | "blocked" | "failed" | "revision_requested";
export type PayoutState = "not_requested" | "pending" | "paid" | "failed" | "blocked";

export type PaymentState = {
  stage: PaymentStage;
  amountCents: number;
  currency?: string;
  ownerApproved: boolean;
  buyerApproved?: boolean;
  payout: PayoutState;
  orderId?: string;
  payoutBatchId?: string;
  exception?: string;
};

export type NegotiationTerms = {
  requestedAmountCents?: number;
  agreedAmountCents: number;
  status: "proposed" | "accepted" | "needs_review";
  note?: string;
};

export type NegotiationOffer = {
  id: string;
  sessionId: string;
  deliverables: string[];
  amountDeltaCents: number;
  scheduleDeltaDays: number;
  rationale: string;
  status: "proposed" | "countered" | "accepted" | "rejected" | "expired";
  ownerAccepted: boolean;
  providerAccepted: boolean;
  createdAt?: string;
};

type GateStatus = "complete" | "current" | "blocked" | "pending";

function stageLabel(stage: PaymentStage) {
  const labels: Record<PaymentStage, string> = {
    policy_review: "Policy review",
    awaiting_owner_approval: "Awaiting owner acceptance",
    awaiting_buyer_approval: "Awaiting PayPal buyer approval",
    captured: "Captured",
    payout_pending: "Payout pending",
    paid_to_provider: "Paid to provider",
    blocked: "Blocked by policy",
    failed: "Payment needs attention",
    revision_requested: "Revision requested",
  };
  return labels[stage];
}

function gateStatus(state: PaymentState, gate: "policy" | "owner" | "buyer" | "capture" | "payout"): GateStatus {
  if (state.stage === "blocked" || state.stage === "failed" || state.stage === "revision_requested") return gate === "policy" ? "blocked" : "pending";
  if (gate === "policy") return state.stage === "policy_review" ? "current" : "complete";
  if (gate === "owner") return state.ownerApproved ? "complete" : state.stage === "awaiting_owner_approval" ? "current" : "pending";
  if (gate === "buyer") return state.buyerApproved ? "complete" : state.stage === "awaiting_buyer_approval" ? "current" : "pending";
  if (gate === "capture") return ["captured", "payout_pending", "paid_to_provider"].includes(state.stage) ? "complete" : "pending";
  if (state.payout === "paid" || state.stage === "paid_to_provider") return "complete";
  if (state.payout === "failed" || state.payout === "blocked") return "blocked";
  return state.payout === "pending" || state.stage === "payout_pending" ? "current" : "pending";
}

export function NegotiationPaymentState({
  state,
  terms,
  offers = [],
  currentRole,
  onOfferDecision,
  onPrimaryAction,
  primaryActionLabel,
}: {
  state: PaymentState;
  terms?: NegotiationTerms;
  offers?: NegotiationOffer[];
  currentRole?: "owner" | "provider";
  onOfferDecision?: (offer: NegotiationOffer, decision: "accepted" | "rejected") => Promise<void> | void;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
}) {
  const titleId = useId();
  const [offerActionStates, setOfferActionStates] = useState<Record<string, DecisionActionState>>({});
  const currency = state.currency ?? "USD";
  const amount = formatAmount(state.amountCents, currency) ?? `${state.amountCents} ${currency}`;
  const gates: Array<{ key: "policy" | "owner" | "buyer" | "capture" | "payout"; label: string; detail: string }> = [
    { key: "policy", label: "Policy check", detail: "Pact rules and evidence" },
    { key: "owner", label: "Owner acceptance", detail: "Human decision" },
    { key: "buyer", label: "PayPal buyer approval", detail: "Sandbox checkout" },
    { key: "capture", label: "Capture", detail: "Approved milestone amount" },
    { key: "payout", label: "Provider payout", detail: "Separate PayPal Payouts state" },
  ];

  async function runOfferDecision(offer: NegotiationOffer, decision: "accepted" | "rejected") {
    if (!onOfferDecision || offerActionStates[offer.id]?.status === "loading") return;
    setOfferActionStates((current) => ({ ...current, [offer.id]: { status: "loading", message: "Saving decision…" } }));
    try {
      await onOfferDecision(offer, decision);
      setOfferActionStates((current) => {
        const next = { ...current };
        delete next[offer.id];
        return next;
      });
    } catch (error) {
      setOfferActionStates((current) => ({
        ...current,
        [offer.id]: { status: "error", message: error instanceof Error ? error.message : "This offer decision could not be saved." },
      }));
    }
  }
  return (
    <section className={styles.panel} aria-labelledby={`${titleId}-title`}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>PAYMENT CONTROL</p>
          <h2 id={`${titleId}-title`}>Negotiation and settlement</h2>
        </div>
        <span className={`${styles.stageBadge} ${styles[`stage_${state.stage}`]}`} role="status" aria-live="polite">{stageLabel(state.stage)}</span>
      </div>
      <div className={styles.amountSummary}><span>Milestone amount</span><strong>{amount}</strong>{state.orderId && <small>Order {state.orderId}</small>}</div>
      {terms && <div className={styles.termsSummary}>
        <div><span>Requested</span><strong>{formatAmount(terms.requestedAmountCents, currency) ?? "Not provided"}</strong></div>
        <div><span>Agreed</span><strong>{formatAmount(terms.agreedAmountCents, currency) ?? "Not provided"}</strong></div>
        <span className={`${styles.termsStatus} ${styles[`terms_${terms.status}`]}`}>{terms.status.replaceAll("_", " ")}</span>
        {terms.note && <p>{terms.note}</p>}
      </div>}
      {offers.length > 0 && <div className={styles.offerSection} aria-label="Negotiation offers">
        <div className={styles.subsectionHeader}>
          <h3>AI-drafted offers</h3>
          <span>{offers.length} recorded</span>
        </div>
        <ul className={styles.offerList}>
          {offers.map((offer) => {
            const amountDelta = formatAmount(Math.abs(offer.amountDeltaCents), currency) ?? `${Math.abs(offer.amountDeltaCents)} ${currency}`;
            const amountLabel = offer.amountDeltaCents === 0 ? "No amount change" : `${offer.amountDeltaCents > 0 ? "+" : "-"}${amountDelta}`;
            const scheduleLabel = offer.scheduleDeltaDays === 0 ? "No schedule change" : `${offer.scheduleDeltaDays > 0 ? "+" : "-"}${Math.abs(offer.scheduleDeltaDays)} day${Math.abs(offer.scheduleDeltaDays) === 1 ? "" : "s"}`;
            const canDecide = Boolean(onOfferDecision && currentRole && ["proposed", "countered"].includes(offer.status));
            return <li className={styles.offerItem} key={offer.id}>
              <div className={styles.offerHeader}>
                <strong>{offer.status === "accepted" ? "Offer accepted" : offer.status === "rejected" ? "Offer rejected" : "Offer needs a decision"}</strong>
                <span className={`${styles.termsStatus} ${styles[`terms_${offer.status === "countered" ? "needs_review" : offer.status}`]}`}>{offer.status.replaceAll("_", " ")}</span>
              </div>
              <div className={styles.offerMetrics}>
                <span><small>Amount</small><strong>{amountLabel}</strong></span>
                <span><small>Schedule</small><strong>{scheduleLabel}</strong></span>
                <span><small>Participants</small><strong>{offer.ownerAccepted ? "Owner ✓" : "Owner pending"} · {offer.providerAccepted ? "Provider ✓" : "Provider pending"}</strong></span>
              </div>
              {offer.deliverables.length > 0 && <ul className={styles.offerDeliverables}>{offer.deliverables.slice(0, 4).map((deliverable) => <li key={deliverable}>{deliverable}</li>)}</ul>}
              <p className={styles.offerRationale}>{offer.rationale}</p>
              {offer.createdAt && <small className={styles.offerTimestamp}>{offer.createdAt}</small>}
              {canDecide && <div className={styles.offerActions}>
                <button type="button" className={styles.secondaryButton} disabled={offerActionStates[offer.id]?.status === "loading"} onClick={() => runOfferDecision(offer, "accepted")}>{offerActionStates[offer.id]?.status === "loading" ? "Saving…" : offer.ownerAccepted || offer.providerAccepted ? "Confirm offer" : "Accept offer"}</button>
                <button type="button" className={styles.textButton} disabled={offerActionStates[offer.id]?.status === "loading"} onClick={() => runOfferDecision(offer, "rejected")}>Reject</button>
              </div>}
              {offerActionStates[offer.id] && <p className={`${styles.actionStatus} ${styles[`action_${offerActionStates[offer.id].status}`]}`} role={offerActionStates[offer.id].status === "error" ? "alert" : "status"}>{offerActionStates[offer.id].message}</p>}
              {offer.status === "accepted" && <p className={styles.offerGate} role="status">Both participants accepted. Pact terms still require explicit agreement handling before payment changes.</p>}
            </li>;
          })}
        </ul>
      </div>}
      <ol className={styles.gateList} aria-label="Payment gates">
        {gates.map((gate) => {
          const status = gateStatus(state, gate.key);
          return <li className={`${styles.gateRow} ${styles[`gate_${status}`]}`} key={gate.key}>
            <span className={styles.gateMarker} aria-hidden="true">{status === "complete" ? "✓" : status === "blocked" ? "!" : status === "current" ? "·" : ""}</span>
            <span><strong>{gate.label}</strong><small>{gate.detail}</small></span>
            <em>{status === "complete" ? "Complete" : status === "current" ? "Current" : status === "blocked" ? "Blocked" : "Pending"}</em>
          </li>;
        })}
      </ol>
      {state.exception && <div className={styles.stateNotice} role="alert"><strong>Exception</strong><p>{state.exception}</p></div>}
      {state.payoutBatchId && <p className={styles.referenceLine}>Payout batch {state.payoutBatchId}</p>}
      {onPrimaryAction && primaryActionLabel && <button type="button" className={styles.primaryButton} onClick={onPrimaryAction}>{primaryActionLabel}</button>}
    </section>
  );
}

export function PactAutomationSurfaces({
  connectors,
  agentSteps,
  provenance,
  exceptions,
  paymentState,
  terms,
  negotiationOffers = [],
  currentRole,
  onOfferDecision,
  onConfigureConnector,
  onResourceSelect,
  onResourceDiscover,
  milestones,
  onMilestoneSourceSelect,
  onExceptionAction,
  onExceptionReject,
  onPaymentAction,
  paymentActionLabel,
}: {
  connectors: Connector[];
  agentSteps: AgentActivityStep[];
  provenance?: ProvenanceItem[];
  exceptions: PactException[];
  paymentState: PaymentState;
  terms?: NegotiationTerms;
  negotiationOffers?: NegotiationOffer[];
  currentRole?: "owner" | "provider";
  onOfferDecision?: (offer: NegotiationOffer, decision: "accepted" | "rejected") => Promise<void> | void;
  onConfigureConnector?: (connector: Connector) => void;
  onResourceSelect?: (connector: Connector, resourceId: string) => Promise<void> | void;
  onResourceDiscover?: (connector: Connector, discovery: ConnectorDiscovery) => Promise<void> | void;
  milestones?: ConnectorMilestone[];
  onMilestoneSourceSelect?: (connector: Connector, milestoneId: string, scope: ConnectorScope) => Promise<void> | void;
  onExceptionAction?: (item: PactException) => Promise<void> | void;
  onExceptionReject?: (item: PactException) => Promise<void> | void;
  onPaymentAction?: () => Promise<void> | void;
  paymentActionLabel?: string;
  footer?: ReactNode;
}) {
  return <div className={styles.surfaceGrid}>
    <ConnectorSetup connectors={connectors} onConfigure={onConfigureConnector} onResourceSelect={onResourceSelect} onResourceDiscover={onResourceDiscover} milestones={milestones} onMilestoneSourceSelect={onMilestoneSourceSelect} />
    <AgentActivity steps={agentSteps} provenance={provenance} />
    <NegotiationPaymentState state={paymentState} terms={terms} offers={negotiationOffers} currentRole={currentRole} onOfferDecision={onOfferDecision} onPrimaryAction={onPaymentAction} primaryActionLabel={paymentActionLabel} />
    <ExceptionInbox items={exceptions} onAction={onExceptionAction} onReject={onExceptionReject} />
  </div>;
}
