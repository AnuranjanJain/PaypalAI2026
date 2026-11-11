"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./DeleteWorkspaceForm.module.css";

type DeleteWorkspaceAction = (formData: FormData) => void | Promise<void>;

type DeleteWorkspaceFormProps = {
  workspaceId: string;
  workspaceName: string;
  action: DeleteWorkspaceAction;
};

export default function DeleteWorkspaceForm({ workspaceId, workspaceName, action }: DeleteWorkspaceFormProps) {
  const [open, setOpen] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return <div className={styles.dangerZone}>
    <div>
      <strong className={styles.dangerTitle}>Delete this workspace</strong>
      <p className={styles.dangerCopy}>Permanently remove {workspaceName}, its Pacts, evidence, invitations, and payment history.</p>
    </div>
    <button className={styles.dangerButton} type="button" onClick={() => setOpen(true)}>Delete workspace</button>
    {open && <div className={styles.backdrop} role="presentation" onMouseDown={() => setOpen(false)}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="delete-workspace-title" onMouseDown={(event) => event.stopPropagation()}>
        <p className={styles.eyebrow}>IRREVERSIBLE ACTION</p>
        <h2 className={styles.dialogTitle} id="delete-workspace-title">Delete {workspaceName}?</h2>
        <p className={styles.dialogCopy}>This permanently deletes the workspace and every Pact, submission, invitation, and payment record inside it.</p>
        <form action={action}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <div className={styles.dialogActions}>
            <button ref={cancelButtonRef} className={styles.cancelButton} type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className={styles.dangerButton} type="submit">Yes, delete workspace</button>
          </div>
        </form>
      </section>
    </div>}
  </div>;
}
