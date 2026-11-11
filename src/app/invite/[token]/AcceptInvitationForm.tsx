"use client";

import { useFormStatus } from "react-dom";

function AcceptButton() {
  const { pending } = useFormStatus();
  return (
    <button className="pact-primary" type="submit" disabled={pending} aria-busy={pending}>
      {pending ? "Accepting Pact..." : "Accept Pact and continue"}
    </button>
  );
}

export default function AcceptInvitationForm({ action }: { action: () => void | Promise<void> }) {
  return <form action={action}><AcceptButton /></form>;
}
