create or replace function public.update_pact_draft(
  target_workspace uuid,
  target_pact uuid,
  pact_title text,
  pact_brief text,
  total_cents bigint,
  milestone_data jsonb
)
returns void language plpgsql security definer set search_path = public
as $$
declare
  pact_status text;
  milestone_total bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_workspace_member(target_workspace, 'owner') then
    raise exception 'Owner membership required';
  end if;

  select p.status into pact_status from public.pacts p
    where p.id = target_pact and p.workspace_id = target_workspace for update;
  if not found then raise exception 'Pact not found'; end if;
  if pact_status <> 'draft' then raise exception 'Only draft Pacts can be edited'; end if;

  if pact_title is null or length(trim(pact_title)) not between 3 and 120
     or pact_brief is null or length(trim(pact_brief)) not between 10 and 2000
     or total_cents is null or total_cents < 1 or total_cents > 100000000 then
    raise exception 'Invalid Pact details';
  end if;
  if milestone_data is null or jsonb_typeof(milestone_data) is distinct from 'array' then
    raise exception 'Invalid milestone details';
  end if;
  if jsonb_array_length(milestone_data) <> 4 then raise exception 'Exactly four milestones are required'; end if;

  if exists (
    select 1
    from jsonb_array_elements(milestone_data) as milestone(value)
    where jsonb_typeof(milestone.value) is distinct from 'object'
       or jsonb_typeof(milestone.value->'title') is distinct from 'string'
       or length(trim(milestone.value->>'title')) not between 3 and 120
       or jsonb_typeof(milestone.value->'amount_cents') is distinct from 'number'
       or milestone.value->>'amount_cents' is null
       or (milestone.value->>'amount_cents') !~ '^[1-9][0-9]{0,8}$'
  ) then
    raise exception 'Invalid milestone details';
  end if;

  select sum((milestone.value->>'amount_cents')::bigint) into milestone_total
    from jsonb_array_elements(milestone_data) as milestone(value);
  if milestone_total <> total_cents then raise exception 'Milestones must equal the Pact budget'; end if;

  update public.pacts
    set title = trim(pact_title), brief = trim(pact_brief), budget_cents = total_cents
    where id = target_pact;
  delete from public.milestones where pact_id = target_pact;
  insert into public.milestones(pact_id, title, position, amount_cents)
    select target_pact,
      trim(milestone.value->>'title'),
      milestone.ordinality::integer,
      (milestone.value->>'amount_cents')::bigint
    from jsonb_array_elements(milestone_data) with ordinality as milestone(value, ordinality);
end;
$$;

revoke all on function public.update_pact_draft(uuid, uuid, text, text, bigint, jsonb) from public;
grant execute on function public.update_pact_draft(uuid, uuid, text, text, bigint, jsonb) to authenticated;
