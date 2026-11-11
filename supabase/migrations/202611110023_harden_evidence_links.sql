-- Keep direct RPC callers under the same evidence-link rules as the UI.
create or replace function public.submit_pact_evidence(
  target_pact uuid,
  target_milestone uuid,
  submission_notes text,
  submission_links text[] default '{}'
)
returns uuid language plpgsql security definer set search_path = public
as $pact_evidence$
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
    select 1
      from unnest(coalesce(submission_links, '{}')) link
     where link is null
        or length(trim(link)) > 2048
        or trim(link) !~* '^https?://[^[:space:]@/]+([/?#][^[:space:]]*)?$'
  ) then
    raise exception 'Evidence links must be valid http or https URLs without embedded credentials';
  end if;
  if not exists (
    select 1
      from public.pacts p
      join public.pact_participants pp on pp.pact_id = p.id and pp.user_id = auth.uid()
      join public.milestones m on m.pact_id = p.id and m.id = target_milestone
     where p.id = target_pact and p.status = 'active'
  ) then
    raise exception 'Provider access required';
  end if;

  select s.status into latest_status
    from public.pact_submissions s
   where s.pact_id = target_pact and s.milestone_id = target_milestone
   order by s.created_at desc
   limit 1;
  if latest_status = 'submitted' or latest_status = 'approved' then
    raise exception 'This milestone is already under review';
  end if;

  begin
    insert into public.pact_submissions(pact_id, milestone_id, submitted_by, notes, links)
      values (
        target_pact,
        target_milestone,
        auth.uid(),
        trim(submission_notes),
        coalesce((select array_agg(trim(link)) from unnest(submission_links) link), '{}')
      )
      returning id into created_id;
  exception when unique_violation then
    raise exception 'This milestone is already under review';
  end;
  update public.milestones
     set status = 'submitted'
   where id = target_milestone and pact_id = target_pact;
  return created_id;
end;
$pact_evidence$;

revoke all on function public.submit_pact_evidence(uuid, uuid, text, text[]) from public;
grant execute on function public.submit_pact_evidence(uuid, uuid, text, text[]) to authenticated;
