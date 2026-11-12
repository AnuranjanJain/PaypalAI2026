"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { emitPactAgentEvent } from "@/lib/agents/events";

export type WorkflowActionState = { error?: string; success?: string };

function validId(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function parseLinks(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return [];
  const links = value.split(/\r?\n/).map((link) => link.trim()).filter(Boolean);
  if (links.length > 10) return null;
  for (const link of links) {
    try {
      const url = new URL(link);
      if (!(url.protocol === "https:" || url.protocol === "http:")) return null;
      if (url.username || url.password) return null;
    } catch {
      return null;
    }
  }
  return links;
}

export async function submitPactEvidence(
  workspaceId: string,
  pactId: string,
  milestoneId: string,
  _previousState: WorkflowActionState,
  formData: FormData,
): Promise<WorkflowActionState> {
  if (![workspaceId, pactId, milestoneId].every(validId)) return { error: "This milestone link is invalid." };
  const notes = formData.get("notes");
  const links = parseLinks(formData.get("links"));
  if (typeof notes !== "string" || notes.trim().length < 1 || notes.trim().length > 10000) {
    return { error: "Add a concise description of the completed work." };
  }
  if (links === null) return { error: "Use up to ten valid http(s) links, one per line." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/workspace/${workspaceId}/pact/${pactId}`)}`);
  const { data: submissionId, error } = await supabase.rpc("submit_pact_evidence", {
    target_pact: pactId,
    target_milestone: milestoneId,
    submission_notes: notes.trim(),
    submission_links: links,
  });
  if (error) return { error: error.message.includes("already") ? "This milestone is already under review." : "Evidence could not be submitted. Check your Pact access and try again." };
  if (typeof submissionId === "string") {
    await emitPactAgentEvent(supabase, {
      pactId,
      aggregateType: "submission",
      aggregateId: submissionId,
      eventType: "evidence.submitted",
      payload: { milestoneId, submissionId, notesLength: notes.trim().length, linkCount: links.length },
      idempotencyKey: `evidence.submitted:${submissionId}`,
    });
  }
  revalidatePath(`/workspace/${workspaceId}/pact/${pactId}`);
  return { success: "Evidence submitted for owner review." };
}

export async function reviewPactSubmission(
  workspaceId: string,
  pactId: string,
  _previousState: WorkflowActionState,
  formData: FormData,
): Promise<WorkflowActionState> {
  if (![workspaceId, pactId].every(validId)) return { error: "This Pact link is invalid." };
  const submissionId = formData.get("submissionId");
  const decision = formData.get("decision");
  const note = formData.get("note");
  if (typeof submissionId !== "string" || !validId(submissionId) || (decision !== "approved" && decision !== "revision_requested")) {
    return { error: "Choose a valid review decision." };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/workspace/${workspaceId}/pact/${pactId}`)}`);
  if (decision === "approved") {
    const { data: verification, error: verificationError } = await supabase
      .from("pact_verification_results")
      .select("eligible")
      .eq("submission_id", submissionId)
      .maybeSingle();
    if (verificationError) {
      const message = verificationError.message.toLowerCase();
      if (message.includes("does not exist") || message.includes("schema cache") || verificationError.code === "PGRST202") {
        return { error: "Verification storage is not enabled. Apply the latest Supabase migration before approving." };
      }
      return { error: "The evidence check could not be loaded. Run it again, then retry approval." };
    }
    if (!verification?.eligible) return { error: "Run an eligible evidence check before approving this milestone." };
  }
  const { data: submissionContext } = await supabase.from("pact_submissions").select("milestone_id").eq("id", submissionId).eq("pact_id", pactId).maybeSingle();
  const { error } = await supabase.rpc("review_pact_submission", {
    target_submission: submissionId,
    decision,
    reviewer_note: typeof note === "string" ? note.trim() : null,
  });
  if (error) return { error: "This review could not be saved. It may already have been reviewed." };
  await emitPactAgentEvent(supabase, {
    pactId,
    aggregateType: "submission",
    aggregateId: submissionId,
    eventType: decision === "approved" ? "submission.approved" : "submission.revision_requested",
      payload: { submissionId, milestoneId: submissionContext?.milestone_id ?? null, decision, autoPayment: decision === "approved" },
    idempotencyKey: `submission.${decision}:${submissionId}`,
  });
  revalidatePath(`/workspace/${workspaceId}/pact/${pactId}`);
  return { success: decision === "approved" ? "Milestone approved. PayPal checkout is ready." : "Revision requested. The provider can resubmit evidence." };
}
