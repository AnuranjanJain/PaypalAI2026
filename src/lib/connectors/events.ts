import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { asString, parseGitHubResourceFilters, type ConnectorConnection, type NormalizedConnectorEvent } from "./types.ts";

type RecordedEvent = { id: string; duplicate: boolean };

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") return value.length > 20_000 ? `${value.slice(0, 20_000)}...[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitizePayload(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    const lower = key.toLowerCase();
    return [key, ["passcode", "access_token", "refresh_token", "client_secret", "webhook_secret"].includes(lower) ? "[redacted]" : sanitizePayload(item, depth + 1)];
  }));
}

function eventRow(connection: ConnectorConnection, event: NormalizedConnectorEvent, rawPayload: unknown) {
  return {
    connection_id: connection.id,
    pact_id: connection.pact_id,
    provider: connection.provider,
    event_key: event.eventKey,
    external_id: event.externalId,
    event_type: event.eventType,
    occurred_at: event.occurredAt,
    actor: event.actor,
    resource_id: event.resourceId,
    source_url: event.sourceUrl,
    normalized: { ...event.snapshot, summary: event.summary },
    raw_payload: sanitizePayload(rawPayload),
  };
}

function mappingMatches(event: NormalizedConnectorEvent, filters: unknown): boolean {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return true;
  const candidate = filters as Record<string, unknown>;
  if (Array.isArray(candidate.eventTypes) && candidate.eventTypes.every((item) => typeof item === "string") && !candidate.eventTypes.includes(event.eventType)) return false;
  if (typeof candidate.resourceId === "string" && candidate.resourceId !== event.resourceId) return false;
  const snapshot = event.snapshot;
  const matches = (key: string, snapshotKeys: string[]) => {
    const expected = candidate[key];
    if (typeof expected !== "string" || expected.trim() === "") return true;
    const normalizedExpected = (key === "pullRequest" ? expected.trim().replace(/^#/, "") : expected.trim()).toLowerCase();
    return snapshotKeys.some((snapshotKey) => {
      const actual = String(snapshot[snapshotKey] ?? "").toLowerCase();
      return actual === normalizedExpected || (key === "branch" && actual.endsWith(`/${normalizedExpected}`));
    });
  };
  if (!matches("branch", ["ref", "branch"])) return false;
  if (!matches("pullRequest", ["number", "pullRequest", "pullRequestNumber"])) return false;
  if (!matches("workflow", ["name", "workflow", "workflowName"])) return false;
  if (!matches("versionId", ["versionId", "version"])) return false;
  if (!matches("pageId", ["pageId", "page"])) return false;
  if (!matches("frameId", ["frameId", "frame"])) return false;
  if (!matches("nodeId", ["nodeId", "node"])) return false;
  return true;
}

function normalizedBranch(value: string): string {
  return value.replace(/^refs\/heads\//, "");
}

function pullRequestStates(event: NormalizedConnectorEvent): Set<string> {
  const states = new Set<string>();
  const snapshot = event.snapshot;
  const state = asString(snapshot.state)?.toLowerCase();
  const action = asString(snapshot.action)?.toLowerCase();
  if (state) states.add(state);
  if (action === "opened" || action === "reopened") states.add("open");
  if (action === "closed") states.add("closed");
  if (snapshot.merged === true) {
    states.add("merged");
    states.add("closed");
  }
  return states;
}

function connectionFiltersMatch(connection: ConnectorConnection, event: NormalizedConnectorEvent): boolean {
  if (connection.provider !== "github" || !connection.resource_filters || typeof connection.resource_filters !== "object") return true;
  const filters = parseGitHubResourceFilters(connection.resource_filters);
  if (!filters) return true;
  if (event.eventType === "push" && filters.branch) {
    const ref = asString(event.snapshot.ref);
    if (!ref || normalizedBranch(ref) !== normalizedBranch(filters.branch)) return false;
  }
  if (event.eventType === "pull_request" && filters.pullRequestStates?.length) {
    const states = pullRequestStates(event);
    if (!filters.pullRequestStates.includes("all") && !filters.pullRequestStates.some((state) => states.has(state))) return false;
  }
  if (event.eventType === "workflow_run") {
    const workflowName = asString(event.snapshot.name);
    if (filters.workflowNames?.length && (!workflowName || !filters.workflowNames.includes(workflowName))) return false;
    const conclusion = asString(event.snapshot.conclusion)?.toLowerCase();
    if (filters.workflowConclusions?.length && (!conclusion || !filters.workflowConclusions.includes(conclusion))) return false;
  }
  return true;
}

export async function recordConnectorEvent(admin: SupabaseClient, connection: ConnectorConnection, event: NormalizedConnectorEvent, rawPayload: unknown): Promise<RecordedEvent> {
  if (connection.resource_id && event.resourceId && connection.resource_id !== event.resourceId) {
    throw new Error("Connector event resource does not match the selected Pact resource.");
  }
  let eventId: string | null = null;
  let duplicate = false;
  const existing = await admin.from("connector_events").select("id").eq("connection_id", connection.id).eq("event_key", event.eventKey).maybeSingle();
  if (existing.data?.id) {
    eventId = existing.data.id as string;
    duplicate = true;
  } else {
    const { data, error } = await admin.from("connector_events").insert(eventRow(connection, event, rawPayload)).select("id").single();
    if (error?.code === "23505") {
      const raced = await admin.from("connector_events").select("id").eq("connection_id", connection.id).eq("event_key", event.eventKey).maybeSingle();
      if (raced.data?.id) {
        eventId = raced.data.id as string;
        duplicate = true;
      }
    } else if (!error && data?.id) {
      eventId = data.id as string;
    }
  }
  if (!eventId) throw new Error("Connector event could not be recorded.");

  const { data: mappings, error: mappingsError } = await admin.from("pact_milestone_source_mappings")
    .select("milestone_id, filters")
    .eq("pact_id", connection.pact_id)
    .eq("connection_id", connection.id)
    .eq("enabled", true);
  if (mappingsError) throw new Error("Connector milestone mappings could not be loaded.");
  const matchingMappings = (mappings ?? []).filter((mapping) => connectionFiltersMatch(connection, event) && mappingMatches(event, mapping.filters));
  if (matchingMappings.length) {
    const evidenceRows = matchingMappings.map((mapping) => ({
      pact_id: connection.pact_id,
      milestone_id: mapping.milestone_id,
      connection_id: connection.id,
      event_id: eventId,
      evidence_type: `${connection.provider}:${event.eventType}`,
      evidence_text: event.summary,
      source_url: event.sourceUrl,
      snapshot: { ...event.snapshot, filters: mapping.filters ?? {} },
    }));
    if (evidenceRows.length) {
      const { error: evidenceError } = await admin.from("connector_evidence").upsert(evidenceRows, { onConflict: "event_id,milestone_id", ignoreDuplicates: true });
      if (evidenceError) throw new Error("Connector evidence could not be recorded.");
    }
  }
  const { data: pactEventId, error: pactEventError } = await admin.rpc("record_pact_event", {
    target_pact: connection.pact_id,
    target_event_type: "connector.evidence_received",
    target_aggregate_type: "pact",
    target_aggregate_id: connection.pact_id,
    target_payload: {
      connectorEventId: eventId,
      provider: connection.provider,
      eventType: event.eventType,
      sourceUrl: event.sourceUrl,
      summary: event.summary,
      mappedMilestones: matchingMappings.map((mapping) => mapping.milestone_id),
    },
    target_actor_type: "system",
    target_idempotency_key: `connector:${createHash("sha256").update(`${connection.id}:${event.eventKey}`).digest("hex")}`,
  });
  if (pactEventError || typeof pactEventId !== "string") throw new Error("Connector audit event could not be recorded.");
  if (typeof pactEventId === "string") {
    for (const agent of ["progress", "scope_shield", "dispute_shield"] as const) {
      const { error: enqueueError } = await admin.rpc("enqueue_agent_run", {
        target_event_id: pactEventId,
        target_agent: agent,
        target_input_snapshot: {
          connectorEventId: eventId,
          provider: connection.provider,
          eventType: event.eventType,
          summary: event.summary,
          snapshot: event.snapshot,
          milestoneIds: matchingMappings.map((mapping) => mapping.milestone_id),
        },
        target_max_attempts: 3,
      });
      if (enqueueError) throw new Error("Connector agent run could not be queued.");
    }
  }
  const { error: processingError } = await admin.from("connector_events").update({
    processing_status: "processed",
    processing_error: null,
  }).eq("id", eventId);
  if (processingError) throw new Error("Connector event processing status could not be updated.");
  return { id: eventId, duplicate };
}
