-- Let a signed-in bearer of a pending invitation see which account is invited.
-- Acceptance remains email-bound in accept_pact_invitation; the token is a
-- high-entropy bearer secret and is required for this lookup.
create or replace function public.get_pact_invitation(target_token_hash text)
returns table(workspace_id uuid, pact_id uuid, pact_title text, workspace_name text, invited_email text)
language sql stable security definer set search_path = public
as $$
  select i.workspace_id, i.pact_id, p.title, w.name, i.invited_email
    from public.pact_invitations i
    join public.pacts p on p.id = i.pact_id
    join public.workspaces w on w.id = i.workspace_id
    where i.token_hash = target_token_hash
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
