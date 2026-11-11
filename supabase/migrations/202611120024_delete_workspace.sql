-- Allow only a workspace owner to permanently remove the workspace and its Pact data.
create or replace function public.delete_workspace(target_workspace uuid)
returns void language plpgsql security definer set search_path = public
as $delete_workspace$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
      from public.workspace_members
     where workspace_id = target_workspace
       and user_id = auth.uid()
       and role = 'owner'
  ) then
    raise exception 'Owner membership required';
  end if;

  delete from public.workspaces
   where id = target_workspace;

  if not found then
    raise exception 'Workspace not found';
  end if;
end;
$delete_workspace$;

revoke all on function public.delete_workspace(uuid) from public;
grant execute on function public.delete_workspace(uuid) to authenticated;
