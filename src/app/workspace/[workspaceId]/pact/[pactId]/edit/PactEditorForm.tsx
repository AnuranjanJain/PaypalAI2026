"use client";

import { useActionState } from "react";
import Link from "next/link";
import type { DraftActionState } from "./actions";

type Milestone = { position: number; title: string; amount_cents: number };
type SaveDraftAction = (state: DraftActionState, formData: FormData) => Promise<DraftActionState>;

export default function PactEditorForm({
  action,
  cancelHref,
  title,
  brief,
  budgetCents,
  milestones,
}: {
  action: SaveDraftAction;
  cancelHref: string;
  title: string;
  brief: string;
  budgetCents: number;
  milestones: Milestone[];
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="pact-editor-form">
      <label>Project name<input name="title" defaultValue={title} minLength={3} maxLength={120} required /></label>
      <label>Project brief<textarea name="brief" defaultValue={brief} minLength={10} maxLength={2000} rows={5} required /></label>
      <label>Project budget in USD<input name="budget" type="number" defaultValue={(budgetCents / 100).toFixed(2)} min="0.01" max="1000000" step="0.01" required /></label>
      <fieldset className="pact-editor-milestones">
        <legend>Milestone schedule</legend>
        <p>Adjust each milestone name and amount. The four amounts must equal the project budget.</p>
        {milestones.map((milestone, index) => (
          <div className="pact-editor-row" key={milestone.position}>
            <label>Milestone {index + 1}<input name="milestoneTitle" defaultValue={milestone.title} minLength={3} maxLength={120} required /></label>
            <label>Amount in USD<input name="milestoneAmount" type="number" defaultValue={(milestone.amount_cents / 100).toFixed(2)} min="0.01" max="1000000" step="0.01" required /></label>
          </div>
        ))}
      </fieldset>
      {state.error && <p className="pact-form-error" role="alert">{state.error}</p>}
      <div className="pact-form-actions">
        <button className="pact-primary" type="submit" disabled={pending}>{pending ? "Saving changes…" : "Save changes"}</button>
        <Link className="pact-secondary" href={cancelHref}>Cancel</Link>
      </div>
    </form>
  );
}
