-- Durable, auditable foundation for the Pact agent runtime.
-- Agent output is advisory until a human approves an action through an RPC.

create table if not exists public.pact_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pact_id uuid not null references public.pacts(id) on delete cascade,
  aggregate_type text not null check (aggregate_type in ('pact', 'milestone', 'submission', 'payment', 'scope_change', 'dispute', 'negotiation')),
  aggregate_id uuid not null,
  event_type text not null check (length(trim(event_type)) between 3 and 120),
  actor_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'system' check (actor_type in ('owner', 'provider', 'system', 'worker')),
  payload jsonb not null default '{}'::jsonb,
  correlation_id text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, pact_id) references public.pacts(workspace_id, id) on delete cascade,
  check (idempotency_key is null or length(trim(idempotency_key)) between 1 and 160),
  check (jsonb_typeof(payload) = 'object')
);

create index if not exists pact_events_pact_created_idx
  on public.pact_events(pact_id, created_at desc);
create unique index if not exists pact_events_idempotency_idx
  on public.pact_events(pact_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pact_id uuid not null references public.pacts(id) on delete cascade,
  trigger_event_id uuid not null references public.pact_events(id) on delete cascade,
  agent_name text not null check (agent_name in ('progress', 'scope_shield', 'dispute_shield', 'negotiation')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'blocked')),
  attempt integer not null default 0 check (attempt >= 0 and attempt <= 10),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  lease_until timestamptz,
  input_snapshot jsonb not null default '{}'::jsonb,
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  output jsonb,
  output_mode text check (output_mode in ('ai-provider', 'deterministic-fallback', 'blocked')),
  provider text,
  model text,
  prompt_version text,
  provider_request_id text,
  validation_errors text[] not null default '{}',
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, pact_id) references public.pacts(workspace_id, id) on delete cascade,
  check (jsonb_typeof(input_snapshot) = 'object'),
  check (output is null or jsonb_typeof(output) = 'object')
);

create unique index if not exists agent_runs_event_agent_idx
  on public.agent_runs(trigger_event_id, agent_name);
create index if not exists agent_runs_queue_idx
  on public.agent_runs(status, created_at)
  where status in ('queued', 'running');

create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pact_id uuid not null references public.pacts(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  action_type text not null check (length(trim(action_type)) between 3 and 100),
  target_type text not null check (target_type in ('pact', 'milestone', 'submission', 'payment', 'scope_change', 'dispute', 'negotiation')),
  target_id uuid,
  proposal jsonb not null default '{}'::jsonb,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'applied', 'expired')),
  requires_human boolean not null default true,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, pact_id) references public.pacts(workspace_id, id) on delete cascade,
  check (jsonb_typeof(proposal) = 'object')
);

create unique index if not exists agent_actions_run_type_idx
  on public.agent_actions(run_id, action_type);
create index if not exists agent_actions_pact_status_idx
  on public.agent_actions(pact_id, status, created_at desc);

create table if not exists public.progress_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pact_id uuid not null references public.pacts(id) on delete cascade,
  milestone_id uuid references public.milestones(id) on delete cascade,
  submission_id uuid references public.pact_submissions(id) on delete set null,
  run_id uuid not null unique references public.agent_runs(id) on delete cascade,
  state text not null check (state in ('on_track', 'at_risk', 'blocked', 'complete')),
  percent numeric(5,2) not null check (percent >= 0 and percent <= 100),
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  blockers text[] not null default '{}',
  next_actions text[] not null default '{}',
  forecast_due_at timestamptz,
  evidence_refs jsonb not null default '[]'::jsonb,
  summary text not null check (length(trim(summary)) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, pact_id) references public.pacts(workspace_id, id) on delete cascade,
  check (jsonb_typeof(evidence_refs) = 'array')
);

create index if not exists progress_snapshots_latest_idx
  on public.progress_snapshots(pact_id, created_at desc);

create table if not exists public.scope_change_orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pact_id uuid not null references public.pacts(id) on delete cascade,
  milestone_id uuid references public.milestones(id) on delete set null,
  submission_id uuid references public.pact_submissions(id) on delete set null,
  run_id uuid not null unique references public.agent_runs(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null check (length(trim(description)) between 1 and 4000),
  baseline_scope jsonb not null default '{}'::jsonb,
  requested_scope jsonb not null default '{}'::jsonb,
  amount_delta_cents bigint not null default 0 check (amount_delta_cents between -100000000 and 100000000),
  schedule_delta_days integer not null default 0 check (schedule_delta_days between -3650 and 3650),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'pending_owner' check (status in ('draft', 'pending_owner', 'pending_provider', 'accepted', 'rejected', 'withdrawn', 'implemented')),
  owner_decision text check (owner_decision in ('accepted', 'rejected')),
  provider_decision text check (provider_decision in ('accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, pact_id) references public.pacts(workspace_id, id) on delete cascade,
  check (jsonb_typeof(baseline_scope) = 'object'),
  check (jsonb_typeof(requested_scope) = 'object')
);

create index if not exists scope_change_orders_pact_status_idx
  on public.scope_change_orders(pact_id, status, created_at desc);

create table if not exists public.disputes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pact_id uuid not null references public.pacts(id) on delete cascade,
  milestone_id uuid references public.milestones(id) on delete set null,
  submission_id uuid references public.pact_submissions(id) on delete set null,
  payment_event_id uuid references public.pact_payment_events(id) on delete set null,
  opened_by uuid not null references auth.users(id),
  category text not null check (category in ('scope', 'quality', 'delivery', 'payment', 'communication', 'other')),
  statement text not null check (length(trim(statement)) between 1 and 10000),
  status text not null default 'open' check (status in ('open', 'under_review', 'resolved', 'dismissed')),
  risk_score numeric(4,3) check (risk_score >= 0 and risk_score <= 1),
  resolution_type text,
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, pact_id) references public.pacts(workspace_id, id) on delete cascade
);

create index if not exists disputes_pact_status_idx
  on public.disputes(pact_id, status, created_at desc);

create table if not exists public.dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pact_id uuid not null references public.pacts(id) on delete cascade,
  dispute_id uuid not null references public.disputes(id) on delete cascade,
  source_type text not null check (source_type in ('submission', 'event', 'link', 'note')),
  source_id uuid,
  note text,
  link text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, pact_id) references public.pacts(workspace_id, id) on delete cascade,
  check (note is not null or link is not null)
);

create index if not exists dispute_evidence_dispute_idx
  on public.dispute_evidence(dispute_id, created_at);

create table if not exists public.negotiation_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pact_id uuid not null references public.pacts(id) on delete cascade,
  dispute_id uuid references public.disputes(id) on delete set null,
  scope_change_order_id uuid references public.scope_change_orders(id) on delete set null,
  initiated_by uuid not null references auth.users(id),
  status text not null default 'open' check (status in ('open', 'paused', 'accepted', 'rejected', 'closed')),
  round integer not null default 0 check (round >= 0 and round <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, pact_id) references public.pacts(workspace_id, id) on delete cascade,
  check (dispute_id is not null or scope_change_order_id is not null)
);

create index if not exists negotiation_sessions_pact_status_idx
  on public.negotiation_sessions(pact_id, status, created_at desc);

create table if not exists public.negotiation_offers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pact_id uuid not null references public.pacts(id) on delete cascade,
  session_id uuid not null references public.negotiation_sessions(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  proposed_by uuid references auth.users(id) on delete set null,
  terms jsonb not null default '{}'::jsonb,
  rationale text not null check (length(trim(rationale)) between 1 and 4000),
  status text not null default 'proposed' check (status in ('proposed', 'countered', 'accepted', 'rejected', 'expired')),
  accepted_by_owner uuid references auth.users(id) on delete set null,
  accepted_by_provider uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, pact_id) references public.pacts(workspace_id, id) on delete cascade,
  check (jsonb_typeof(terms) = 'object')
);

create index if not exists negotiation_offers_session_created_idx
  on public.negotiation_offers(session_id, created_at desc);
create unique index if not exists negotiation_offers_run_idx
  on public.negotiation_offers(run_id)
  where run_id is not null;

alter table public.pact_events enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_actions enable row level security;
alter table public.progress_snapshots enable row level security;
alter table public.scope_change_orders enable row level security;
alter table public.disputes enable row level security;
alter table public.dispute_evidence enable row level security;
alter table public.negotiation_sessions enable row level security;
alter table public.negotiation_offers enable row level security;

create policy "Pact participants can view agent events"
  on public.pact_events for select to authenticated
  using (public.can_access_pact(pact_id));
create policy "Pact participants can view agent runs"
  on public.agent_runs for select to authenticated
  using (public.can_access_pact(pact_id));
create policy "Pact participants can view agent actions"
  on public.agent_actions for select to authenticated
  using (public.can_access_pact(pact_id));
create policy "Pact participants can view progress snapshots"
  on public.progress_snapshots for select to authenticated
  using (public.can_access_pact(pact_id));
create policy "Pact participants can view scope changes"
  on public.scope_change_orders for select to authenticated
  using (public.can_access_pact(pact_id));
create policy "Pact participants can view disputes"
  on public.disputes for select to authenticated
  using (public.can_access_pact(pact_id));
create policy "Pact participants can view dispute evidence"
  on public.dispute_evidence for select to authenticated
  using (public.can_access_pact(pact_id));
create policy "Pact participants can view negotiations"
  on public.negotiation_sessions for select to authenticated
  using (public.can_access_pact(pact_id));
create policy "Pact participants can view negotiation offers"
  on public.negotiation_offers for select to authenticated
  using (public.can_access_pact(pact_id));

create or replace function public.record_pact_event(
  target_pact uuid,
  target_event_type text,
  target_aggregate_type text,
  target_aggregate_id uuid,
  target_payload jsonb default '{}'::jsonb,
  target_actor_type text default 'system',
  target_actor_id uuid default null,
  target_correlation_id text default null,
  target_idempotency_key text default null
)
returns uuid language plpgsql security definer set search_path = public
as $agent_event$
declare
  event_id uuid;
  target_workspace uuid;
begin
  if auth.uid() is null and current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'Authentication required';
  end if;
  if target_pact is null or target_event_type is null or length(trim(target_event_type)) not between 3 and 120
     or target_aggregate_type not in ('pact', 'milestone', 'submission', 'payment', 'scope_change', 'dispute', 'negotiation')
     or target_aggregate_id is null
     or target_actor_type not in ('owner', 'provider', 'system', 'worker')
     or jsonb_typeof(coalesce(target_payload, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'Invalid Pact event';
  end if;
  if auth.uid() is not null and not public.can_access_pact(target_pact) then
    raise exception 'Pact access required';
  end if;
  select p.workspace_id into target_workspace from public.pacts p where p.id = target_pact;
  if target_workspace is null then raise exception 'Pact not found'; end if;

  if target_idempotency_key is not null then
    select e.id into event_id from public.pact_events e
     where e.pact_id = target_pact and e.idempotency_key = trim(target_idempotency_key);
    if event_id is not null then return event_id; end if;
  end if;

  insert into public.pact_events(
    workspace_id, pact_id, aggregate_type, aggregate_id, event_type,
    actor_id, actor_type, payload, correlation_id, idempotency_key
  ) values (
    target_workspace, target_pact, target_aggregate_type, target_aggregate_id,
    trim(target_event_type), coalesce(target_actor_id, auth.uid()), target_actor_type,
    coalesce(target_payload, '{}'::jsonb), nullif(trim(target_correlation_id), ''),
    nullif(trim(target_idempotency_key), '')
  ) returning id into event_id;
  return event_id;
exception when unique_violation then
  select e.id into event_id from public.pact_events e
   where e.pact_id = target_pact and e.idempotency_key = trim(target_idempotency_key);
  if event_id is null then raise; end if;
  return event_id;
end;
$agent_event$;

revoke all on function public.record_pact_event(uuid, text, text, uuid, jsonb, text, uuid, text, text) from public;
grant execute on function public.record_pact_event(uuid, text, text, uuid, jsonb, text, uuid, text, text) to authenticated, service_role;

create or replace function public.enqueue_agent_run(
  target_event_id uuid,
  target_agent text,
  target_input_snapshot jsonb default '{}'::jsonb,
  target_max_attempts integer default 3
)
returns uuid language plpgsql security definer set search_path = public
as $agent_enqueue$
declare
  run_id uuid;
  target_pact uuid;
  target_workspace uuid;
  input_hash text;
begin
  if auth.uid() is null and current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'Authentication required';
  end if;
  if target_agent not in ('progress', 'scope_shield', 'dispute_shield', 'negotiation')
     or target_max_attempts not between 1 and 10
     or jsonb_typeof(coalesce(target_input_snapshot, '{}'::jsonb)) is distinct from 'object' then
    raise exception 'Invalid agent run';
  end if;
  select e.pact_id, e.workspace_id into target_pact, target_workspace
    from public.pact_events e where e.id = target_event_id;
  if target_pact is null then raise exception 'Pact event not found'; end if;
  if auth.uid() is not null and not public.can_access_pact(target_pact) then
    raise exception 'Pact access required';
  end if;
  input_hash := encode(digest(coalesce(target_input_snapshot, '{}'::jsonb)::text, 'sha256'), 'hex');

  insert into public.agent_runs(
    workspace_id, pact_id, trigger_event_id, agent_name, max_attempts,
    input_snapshot, input_sha256
  ) values (
    target_workspace, target_pact, target_event_id, target_agent, target_max_attempts,
    coalesce(target_input_snapshot, '{}'::jsonb), input_hash
  )
  on conflict (trigger_event_id, agent_name) do update
    set input_snapshot = case when public.agent_runs.status = 'queued' then excluded.input_snapshot else public.agent_runs.input_snapshot end,
        input_sha256 = case when public.agent_runs.status = 'queued' then excluded.input_sha256 else public.agent_runs.input_sha256 end,
        updated_at = now()
  returning id into run_id;
  return run_id;
end;
$agent_enqueue$;

revoke all on function public.enqueue_agent_run(uuid, text, jsonb, integer) from public;
grant execute on function public.enqueue_agent_run(uuid, text, jsonb, integer) to authenticated, service_role;

create or replace function public.claim_agent_run(target_run_id uuid, target_lease_seconds integer default 120)
returns table(id uuid, pact_id uuid, agent_name text, input_snapshot jsonb, attempt integer)
language plpgsql security definer set search_path = public
as $agent_claim$
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then raise exception 'Worker access required'; end if;
  update public.agent_runs
     set status = 'failed',
         error_code = 'max_attempts_exceeded',
         error_message = 'The agent run exceeded its retry limit.',
         lease_until = null,
         finished_at = now(),
         updated_at = now()
   where id = target_run_id
     and attempt >= max_attempts
     and (status = 'queued' or (status = 'running' and lease_until < now()));
  return query
    update public.agent_runs r
       set status = 'running',
           attempt = r.attempt + 1,
           lease_until = now() + (greatest(1, least(target_lease_seconds, 3600)) || ' seconds')::interval,
           started_at = coalesce(r.started_at, now()),
           updated_at = now()
     where r.id = target_run_id
       and r.attempt < r.max_attempts
       and (r.status = 'queued' or (r.status = 'running' and r.lease_until < now()))
    returning r.id, r.pact_id, r.agent_name, r.input_snapshot, r.attempt;
end;
$agent_claim$;

revoke all on function public.claim_agent_run(uuid, integer) from public;
grant execute on function public.claim_agent_run(uuid, integer) to service_role;

create or replace function public.finish_agent_run(
  target_run_id uuid,
  target_status text,
  target_output jsonb default null,
  target_output_mode text default null,
  target_provider text default null,
  target_model text default null,
  target_prompt_version text default null,
  target_provider_request_id text default null,
  target_validation_errors text[] default '{}',
  target_error_code text default null,
  target_error_message text default null
)
returns void language plpgsql security definer set search_path = public
as $agent_finish$
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then raise exception 'Worker access required'; end if;
  if target_status not in ('succeeded', 'failed', 'blocked')
     or (target_output is not null and jsonb_typeof(target_output) is distinct from 'object')
     or (target_output_mode is not null and target_output_mode not in ('ai-provider', 'deterministic-fallback', 'blocked')) then
    raise exception 'Invalid agent completion';
  end if;
  update public.agent_runs
     set status = target_status,
         output = target_output,
         output_mode = target_output_mode,
         provider = target_provider,
         model = target_model,
         prompt_version = target_prompt_version,
         provider_request_id = target_provider_request_id,
         validation_errors = coalesce(target_validation_errors, '{}'),
         error_code = nullif(trim(coalesce(target_error_code, '')), ''),
         error_message = nullif(trim(coalesce(target_error_message, '')), ''),
         lease_until = null,
         finished_at = now(),
         updated_at = now()
   where id = target_run_id and status = 'running';
  if not found then raise exception 'Agent run is not running'; end if;
end;
$agent_finish$;

revoke all on function public.finish_agent_run(uuid, text, jsonb, text, text, text, text, text, text[], text, text) from public;
grant execute on function public.finish_agent_run(uuid, text, jsonb, text, text, text, text, text, text[], text, text) to service_role;

create or replace function public.decide_agent_action(target_action_id uuid, target_decision text)
returns void language plpgsql security definer set search_path = public
as $agent_decide$
declare
  target_pact uuid;
  target_workspace uuid;
begin
  if auth.uid() is null or target_decision not in ('approved', 'rejected') then
    raise exception 'Owner decision required';
  end if;
  select a.pact_id, a.workspace_id into target_pact, target_workspace
    from public.agent_actions a where a.id = target_action_id and a.status = 'proposed' for update;
  if target_pact is null or not public.is_workspace_member(target_workspace, 'owner') then
    raise exception 'Owner decision required';
  end if;
  update public.agent_actions
     set status = target_decision,
         approved_by = case when target_decision = 'approved' then auth.uid() else null end,
         approved_at = now()
   where id = target_action_id and status = 'proposed';
end;
$agent_decide$;

revoke all on function public.decide_agent_action(uuid, text) from public;
grant execute on function public.decide_agent_action(uuid, text) to authenticated;
