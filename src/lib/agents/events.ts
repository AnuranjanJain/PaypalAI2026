import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentName } from "./contracts";

type AgentEventInput = {
  pactId: string;
  aggregateType: "pact" | "milestone" | "submission" | "payment" | "scope_change" | "dispute" | "negotiation";
  aggregateId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  correlationId?: string;
  idempotencyKey?: string;
  agents?: AgentName[];
};

const defaultAgents: Record<string, AgentName[]> = {
  "pact.created": ["progress"],
  "pact.activated": ["progress", "scope_shield"],
  "evidence.submitted": ["progress", "scope_shield", "dispute_shield"],
  "verification.recorded": ["progress", "scope_shield", "dispute_shield"],
  "submission.approved": ["progress"],
  "submission.revision_requested": ["progress", "scope_shield"],
  "payment.order_created": ["progress", "dispute_shield"],
  "payment.captured": ["progress", "dispute_shield"],
  "payment.payout_pending": ["progress", "dispute_shield"],
  "payment.paid": ["progress"],
  "payment.failed": ["progress", "dispute_shield"],
  "scope.change_requested": ["scope_shield", "negotiation"],
  "dispute.opened": ["dispute_shield", "negotiation"],
  "negotiation.started": ["negotiation"],
  "negotiation.offer_created": ["negotiation"],
};

/**
 * Emit an immutable event and enqueue the relevant agents. Missing migrations
 * are intentionally ignored so existing authenticated Pacts remain usable
 * while a Supabase project is being upgraded.
 */
export async function emitPactAgentEvent(supabase: SupabaseClient, input: AgentEventInput) {
  const { data: eventId, error } = await supabase.rpc("record_pact_event", {
    target_pact: input.pactId,
    target_event_type: input.eventType,
    target_aggregate_type: input.aggregateType,
    target_aggregate_id: input.aggregateId,
    target_payload: input.payload ?? {},
    target_actor_type: "system",
    target_correlation_id: input.correlationId ?? null,
    target_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error || typeof eventId !== "string") return { eventId: null, enqueued: 0 };

  const agents = input.agents ?? defaultAgents[input.eventType] ?? [];
  let enqueued = 0;
  for (const agent of agents) {
    const { error: enqueueError } = await supabase.rpc("enqueue_agent_run", {
      target_event_id: eventId,
      target_agent: agent,
      target_input_snapshot: input.payload ?? {},
      target_max_attempts: agent === "dispute_shield" || agent === "negotiation" ? 2 : 3,
    });
    if (!enqueueError) enqueued += 1;
  }
  return { eventId, enqueued };
}
