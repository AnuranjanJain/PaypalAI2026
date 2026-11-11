"use client";

import { useState } from "react";

export default function CopyInviteLink({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  }

  return (
    <div className="pact-copy-link">
      <input aria-label="Provider invitation link" value={value} readOnly onFocus={(event) => event.currentTarget.select()} />
      <button type="button" className="pact-secondary" onClick={copyLink}>{copied ? "Copied" : "Copy link"}</button>
      <p role="status">{copyError ? "Copy was unavailable. Select the link to copy it manually." : "Share this link with the provider at the email address you entered. It expires in seven days."}</p>
    </div>
  );
}
