create table public.pact_verification_results (
  id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(id) on delete cascade,
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  submission_id uuid not null unique references public.pact_submissions(id) on delete cascade,
  mode text not null check (mode in ('ai-provider', 'deterministic-fallback')),
  eligible boolean not null,
  confidence numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  passed_criteria text[] not null default '{}',
  missing_items text[] not null default '{}',
  scope_flags text[] not null default '{}',
  summary text not null check (length(trim(summary)) between 1 and 1000),
  checked_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index pact_verification_results_pact_created_idx
  on public.pact_verification_results(pact_id, created_at desc);

alter table public.pact_verification_results enable row level security;

create policy "Pact participants can view verification results"
  on public.pact_verification_results for select to authenticated
  using (public.can_access_pact(pact_id));

create function public.record_pact_verification(
  target_submission uuid,
  verification_mode text,
  verification_eligible boolean,
  verification_confidence numeric,
  verification_passed text[] default '{}',
  verification_missing text[] default '{}',
  verification_scope text[] default '{}',
  verification_summary text default null
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  target_id uuid;
  target_pact uuid;
  target_milestone uuid;
  target_workspace uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if verification_mode not in ('ai-provider', 'deterministic-fallback')
     or verification_eligible is null
     or verification_confidence is null
     or verification_confidence < 0 or verification_confidence > 1
     or verification_summary is null
     or length(trim(verification_summary)) not between 1 and 1000
     or cardinality(coalesce(verification_passed, '{}')) > 50
     or cardinality(coalesce(verification_missing, '{}')) > 50
     or cardinality(coalesce(verification_scope, '{}')) > 50 then
    raise exception 'Invalid verification result';
  end if;

  select s.pact_id, s.milestone_id, p.workspace_id
    into target_pact, target_milestone, target_workspace
    from public.pact_submissions s
    join public.pacts p on p.id = s.pact_id
   where s.id = target_submission
     and s.status = 'submitted';
  if target_pact is null or not public.is_workspace_member(target_workspace, 'owner') then
    raise exception 'Owner verification required';
  end if;

  insert into public.pact_verification_results(
    pact_id, milestone_id, submission_id, mode, eligible, confidence,
    passed_criteria, missing_items, scope_flags, summary, checked_by
  ) values (
    target_pact, target_milestone, target_submission, verification_mode,
    verification_eligible, verification_confidence,
    coalesce(verification_passed, '{}'), coalesce(verification_missing, '{}'),
    coalesce(verification_scope, '{}'), trim(verification_summary), auth.uid()
  )
  on conflict (submission_id) do update set
    mode = excluded.mode,
    eligible = excluded.eligible,
    confidence = excluded.confidence,
    passed_criteria = excluded.passed_criteria,
    missing_items = excluded.missing_items,
    scope_flags = excluded.scope_flags,
    summary = excluded.summary,
    checked_by = excluded.checked_by,
    created_at = now()
  returning id into target_id;
  return target_id;
end;
$$;

revoke all on function public.record_pact_verification(uuid, text, boolean, numeric, text[], text[], text[], text) from public;
grant execute on function public.record_pact_verification(uuid, text, boolean, numeric, text[], text[], text[], text) to authenticated;
