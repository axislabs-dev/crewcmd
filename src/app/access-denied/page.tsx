export default function AccessDeniedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg-primary)] px-4 text-center">
      <div className="mb-6 text-6xl">🚫</div>
      <h1 className="mb-2 text-2xl font-bold tracking-wider text-[var(--text-primary)]">
        ACCESS DENIED
      </h1>
      <p className="mb-8 max-w-sm text-sm text-[var(--text-tertiary)]">
        Your GitHub account is not authorised to access this system.
        Contact the administrator to request access.
      </p>
      <a
        href="/"
        className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] px-6 py-2 text-xs tracking-wider text-[var(--text-secondary)] transition hover:border-[var(--border-medium)] hover:text-[var(--text-primary)]"
      >
        ← BACK TO LOGIN
      </a>
    </div>
  );
}
