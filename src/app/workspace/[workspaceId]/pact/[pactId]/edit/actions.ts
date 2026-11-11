"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parsePactDraftInput } from "@/lib/pact-draft-input";

export type DraftActionState = { error?: string };

export async function updatePactDraft(
  workspaceId: string,
  pactId: string,
  _previousState: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  if (![workspaceId, pactId].every((id) => /^[0-9a-f-]{36}$/i.test(id))) {
    return { error: "This Pact link is invalid. Return to your workspace and open it again." };
  }

  const draft = parsePactDraftInput({
    title: formData.get("title"),
    brief: formData.get("brief"),
    budget: formData.get("budget"),
    milestoneTitles: formData.getAll("milestoneTitle"),
    milestoneAmounts: formData.getAll("milestoneAmount"),
  });
  if (!draft) return { error: "Enter valid details and make the four milestone amounts add up to the Pact budget." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("update_pact_draft", {
    target_workspace: workspaceId,
    target_pact: pactId,
    pact_title: draft.title,
    pact_brief: draft.brief,
    total_cents: draft.budgetCents,
    milestone_data: draft.milestones.map((milestone) => ({
      title: milestone.title,
      amount_cents: milestone.amountCents,
    })),
  });
  if (error) return { error: "This Pact could not be saved. Drafts can only be edited by their workspace owner before the provider accepts." };

  redirect(`/workspace/${workspaceId}/pact/${pactId}`);
}
