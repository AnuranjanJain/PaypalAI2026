create table if not exists public.pact_verification_results (
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

create index if not exists pact_verification_results_pact_created_idx
  on public.pact_verification_results(pact_id, created_at desc);

alter table public.pact_verification_results enable row level security;
drop policy if exists "Pact participants can view verification results" on public.pact_verification_results;
create policy "Pact participants can view verification results"
  on public.pact_verification_results for select to authenticated
  using (public.can_access_pact(pact_id));
