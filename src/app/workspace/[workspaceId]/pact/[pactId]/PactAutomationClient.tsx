"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PactAutomationSurfaces,
  type AgentActivityStep,
  type Connector,
  type ConnectorActionState,
  type ConnectorResource,
  type PactException,
  type PaymentState,
  type ProvenanceItem,
  type ConnectorMilestone,
  type ConnectorScope,
  type ConnectorDiscovery,
  type NegotiationOffer,
} from "@/components/pact/PactAutomationSurfaces";

type ConnectionRow = {
  id: string;
  provider: "github" | "figma";
  connected_by: string;
  external_account_name: string | null;
  resource_id: string | null;
  resource_name: string | null;
  resource_url: string | null;
  status: string;
  last_error: string | null;
};

type AgentRow = {
  id: string;
  agent_name: string;
  status: "queued" | "running" | "succeeded" | "failed" | "blocked";
  output_mode: string | null;
  created_at: string;
  updated_at: string;
  provider: string | null;
  model: string | null;
  error_message: string | null;
};

type EventRow = {
  id: string;
  provider: "github" | "figma";
  event_type: string;
  source_url: string | null;
  occurred_at: string | null;
  created_at: string;
};

type ScopeRow = { id: string; title: string; description: string; severity: string; status: string; created_at: string; amount_delta_cents: number };
type DisputeRow = { id: string; category: string; statement: string; status: string; risk_score: number | null; created_at: string };
type ActionRow = { id: string; action_type: string; target_type: string; status: string; proposal: Record<string, unknown>; created_at: string };
type PaymentRow = { milestone_id: string; paypal_order_id: string; status: string; payout_status: string | null; amount_cents: number };
type MilestoneRow = { id: string; title: string; amount_cents: number; status: string };
type SourceMappingRow = { milestone_id: string; connection_id: string; enabled: boolean };
type NegotiationOfferRow = {
  id: string;
  session_id: string;
  terms: Record<string, unknown>;
  rationale: string;
  status: "proposed" | "countered" | "accepted" | "rejected" | "expired";
  accepted_by_owner: string | null;
  accepted_by_provider: string | null;
  created_at: string;
};

const agentLabels: Record<string, string> = {
  progress: "Progress Agent",
  scope_shield: "ScopeShield",
  dispute_shield: "DisputeShield",
  negotiation: "Negotiation Agent",
};

function connectorState(row?: ConnectionRow): Connector["state"] {
  if (!row) return "needs_auth";
  if (row.status === "active" || row.status === "awaiting_resource") return "connected";
  if (row.status === "degraded" || row.status === "disconnected") return "error";
  return "needs_auth";
}

function agentStatus(row?: AgentRow): AgentActivityStep["status"] {
  if (!row) return "pending";
  if (row.status === "succeeded") return "complete";
  if (row.status === "running") return "running";
  if (row.status === "failed" || row.status === "blocked") return "blocked";
  return "pending";
}

function relativeTime(value?: string | null) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return undefined;
  const minutes = Math.max(0, Math.round((Date.now() - date.valueOf()) / 60000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

function paymentState(milestones: MilestoneRow[], events: PaymentRow[], isOwner: boolean): PaymentState {
  const event = events[0];
  const milestone = milestones.find((item) => item.id === event?.milestone_id) ?? milestones[0];
  const amountCents = event?.amount_cents ?? milestone?.amount_cents ?? 0;
  if (!event) return { stage: isOwner ? "awaiting_owner_approval" : "policy_review", amountCents, ownerApproved: milestone?.status === "approved", payout: "not_requested" };
  const captured = ["captured", "payout_pending", "paid_to_provider"].includes(event.status);
  const stage = event.status === "paid_to_provider" ? "paid_to_provider" : event.status === "payout_pending" ? "payout_pending" : event.status === "captured" ? "captured" : event.status === "failed" ? "failed" : "awaiting_buyer_approval";
  const payout = event.payout_status === "paid_to_provider" ? "paid" : event.payout_status === "payout_pending" ? "pending" : event.payout_status === "failed" ? "failed" : "not_requested";
  return { stage, amountCents, ownerApproved: milestone?.status === "approved", buyerApproved: captured, payout, orderId: event.paypal_order_id };
}

export default function PactAutomationClient({
  workspaceId,
  pactId,
  currentUserId,
  isOwner,
  connections,
  agentRuns,
  connectorEvents,
  scopeChanges,
  disputes,
  agentActions,
  paymentEvents,
  milestones,
  sourceMappings,
  negotiationOffers,
  storageWarning,
}: {
  workspaceId: string;
  pactId: string;
  currentUserId: string;
  isOwner: boolean;
  connections: ConnectionRow[];
  agentRuns: AgentRow[];
  connectorEvents: EventRow[];
  scopeChanges: ScopeRow[];
  disputes: DisputeRow[];
  agentActions: ActionRow[];
  paymentEvents: PaymentRow[];
  milestones: MilestoneRow[];
  sourceMappings: SourceMappingRow[];
  negotiationOffers: NegotiationOfferRow[];
  storageWarning?: string;
}) {
  const router = useRouter();
  const [resourceLists, setResourceLists] = useState<Record<string, ConnectorResource[]>>({});
  const [connectorActions, setConnectorActions] = useState<Record<string, ConnectorActionState>>(() => Object.fromEntries(
    connections.filter((connection) => connection.status !== "disconnected").map((connection) => [connection.id, { status: "loading", message: "Loading resources…" }]),
  ));
  function setConnectorAction(connectionId: string, actionState: ConnectorActionState) {
    setConnectorActions((current) => ({ ...current, [connectionId]: actionState }));
  }
  useEffect(() => {
    let active = true;
    for (const connection of connections) {
      if (connection.status === "disconnected") continue;
      fetch(`/api/connectors/${connection.provider}/${connection.id}/resource`)
        .then(async (response) => {
          const payload = await response.json().catch(() => ({})) as { resources?: ConnectorResource[]; error?: string };
          if (!response.ok) throw new Error(payload.error ?? "Resources could not be loaded.");
          if (!active) return;
          setResourceLists((current) => ({ ...current, [connection.id]: payload.resources ?? [] }));
          setConnectorAction(connection.id, {
            status: "success",
            message: payload.resources?.length ? `${payload.resources.length} resource${payload.resources.length === 1 ? "" : "s"} loaded.` : "No private resources found. Enter a resource key to attach one manually.",
          });
        })
        .catch((error) => {
          if (!active) return;
          setConnectorAction(connection.id, { status: "error", message: error instanceof Error ? error.message : "Resources could not be loaded." });
        });
    }
    return () => { active = false; };
  }, [connections]);
  const connectors: Connector[] = (["github", "figma"] as const).flatMap((provider) => {
    const providerConnections = connections.filter((item) => item.provider === provider);
    const visibleConnections: Array<ConnectionRow | null> = providerConnections.length > 0 ? [...providerConnections] : [null];
    if (!providerConnections.some((item) => item.connected_by === currentUserId)) visibleConnections.push(null);
    return visibleConnections.map((connection, index) => {
      const connectorKey = connection?.id ?? `${provider}-new-${index}`;
      const participantLabel = connection ? (connection.connected_by === currentUserId ? "Your account" : "Other participant") : "Your account";
      return {
      id: provider,
      connectionId: connection?.id,
      name: provider === "github" ? "GitHub" : "Figma",
      description: provider === "github" ? "Repository, pull request, and checks" : "File, version, and design nodes",
      state: connectorState(connection ?? undefined),
      accountLabel: connection ? `${connection.external_account_name ?? "Connected account"} · ${participantLabel}` : `${participantLabel} · connect a private source`,
      error: connection?.last_error ?? undefined,
      resources: resourceLists[connectorKey] ?? (connection?.resource_id ? [{ id: connection.resource_id, name: connection.resource_name ?? connection.resource_id, href: connection.resource_url ?? undefined, detail: connection.resource_url ?? "Attached to this Pact." }] : []),
      selectedResourceId: connection?.resource_id,
      actionState: connection ? connectorActions[connection.id] : undefined,
    } satisfies Connector;
    });
  });

  const latestRuns = new Map<string, AgentRow>();
  for (const run of agentRuns) if (!latestRuns.has(run.agent_name)) latestRuns.set(run.agent_name, run);
  const agentSteps: AgentActivityStep[] = (["progress", "scope_shield", "dispute_shield", "negotiation"] as const).map((name) => {
    const run = latestRuns.get(name);
    const detail = run?.output_mode === "deterministic-fallback" ? "Safe deterministic fallback" : run?.provider ? `${run.provider}${run.model ? ` · ${run.model}` : ""}` : run?.error_message ?? "Waiting for an event";
    return { id: name, label: agentLabels[name], detail, status: agentStatus(run), timestamp: relativeTime(run?.updated_at ?? run?.created_at) };
  });

  const provenance: ProvenanceItem[] = connectorEvents.slice(0, 8).map((event) => ({ id: event.id, source: `${event.provider === "github" ? "GitHub" : "Figma"} · ${event.event_type}`, reference: event.source_url ?? undefined, observedAt: relativeTime(event.occurred_at ?? event.created_at), href: event.source_url ?? undefined }));
  const exceptions: PactException[] = [
    ...agentActions.filter((item) => item.status === "proposed").map((item) => ({
      id: `action-${item.id}`,
      actionId: item.id,
      title: item.action_type.replaceAll("_", " "),
      detail: typeof item.proposal.summary === "string" ? item.proposal.summary : "An AI proposal needs an owner decision before it can affect the Pact.",
      severity: "high" as const,
      category: item.target_type === "scope_change" ? "scope" as const : item.target_type === "payment" ? "payment" as const : "evidence" as const,
      createdAt: relativeTime(item.created_at),
      actionLabel: "Decide proposal",
    })),
    ...scopeChanges.filter((item) => !["accepted", "rejected", "withdrawn", "implemented"].includes(item.status)).map((item) => {
      const severity: PactException["severity"] = item.severity === "critical" || item.severity === "high" ? "high" : item.severity === "medium" ? "medium" : "low";
      return { id: `scope-${item.id}`, title: item.title, detail: item.description, severity, category: "scope" as const, amountCents: Math.abs(item.amount_delta_cents), createdAt: relativeTime(item.created_at), actionLabel: "Review change order" };
    }),
    ...disputes.filter((item) => !["resolved", "dismissed"].includes(item.status)).map((item) => {
      const severity: PactException["severity"] = (item.risk_score ?? 0) >= 0.7 ? "high" : (item.risk_score ?? 0) >= 0.4 ? "medium" : "low";
      return { id: `dispute-${item.id}`, actionId: `dispute-${item.id}`, title: `${item.category} dispute`, detail: item.statement, severity, category: "evidence" as const, createdAt: relativeTime(item.created_at), actionLabel: "Resolve dispute" };
    }),
  ];
  const payment = paymentState(milestones, paymentEvents, isOwner);
  const offers: NegotiationOffer[] = negotiationOffers.map((offer) => {
    const terms = offer.terms && typeof offer.terms === "object" && !Array.isArray(offer.terms) ? offer.terms : {};
    const deliverables = Array.isArray(terms.deliverables) ? terms.deliverables.filter((item): item is string => typeof item === "string") : [];
    const amountDeltaCents = typeof terms.amountDeltaCents === "number" && Number.isInteger(terms.amountDeltaCents) ? terms.amountDeltaCents : 0;
    const scheduleDeltaDays = typeof terms.scheduleDeltaDays === "number" && Number.isInteger(terms.scheduleDeltaDays) ? terms.scheduleDeltaDays : 0;
    return {
      id: offer.id,
      sessionId: offer.session_id,
      deliverables,
      amountDeltaCents,
      scheduleDeltaDays,
      rationale: offer.rationale,
      status: offer.status,
      ownerAccepted: Boolean(offer.accepted_by_owner),
      providerAccepted: Boolean(offer.accepted_by_provider),
      createdAt: relativeTime(offer.created_at),
    };
  });

  function configure(connector: Connector) {
    const startUrl = `/api/connectors/${connector.id}/start?pactId=${encodeURIComponent(pactId)}&returnPath=${encodeURIComponent(`/workspace/${workspaceId}/pact/${pactId}`)}`;
    window.location.assign(new URL(startUrl, window.location.origin).toString());
  }

  async function selectResource(connector: Connector, resourceId: string) {
    if (!connector.connectionId) return;
    const connectionId = connector.connectionId;
    setConnectorAction(connectionId, { status: "loading", message: "Attaching resource…" });
    try {
      const response = await fetch(`/api/connectors/${connector.id}/${connectionId}/resource`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceId, pactId }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "This resource could not be attached.");
      setConnectorAction(connectionId, { status: "success", message: "Resource attached. Refreshing Pact sources…" });
      router.refresh();
    } catch (error) {
      setConnectorAction(connectionId, { status: "error", message: error instanceof Error ? error.message : "This resource could not be attached." });
    }
  }

  async function discoverResources(connector: Connector, discovery: ConnectorDiscovery) {
    if (!connector.connectionId) return;
    const connectionId = connector.connectionId;
    setConnectorAction(connectionId, { status: "loading", message: "Loading private files…" });
    const params = new URLSearchParams();
    if (discovery.teamId?.trim()) params.set("teamId", discovery.teamId.trim());
    if (discovery.projectId?.trim()) params.set("projectId", discovery.projectId.trim());
    try {
      const response = await fetch(`/api/connectors/${connector.id}/${connectionId}/resource${params.size ? `?${params}` : ""}`);
      const payload = await response.json().catch(() => ({})) as { resources?: Array<ConnectorResource & { url?: string }>; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Private resources could not be loaded.");
      const resources = (payload.resources ?? []).map((resource) => ({ ...resource, href: resource.href ?? resource.url }));
      setResourceLists((current) => ({ ...current, [connectionId]: resources }));
      setConnectorAction(connectionId, { status: "success", message: resources.length ? `${resources.length} private resource${resources.length === 1 ? "" : "s"} loaded.` : "No matching private resources found. Try another scope or attach a resource key." });
    } catch (error) {
      setConnectorAction(connectionId, { status: "error", message: error instanceof Error ? error.message : "Private resources could not be loaded." });
    }
  }

  async function mapMilestoneSource(connector: Connector, milestoneId: string, scope: ConnectorScope) {
    if (!connector.connectionId) return;
    const connectionId = connector.connectionId;
    setConnectorAction(connectionId, { status: "loading", message: "Mapping source to milestone…" });
    try {
      const response = await fetch("/api/connectors/milestone-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pactId, milestoneId, connectionId, filters: scope }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The milestone source could not be saved.");
      setConnectorAction(connectionId, { status: "success", message: "Milestone evidence source saved." });
      router.refresh();
    } catch (error) {
      setConnectorAction(connectionId, { status: "error", message: error instanceof Error ? error.message : "The milestone source could not be saved." });
    }
  }

  async function decideException(item: PactException, decision: "approved" | "rejected"): Promise<void> {
    if (!item.actionId) return;
    if (item.actionId.startsWith("dispute-")) {
      const disputeId = item.actionId.slice("dispute-".length);
      const resolutionNote = window.prompt(decision === "approved" ? "Explain why this dispute is resolved." : "Explain why this dispute is dismissed.");
      if (!resolutionNote?.trim()) return;
      const response = await fetch("/api/pact/disputes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disputeId, status: decision === "approved" ? "resolved" : "dismissed", resolutionType: "owner_review", resolutionNote }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "The dispute decision could not be saved.");
      }
      router.refresh();
      return;
    }
    const response = await fetch("/api/agents/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actionId: item.actionId, decision }) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error ?? "The proposal decision could not be saved.");
    }
    router.refresh();
  }

  async function decideOffer(offer: NegotiationOffer, decision: "accepted" | "rejected"): Promise<void> {
    const response = await fetch(`/api/pact/negotiation/offers/${offer.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error ?? "The offer decision could not be saved.");
    }
    router.refresh();
  }

  const milestoneOptions: ConnectorMilestone[] = milestones.map((milestone) => ({ id: milestone.id, title: milestone.title, sourceConnectionId: sourceMappings.find((mapping) => mapping.milestone_id === milestone.id && mapping.enabled)?.connection_id ?? null }));

  return <>
    {storageWarning && <p className="pact-automation-storage-warning" role="status">{storageWarning}</p>}
    <PactAutomationSurfaces connectors={connectors} agentSteps={agentSteps} provenance={provenance} exceptions={exceptions} paymentState={payment} milestones={milestoneOptions} negotiationOffers={offers} currentRole={isOwner ? "owner" : "provider"} onConfigureConnector={configure} onResourceSelect={selectResource} onResourceDiscover={discoverResources} onMilestoneSourceSelect={mapMilestoneSource} onOfferDecision={decideOffer} onExceptionAction={isOwner ? (item) => decideException(item, "approved") : undefined} onExceptionReject={isOwner ? (item) => decideException(item, "rejected") : undefined} />
  </>;
}
