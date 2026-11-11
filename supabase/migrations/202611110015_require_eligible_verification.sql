-- Approval must follow a persisted eligible evidence check for the latest submission.
create or replace function public.review_pact_submission(
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
  target_status text;
  has_eligible_verification boolean;
begin
  if auth.uid() is null or decision not in ('approved', 'revision_requested') then
    raise exception 'Invalid review';
  end if;
  if reviewer_note is not null and length(trim(reviewer_note)) > 2000 then
    raise exception 'Review note is too long';
  end if;

  select s.pact_id, s.milestone_id, s.status, p.workspace_id
    into target_pact, target_milestone, target_status, target_workspace
    from public.pact_submissions s
    join public.pacts p on p.id = s.pact_id
   where s.id = target_submission;
  if target_pact is null or target_status <> 'submitted' or not public.is_workspace_member(target_workspace, 'owner') then
    raise exception 'Owner review required';
  end if;
  if exists (
    select 1
      from public.pact_submissions newer
     where newer.pact_id = target_pact
       and newer.milestone_id = target_milestone
       and newer.created_at > (select created_at from public.pact_submissions where id = target_submission)
  ) then
    raise exception 'Only the latest submission can be reviewed';
  end if;

  if decision = 'approved' then
    select coalesce(v.eligible, false)
      into has_eligible_verification
      from public.pact_verification_results v
     where v.submission_id = target_submission;
    if not coalesce(has_eligible_verification, false) then
      raise exception 'Run an eligible evidence check before approving this milestone';
    end if;
  end if;

  update public.pact_submissions
     set status = decision,
         decision_note = nullif(trim(coalesce(reviewer_note, '')), ''),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = target_submission;
  update public.milestones
     set status = case when decision = 'approved' then 'approved' else 'revision_requested' end
   where id = target_milestone and pact_id = target_pact;
end;
$$;

revoke all on function public.review_pact_submission(uuid, text, text) from public;
grant execute on function public.review_pact_submission(uuid, text, text) to authenticated;
