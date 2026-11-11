-- The RETURNS TABLE output names are PL/pgSQL variables. Explicit constraint
-- targets avoid ambiguous column references in both idempotent inserts.
create or replace function public.accept_pact_invitation(target_token_hash text)
returns table(workspace_id uuid, pact_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  invitation record;
  current_role text;
  current_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  select i.workspace_id, i.pact_id, i.invited_email into invitation
    from public.pact_invitations i
    where i.token_hash = target_token_hash
      and i.status = 'pending'
      and i.expires_at > now()
    for update;
  if not found then raise exception 'Invitation is invalid or expired'; end if;

  select lower(u.email) into current_email
    from auth.users u
    where u.id = auth.uid();
  if current_email is null or current_email <> invitation.invited_email then
    raise exception 'Sign in with the invited email address';
  end if;

  select wm.role into current_role
    from public.workspace_members wm
    where wm.workspace_id = invitation.workspace_id
      and wm.user_id = auth.uid();
  if current_role = 'owner' then
    raise exception 'Workspace owners cannot join as providers';
  end if;

  insert into public.workspace_members(workspace_id, user_id, role)
    values (invitation.workspace_id, auth.uid(), 'provider')
    on conflict on constraint workspace_members_pkey do nothing;
  insert into public.pact_participants(pact_id, user_id)
    values (invitation.pact_id, auth.uid())
    on conflict on constraint pact_participants_pkey do nothing;
  update public.pact_invitations
    set status = 'accepted', accepted_at = now()
    where token_hash = target_token_hash;
  update public.pacts
    set status = 'active'
    where id = invitation.pact_id and status = 'draft';

  return query select invitation.workspace_id, invitation.pact_id;
end;
$$;

revoke all on function public.accept_pact_invitation(text) from public;
grant execute on function public.accept_pact_invitation(text) to authenticated;
