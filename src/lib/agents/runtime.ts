import { createClient as createServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicFallback } from "./fallbacks.ts";
import { runMuseStructured } from "./muse.ts";
import { sanitizeAgentContext, type AgentContext, type AgentName, type AgentOutput, type AgentRun } from "./contracts.ts";
import { createAutopilotOrder } from "./payment";
import { createAgentAdminClient } from "./supabase-admin";

type RuntimeClient = SupabaseClient;

type EnqueueInput = {
  pactId: string;
  aggregateType: "pact" | "milestone" | "submission" | "payment" | "scope_change" | "dispute" | "negotiation";
  aggregateId: string;
  eventType: string;
  payload?: AgentContext;
  agents: AgentName[];
  correlationId?: string;
  idempotencyKey?: string;
};

export type AgentExecutionResult = {
  runId: string;
  status: "succeeded" | "failed" | "blocked" | "skipped";
  mode?: "ai-provider" | "deterministic-fallback" | "blocked";
  output?: AgentOutput;
  error?: string;
};

function objectValue(value: unknown): AgentContext {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AgentContext : {};
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function contextId(context: AgentContext, key: string, nestedKey: string): string | null {
  return uuid(context[key] ?? objectValue(context[nestedKey]).id);
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message.length <= 300 ? error.message : "Agent execution failed.";
}

async function clientOrServer(client?: RuntimeClient): Promise<RuntimeClient> {
  return client ?? await createServerClient();
}

async function ensureNegotiationSession(supabase: RuntimeClient, run: AgentRun, context: AgentContext): Promise<string | null> {
  const disputeId = contextId(context, "disputeId", "dispute");
  const scopeChangeId = contextId(context, "scopeChangeId", "scopeChange");
  if (!disputeId && !scopeChangeId) return null;

  let existingQuery = supabase.from("negotiation_sessions").select("id")
    .eq("pact_id", run.pactId).eq("status", "open").order("created_at", { ascending: false }).limit(1);
  existingQuery = disputeId ? existingQuery.eq("dispute_id", disputeId) : existingQuery.eq("scope_change_order_id", scopeChangeId as string);
  const { data: existing } = await existingQuery.maybeSingle();
  const existingId = uuid(existing?.id);
  if (existingId) return existingId;

  const { data: owner } = await supabase.from("workspace_members").select("user_id")
    .eq("workspace_id", run.workspaceId).eq("role", "owner").limit(1).maybeSingle();
  if (!owner?.user_id) throw new Error("Negotiation session owner could not be resolved.");
  let initiatedBy = owner.user_id;
  if (disputeId) {
    const { data: dispute } = await supabase.from("disputes").select("opened_by")
      .eq("id", disputeId).eq("pact_id", run.pactId).maybeSingle();
    const openedBy = dispute?.opened_by;
    const openedById = uuid(openedBy);
    if (openedById) initiatedBy = openedById;
  }
  const { data: created, error } = await supabase.from("negotiation_sessions").insert({
    workspace_id: run.workspaceId,
    pact_id: run.pactId,
    dispute_id: disputeId,
    scope_change_order_id: scopeChangeId,
    initiated_by: initiatedBy,
    status: "open",
    round: 0,
  }).select("id").single();
  if (error) throw new Error("Negotiation session could not be created.");
  return uuid(created?.id);
}

export async function enqueueAgentRuns(input: EnqueueInput, client?: RuntimeClient): Promise<{ eventId: string; runIds: string[] }> {
  const supabase = await clientOrServer(client);
  const safePayload = objectValue(sanitizeAgentContext(input.payload ?? {}));
  const { data: eventId, error: eventError } = await supabase.rpc("record_pact_event", {
    target_pact: input.pactId,
    target_event_type: input.eventType,
    target_aggregate_type: input.aggregateType,
    target_aggregate_id: input.aggregateId,
    target_payload: safePayload,
    target_actor_type: "system",
    target_correlation_id: input.correlationId ?? null,
    target_idempotency_key: input.idempotencyKey ?? null,
  });
  if (eventError || typeof eventId !== "string") throw new Error(eventError?.message ?? "Pact event could not be recorded.");

  const runIds: string[] = [];
  for (const agent of [...new Set(input.agents)]) {
    const { data: runId, error: runError } = await supabase.rpc("enqueue_agent_run", {
      target_event_id: eventId,
      target_agent: agent,
      target_input_snapshot: safePayload,
      target_max_attempts: 3,
    });
    if (runError || typeof runId !== "string") throw new Error(runError?.message ?? `The ${agent} run could not be queued.`);
    runIds.push(runId);
  }
  return { eventId, runIds };
}

async function persistTypedOutput(supabase: RuntimeClient, run: AgentRun, output: AgentOutput): Promise<void> {
  const context = run.inputSnapshot;
  const milestoneId = contextId(context, "milestoneId", "milestone");
  const submissionId = contextId(context, "submissionId", "submission");
  if (run.agentName === "progress") {
    const progress = output as Extract<AgentOutput, { state: string }>;
    const { error } = await supabase.from("progress_snapshots").upsert({
      workspace_id: run.workspaceId,
      pact_id: run.pactId,
      milestone_id: milestoneId,
      submission_id: submissionId,
      run_id: run.id,
      state: progress.state,
      percent: progress.percent,
      confidence: progress.confidence,
      blockers: progress.blockers,
      next_actions: progress.nextActions,
      forecast_due_at: progress.forecastDueAt,
      evidence_refs: progress.evidenceRefs,
      summary: progress.summary,
    }, { onConflict: "run_id" });
    if (error) throw new Error("Progress snapshot could not be persisted.");
    return;
  }

  if (run.agentName === "scope_shield") {
    const scope = output as Extract<AgentOutput, { inScope: boolean }>;
    if (scope.inScope) return;
    const { data, error } = await supabase.from("scope_change_orders").upsert({
      workspace_id: run.workspaceId,
      pact_id: run.pactId,
      milestone_id: milestoneId,
      submission_id: submissionId,
      run_id: run.id,
      title: scope.changedItems[0] ?? "Scope change detected",
      description: scope.rationale,
      baseline_scope: objectValue(context.baselineScope),
      requested_scope: objectValue(context.requestedScope),
      amount_delta_cents: scope.amountDeltaCents,
      schedule_delta_days: scope.scheduleDeltaDays,
      severity: scope.severity,
      status: "pending_owner",
    }, { onConflict: "run_id" }).select("id").maybeSingle();
    if (error) throw new Error("Scope change order could not be persisted.");
    const scopeChangeId = uuid(data?.id);
    if (scope.recommendedAction !== "none" && scopeChangeId) {
      await persistAction(supabase, run, "scope_change_review", scopeChangeId, output);
      const sessionId = await ensureNegotiationSession(supabase, run, { scopeChangeId, milestoneId, submissionId });
      const { data: eventId, error: eventError } = await supabase.rpc("record_pact_event", {
        target_pact: run.pactId,
        target_event_type: "scope.change_requested",
        target_aggregate_type: "scope_change",
        target_aggregate_id: scopeChangeId,
        target_payload: { scopeChangeId, milestoneId, submissionId, sessionId, source: "scope_shield" },
        target_actor_type: "worker",
        target_idempotency_key: `scope.change_requested:${run.id}`,
      });
      if (eventError || typeof eventId !== "string") throw new Error("Scope change negotiation event could not be recorded.");
      const { error: enqueueError } = await supabase.rpc("enqueue_agent_run", {
        target_event_id: eventId,
        target_agent: "negotiation",
        target_input_snapshot: { scopeChangeId, milestoneId, submissionId, sessionId, source: "scope_shield" },
        target_max_attempts: 2,
      });
      if (enqueueError) throw new Error("Negotiation agent could not be queued.");
    }
    return;
  }

  if (run.agentName === "dispute_shield") {
    const dispute = output as Extract<AgentOutput, { riskScore: number }>;
    const disputeId = contextId(context, "disputeId", "dispute");
    if (disputeId) {
      const { error } = await supabase.from("disputes").update({ category: dispute.category, risk_score: dispute.riskScore, updated_at: new Date().toISOString() }).eq("id", disputeId).eq("pact_id", run.pactId);
      if (error) throw new Error("Dispute assessment could not be persisted.");
    }
    if (dispute.paymentHold || dispute.recommendedResolution !== "close_as_unfounded") await persistAction(supabase, run, "dispute_review", disputeId, output);
    return;
  }

  const negotiation = output as Extract<AgentOutput, { terms: { deliverables: string[] } }>;
  const sessionId = contextId(context, "sessionId", "session") ?? await ensureNegotiationSession(supabase, run, context);
  let offerId: string | null = null;
  if (sessionId) {
    const { data, error } = await supabase.from("negotiation_offers").upsert({
      workspace_id: run.workspaceId,
      pact_id: run.pactId,
      session_id: sessionId,
      run_id: run.id,
      proposed_by: null,
      terms: negotiation.terms,
      rationale: negotiation.rationale,
      status: "proposed",
    }, { onConflict: "run_id" }).select("id").maybeSingle();
    if (error) throw new Error("Negotiation offer could not be persisted.");
    offerId = uuid(data?.id);
  }
  await persistAction(supabase, run, "negotiation_offer_review", offerId, output);
}

async function persistAction(supabase: RuntimeClient, run: AgentRun, actionType: string, targetId: string | null, proposal: AgentOutput): Promise<void> {
  const { error } = await supabase.from("agent_actions").insert({
    workspace_id: run.workspaceId,
    pact_id: run.pactId,
    run_id: run.id,
    action_type: actionType,
    target_type: actionType.startsWith("scope") ? "scope_change" : actionType.startsWith("dispute") ? "dispute" : "negotiation",
    target_id: targetId,
    proposal,
    status: "proposed",
    requires_human: true,
  });
  if (error && !String(error.message).toLowerCase().includes("duplicate")) throw new Error("Agent action could not be persisted.");
}

export async function executeAgentRun(runId: string, client?: RuntimeClient): Promise<AgentExecutionResult> {
  const supabase = await clientOrServer(client);
  const { data: claim, error: claimError } = await supabase.rpc("claim_agent_run", { target_run_id: runId, target_lease_seconds: 120 });
  const claimed = Array.isArray(claim) ? claim[0] : claim;
  if (claimError) return { runId, status: "failed", error: "Agent run could not be claimed." };
  if (!claimed) return { runId, status: "skipped" };

  const { data: row, error: rowError } = await supabase.from("agent_runs").select("id, pact_id, workspace_id, agent_name, status, attempt, input_snapshot").eq("id", runId).maybeSingle();
  if (rowError || !row) return { runId, status: "failed", error: "Agent run could not be loaded." };
  const run = { id: row.id, pactId: row.pact_id, workspaceId: row.workspace_id, agentName: row.agent_name as AgentName, status: row.status, attempt: row.attempt, inputSnapshot: objectValue(row.input_snapshot) } satisfies AgentRun;

  try {
    const muse = await runMuseStructured(run.agentName, run.inputSnapshot);
    const fallbackAllowed = run.agentName === "progress" || run.agentName === "scope_shield";
    if (!muse.value && !fallbackAllowed) {
      const { error: finishError } = await supabase.rpc("finish_agent_run", {
        target_run_id: run.id,
        target_status: "blocked",
        target_output: null,
        target_output_mode: "blocked",
        target_provider: muse.provider,
        target_model: muse.model,
        target_prompt_version: "agent-runtime-v1",
        target_provider_request_id: muse.requestId,
        target_validation_errors: muse.validationErrors,
        target_error_code: muse.errorCode ?? "provider_unavailable",
        target_error_message: muse.errorMessage ?? "Meta Muse is required for this agent.",
      });
      return finishError ? { runId, status: "failed", error: "Agent run could not be finalized." } : { runId, status: "blocked", mode: "blocked", error: muse.errorMessage ?? "Meta Muse is required for this agent." };
    }
    const output = muse.value ?? deterministicFallback(run.agentName, run.inputSnapshot);
    const mode = muse.value ? "ai-provider" : "deterministic-fallback";
    await persistTypedOutput(supabase, run, output);
    if (run.agentName === "progress" && muse.value && (output as Extract<AgentOutput, { state: string }>).state === "complete" && run.inputSnapshot.autoPayment === true) {
      const milestoneId = contextId(run.inputSnapshot, "milestoneId", "milestone");
      if (milestoneId) await createAutopilotOrder(createAgentAdminClient(), run.pactId, milestoneId);
    }
    const { error: finishError } = await supabase.rpc("finish_agent_run", {
      target_run_id: run.id,
      target_status: "succeeded",
      target_output: output,
      target_output_mode: mode,
      target_provider: muse.provider,
      target_model: muse.model,
      target_prompt_version: "agent-runtime-v1",
      target_provider_request_id: muse.requestId,
      target_validation_errors: muse.validationErrors,
      target_error_code: muse.value ? null : muse.errorCode,
      target_error_message: muse.value ? null : muse.errorMessage,
    });
    if (finishError) return { runId, status: "failed", error: "Agent run could not be finalized." };
    return { runId, status: "succeeded", mode, output };
  } catch (error) {
    const message = safeError(error);
    await supabase.rpc("finish_agent_run", { target_run_id: run.id, target_status: "failed", target_output_mode: "blocked", target_error_code: "runtime_failure", target_error_message: message });
    return { runId, status: "failed", error: message };
  }
}
