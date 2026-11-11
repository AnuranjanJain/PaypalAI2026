-- Keep a valid invitation usable after the invited provider has already
-- accepted it. This makes refreshes and repeated clicks safe and recoverable.
create or replace function public.get_pact_invitation(target_token_hash text)
returns table(workspace_id uuid, pact_id uuid, pact_title text, workspace_name text, invited_email text)
language sql stable security definer set search_path = public
as $$
  select i.workspace_id, i.pact_id, p.title, w.name, i.invited_email
    from public.pact_invitations i
    join public.pacts p on p.id = i.pact_id
    join public.workspaces w on w.id = i.workspace_id
    join auth.users u on u.id = auth.uid()
    where i.token_hash = target_token_hash
      and lower(i.invited_email) = lower(u.email)
      and (
        (i.status = 'pending' and i.expires_at > now())
        or (
          i.status = 'accepted'
          and exists (
            select 1
              from public.pact_participants pp
             where pp.pact_id = i.pact_id
               and pp.user_id = auth.uid()
          )
        )
      );
$$;

revoke all on function public.get_pact_invitation(text) from public;
grant execute on function public.get_pact_invitation(text) to authenticated;

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

  select i.workspace_id, i.pact_id, i.invited_email, i.status
    into invitation
    from public.pact_invitations i
   where i.token_hash = target_token_hash
     and (
       (i.status = 'pending' and i.expires_at > now())
       or i.status = 'accepted'
     )
   for update;
  if not found then raise exception 'Invitation is invalid or expired'; end if;

  select lower(u.email)
    into current_email
    from auth.users u
   where u.id = auth.uid();
  if current_email is null or current_email <> invitation.invited_email then
    raise exception 'Sign in with the invited email address';
  end if;

  if invitation.status = 'accepted' then
    if not exists (
      select 1
        from public.pact_participants pp
       where pp.pact_id = invitation.pact_id
         and pp.user_id = auth.uid()
    ) then
      raise exception 'Invitation was accepted by another account';
    end if;
    return query select invitation.workspace_id, invitation.pact_id;
    return;
  end if;

  select wm.role
    into current_role
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
   where id = invitation.pact_id
     and status = 'draft';

  return query select invitation.workspace_id, invitation.pact_id;
end;
$$;

revoke all on function public.accept_pact_invitation(text) from public;
grant execute on function public.accept_pact_invitation(text) to authenticated;
