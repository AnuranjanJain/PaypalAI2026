-- Human decisions for disputes and AI-drafted negotiation offers.
create or replace function public.open_pact_dispute(
  target_pact uuid,
  target_milestone uuid,
  target_submission uuid,
  target_category text,
  target_statement text
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  target_workspace uuid;
  created_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if target_category not in ('scope', 'quality', 'delivery', 'payment', 'communication', 'other')
     or target_statement is null or length(trim(target_statement)) not between 1 and 10000 then
    raise exception 'Invalid dispute';
  end if;
  select p.workspace_id into target_workspace from public.pacts p
   where p.id = target_pact and p.status = 'active';
  if target_workspace is null or not public.can_access_pact(target_pact) then raise exception 'Pact access required'; end if;
  if target_milestone is not null and not exists (select 1 from public.milestones m where m.id = target_milestone and m.pact_id = target_pact) then
    raise exception 'Milestone does not belong to this Pact';
  end if;
  if target_submission is not null and not exists (select 1 from public.pact_submissions s where s.id = target_submission and s.pact_id = target_pact) then
    raise exception 'Submission does not belong to this Pact';
  end if;
  insert into public.disputes(workspace_id, pact_id, milestone_id, submission_id, opened_by, category, statement, status)
    values (target_workspace, target_pact, target_milestone, target_submission, auth.uid(), target_category, trim(target_statement), 'open')
    returning id into created_id;
  return created_id;
end;
$$;
revoke all on function public.open_pact_dispute(uuid, uuid, uuid, text, text) from public;
grant execute on function public.open_pact_dispute(uuid, uuid, uuid, text, text) to authenticated;

create or replace function public.respond_to_negotiation_offer(target_offer uuid, target_decision text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_pact uuid;
  target_workspace uuid;
  current_role text;
  owner_accept uuid;
  provider_accept uuid;
begin
  if auth.uid() is null or target_decision not in ('accepted', 'rejected') then raise exception 'Invalid negotiation decision'; end if;
  select o.pact_id, o.workspace_id, wm.role, o.accepted_by_owner, o.accepted_by_provider
    into target_pact, target_workspace, current_role, owner_accept, provider_accept
    from public.negotiation_offers o
    join public.workspace_members wm on wm.workspace_id = o.workspace_id and wm.user_id = auth.uid()
   where o.id = target_offer and o.status in ('proposed', 'countered')
   for update;
  if target_pact is null or not public.can_access_pact(target_pact) then raise exception 'Pact access required'; end if;
  if target_decision = 'rejected' then
    update public.negotiation_offers set status = 'rejected', updated_at = now() where id = target_offer;
    return;
  end if;
  if current_role = 'owner' then owner_accept := auth.uid(); else provider_accept := auth.uid(); end if;
  update public.negotiation_offers
     set accepted_by_owner = owner_accept,
         accepted_by_provider = provider_accept,
         status = case when owner_accept is not null and provider_accept is not null then 'accepted' else 'proposed' end,
         updated_at = now()
   where id = target_offer;
end;
$$;
revoke all on function public.respond_to_negotiation_offer(uuid, text) from public;
grant execute on function public.respond_to_negotiation_offer(uuid, text) to authenticated;

create or replace function public.resolve_pact_dispute(target_dispute uuid, target_status text, target_resolution_type text, target_resolution_note text)
returns void language plpgsql security definer set search_path = public
as $$
declare
  target_workspace uuid;
begin
  if auth.uid() is null or target_status not in ('resolved', 'dismissed') then raise exception 'Invalid dispute resolution'; end if;
  select d.workspace_id into target_workspace from public.disputes d where d.id = target_dispute and d.status in ('open', 'under_review') for update;
  if target_workspace is null or not public.is_workspace_member(target_workspace, 'owner') then raise exception 'Owner resolution required'; end if;
  if target_resolution_note is null or length(trim(target_resolution_note)) not between 1 and 10000 then raise exception 'Resolution note is required'; end if;
  update public.disputes set status = target_status, resolution_type = nullif(trim(coalesce(target_resolution_type, '')), ''), resolution_note = trim(target_resolution_note), resolved_by = auth.uid(), resolved_at = now(), updated_at = now() where id = target_dispute;
end;
$$;
revoke all on function public.resolve_pact_dispute(uuid, text, text, text) from public;
grant execute on function public.resolve_pact_dispute(uuid, text, text, text) to authenticated;

create or replace function public.attach_pact_milestone_source(
  target_pact uuid,
  target_milestone uuid,
  target_connection uuid,
  target_filters jsonb default '{}'
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare
  created_id uuid;
  target_workspace uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select p.workspace_id into target_workspace from public.pacts p where p.id = target_pact;
  if target_workspace is null or not public.is_workspace_member(target_workspace, 'owner') then raise exception 'Owner Pact access required'; end if;
  if not exists (select 1 from public.milestones m where m.id = target_milestone and m.pact_id = target_pact)
     or not exists (select 1 from public.connector_connections c where c.id = target_connection and c.pact_id = target_pact and c.status = 'active') then
    raise exception 'Milestone or active connector not found';
  end if;
  insert into public.pact_milestone_source_mappings(pact_id, milestone_id, connection_id, filters, created_by)
    values (target_pact, target_milestone, target_connection, coalesce(target_filters, '{}'), auth.uid())
  on conflict (milestone_id, connection_id) do update set filters = excluded.filters, enabled = true, updated_at = now()
  returning id into created_id;
  insert into public.connector_evidence(pact_id, milestone_id, connection_id, event_id, evidence_type, evidence_text, source_url, snapshot)
    select e.pact_id, target_milestone, e.connection_id, e.id, e.provider || ':' || e.event_type,
           coalesce(e.normalized->>'summary', e.event_type), e.source_url,
           jsonb_build_object('normalized', e.normalized, 'filters', coalesce(target_filters, '{}'::jsonb))
      from public.connector_events e
     where e.pact_id = target_pact and e.connection_id = target_connection
       and case when jsonb_typeof(coalesce(target_filters, '{}'::jsonb)->'eventTypes') = 'array'
                then e.event_type = any(array(select jsonb_array_elements_text(coalesce(target_filters, '{}'::jsonb)->'eventTypes')))
                else true end
       and (jsonb_typeof(coalesce(target_filters, '{}'::jsonb)->'resourceId') <> 'string'
            or e.resource_id = coalesce(target_filters, '{}'::jsonb)->>'resourceId')
  on conflict (event_id, milestone_id) do nothing;
  return created_id;
end;
$$;
revoke all on function public.attach_pact_milestone_source(uuid, uuid, uuid, jsonb) from public;
grant execute on function public.attach_pact_milestone_source(uuid, uuid, uuid, jsonb) to authenticated;

create or replace function public.prevent_pact_audit_mutation()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  raise exception 'Immutable Pact audit records cannot be changed';
end;
$$;

drop trigger if exists pact_events_immutable on public.pact_events;
create trigger pact_events_immutable before update or delete on public.pact_events for each row execute function public.prevent_pact_audit_mutation();
drop trigger if exists connector_events_immutable on public.connector_events;
create trigger connector_events_immutable before update or delete on public.connector_events for each row execute function public.prevent_pact_audit_mutation();
drop trigger if exists connector_evidence_immutable on public.connector_evidence;
create trigger connector_evidence_immutable before update or delete on public.connector_evidence for each row execute function public.prevent_pact_audit_mutation();
