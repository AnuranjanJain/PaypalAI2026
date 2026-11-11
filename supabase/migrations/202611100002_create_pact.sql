create function public.create_pact_draft(target_workspace uuid, pact_title text, pact_brief text, total_cents bigint, shares integer[])
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  new_pact uuid;
  index integer;
  allocated bigint := 0;
  portion bigint;
begin
  if auth.uid() is null or not public.is_workspace_member(target_workspace, 'owner') then
    raise exception 'Owner membership required';
  end if;
  if pact_title is null or length(trim(pact_title)) not between 3 and 120
     or pact_brief is null or length(trim(pact_brief)) not between 10 and 2000
     or total_cents is null or total_cents < 1 or total_cents > 100000000
     or shares is null or array_ndims(shares) <> 1 or cardinality(shares) <> 4
     or array_position(shares, null) is not null
     or exists (select 1 from unnest(shares) s where s < 1 or s > 100)
     or (select sum(s) from unnest(shares) s) <> 100 then
    raise exception 'Invalid Pact details';
  end if;
  insert into public.pacts(workspace_id, title, brief, budget_cents)
    values (target_workspace, trim(pact_title), trim(pact_brief), total_cents) returning id into new_pact;
  for index in 1..4 loop
    portion := case when index = 4 then total_cents - allocated else (total_cents * shares[index]) / 100 end;
    if portion < 1 then raise exception 'Each milestone must be at least one cent'; end if;
    insert into public.milestones(pact_id, title, position, amount_cents)
      values (new_pact, (array['Discovery and direction', 'First delivery', 'Review and revision', 'Final handoff'])[index], index, portion);
    allocated := allocated + portion;
  end loop;
  return new_pact;
end; $$;
revoke all on function public.create_pact_draft(uuid, text, text, bigint, integer[]) from public;
grant execute on function public.create_pact_draft(uuid, text, text, bigint, integer[]) to authenticated;
