"use client";

import { useActionState } from "react";
import type { InviteActionState } from "./actions";

type CreateInvitationAction = (state: InviteActionState, formData: FormData) => Promise<InviteActionState>;

export default function InviteProviderForm({ action }: { action: CreateInvitationAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="pact-invite-form">
      <label>Provider email<input name="email" type="email" maxLength={254} autoComplete="email" required /></label>
      {state.error && <p className="pact-form-error" role="alert">{state.error}</p>}
      <button className="pact-primary" type="submit" disabled={pending}>{pending ? "Preparing invitation…" : "Create invitation link"}</button>
    </form>
  );
}
