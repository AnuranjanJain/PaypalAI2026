create table public.pact_submissions (
  id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(id) on delete cascade,
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  notes text not null check (length(trim(notes)) between 1 and 10000),
  links text[] not null default '{}',
  status text not null default 'submitted' check (status in ('submitted', 'revision_requested', 'approved')),
  decision_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index pact_submissions_milestone_created_idx
  on public.pact_submissions(milestone_id, created_at desc);

alter table public.pact_submissions enable row level security;

create policy "Pact participants can view submissions"
  on public.pact_submissions for select to authenticated
  using (public.can_access_pact(pact_id));

create policy "Providers can submit evidence"
  on public.pact_submissions for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and exists (
      select 1
      from public.pacts p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      join public.pact_participants pp on pp.pact_id = p.id and pp.user_id = auth.uid()
      where p.id = pact_id and p.status = 'active' and wm.user_id = auth.uid()
    )
  );

create function public.submit_pact_evidence(
  target_pact uuid,
  target_milestone uuid,
  submission_notes text,
  submission_links text[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  created_id uuid;
  latest_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if submission_notes is null or length(trim(submission_notes)) not between 1 and 10000 then
    raise exception 'Evidence notes are required';
  end if;
  if submission_links is null or cardinality(submission_links) > 10 then
    raise exception 'Too many evidence links';
  end if;
  if exists (
    select 1 from unnest(coalesce(submission_links, '{}')) link
    where trim(link) !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception 'Evidence links must use http or https';
  end if;
  if exists (select 1 from unnest(coalesce(submission_links, '{}')) link where length(trim(link)) > 2048) then
    raise exception 'Evidence link is too long';
  end if;
  if not exists (
    select 1 from public.pacts p
    join public.pact_participants pp on pp.pact_id = p.id and pp.user_id = auth.uid()
    join public.milestones m on m.pact_id = p.id and m.id = target_milestone
    where p.id = target_pact and p.status = 'active'
  ) then raise exception 'Provider access required'; end if;

  select s.status into latest_status
    from public.pact_submissions s
    where s.pact_id = target_pact and s.milestone_id = target_milestone
    order by s.created_at desc limit 1;
  if latest_status = 'submitted' or latest_status = 'approved' then
    raise exception 'This milestone is already under review';
  end if;

  begin
    insert into public.pact_submissions(pact_id, milestone_id, submitted_by, notes, links)
      values (target_pact, target_milestone, auth.uid(), trim(submission_notes),
        coalesce((select array_agg(trim(link)) from unnest(submission_links) link), '{}'))
      returning id into created_id;
  exception when unique_violation then
    raise exception 'This milestone is already under review';
  end;
  update public.milestones set status = 'submitted' where id = target_milestone and pact_id = target_pact;
  return created_id;
end;
$$;
revoke all on function public.submit_pact_evidence(uuid, uuid, text, text[]) from public;
grant execute on function public.submit_pact_evidence(uuid, uuid, text, text[]) to authenticated;

create function public.review_pact_submission(
  target_submission uuid,
  decision text,
  reviewer_note text default null
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_pact uuid;
  target_milestone uuid;
  target_workspace uuid;
begin
  if auth.uid() is null or decision not in ('approved', 'revision_requested') then
    raise exception 'Invalid review';
  end if;
  select s.pact_id, s.milestone_id, p.workspace_id
    into target_pact, target_milestone, target_workspace
    from public.pact_submissions s join public.pacts p on p.id = s.pact_id
    where s.id = target_submission and s.status = 'submitted';
  if target_pact is null or not public.is_workspace_member(target_workspace, 'owner') then
    raise exception 'Owner review required';
  end if;
  update public.pact_submissions
    set status = decision, decision_note = nullif(trim(coalesce(reviewer_note, '')), ''),
        reviewed_by = auth.uid(), reviewed_at = now()
    where id = target_submission;
  update public.milestones
    set status = case when decision = 'approved' then 'approved' else 'revision_requested' end
    where id = target_milestone and pact_id = target_pact;
end;
$$;
revoke all on function public.review_pact_submission(uuid, text, text) from public;
grant execute on function public.review_pact_submission(uuid, text, text) to authenticated;

create table public.pact_payment_events (
  id uuid primary key default gen_random_uuid(),
  pact_id uuid not null references public.pacts(id) on delete cascade,
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  paypal_order_id text not null unique,
  approval_url text,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'USD',
  status text not null default 'created' check (status in ('created', 'captured', 'payout_pending', 'paid_to_provider', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pact_payment_events enable row level security;
create policy "Owners can view Pact payment events"
  on public.pact_payment_events for select to authenticated
  using (owner_id = auth.uid() and public.can_access_pact(pact_id));

create unique index pact_submissions_one_open_per_milestone
  on public.pact_submissions(pact_id, milestone_id)
  where status = 'submitted';

create unique index pact_payment_events_one_active_per_milestone
  on public.pact_payment_events(milestone_id)
  where status in ('created', 'captured', 'payout_pending', 'paid_to_provider');

create function public.record_pact_payment_event(
  target_pact uuid,
  target_milestone uuid,
  target_order_id text,
  target_approval_url text,
  target_amount_cents bigint
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_workspace uuid;
  expected_amount bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select p.workspace_id, m.amount_cents
    into target_workspace, expected_amount
    from public.pacts p
    join public.milestones m on m.pact_id = p.id and m.id = target_milestone
    where p.id = target_pact and p.status = 'active' and m.status = 'approved';
  if target_workspace is null or not public.is_workspace_member(target_workspace, 'owner') then
    raise exception 'Owner checkout required';
  end if;
  if target_amount_cents is null or target_amount_cents <> expected_amount then
    raise exception 'Payment amount does not match the approved milestone';
  end if;
  if target_order_id is null or target_order_id !~ '^[A-Za-z0-9_-]{3,100}$' then
    raise exception 'Invalid PayPal order';
  end if;
  if target_approval_url is not null and target_approval_url !~* '^https://[^[:space:]]+$' then
    raise exception 'Invalid PayPal approval link';
  end if;
  insert into public.pact_payment_events(
    pact_id, milestone_id, owner_id, paypal_order_id, approval_url, amount_cents, currency, status
  ) values (
    target_pact, target_milestone, auth.uid(), target_order_id, target_approval_url, target_amount_cents, 'USD', 'created'
  );
exception when unique_violation then
  raise exception 'A payment order already exists for this milestone';
end;
$$;
revoke all on function public.record_pact_payment_event(uuid, uuid, text, text, bigint) from public;
grant execute on function public.record_pact_payment_event(uuid, uuid, text, text, bigint) to authenticated;

create function public.mark_pact_payment_captured(target_order_id text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  event_status text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select status into event_status
    from public.pact_payment_events
    where paypal_order_id = target_order_id and owner_id = auth.uid()
    for update;
  if event_status is null then raise exception 'Payment order not found'; end if;
  if event_status in ('captured', 'payout_pending', 'paid_to_provider') then return; end if;
  if event_status <> 'created' then raise exception 'Payment order is not capturable'; end if;
  update public.pact_payment_events
    set status = 'captured', updated_at = now()
    where paypal_order_id = target_order_id and owner_id = auth.uid();
end;
$$;
revoke all on function public.mark_pact_payment_captured(text) from public;
grant execute on function public.mark_pact_payment_captured(text) to authenticated;
