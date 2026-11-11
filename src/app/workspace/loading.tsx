import "../login/signin.css";

export default function WorkspaceLoading() {
  return <main className="signin"><section className="signin-content signin-loading" role="status" aria-live="polite"><span className="signin-spinner" aria-hidden="true" /><h1>Opening your workspace</h1><p>Please wait a moment.</p></section></main>;
}
