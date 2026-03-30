export default function AccessDeniedPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a12] px-4 text-center">
      <div className="mb-6 text-6xl">🚫</div>
      <h1 className="mb-2 font-mono text-2xl font-bold tracking-wider text-white/90">
        ACCESS DENIED
      </h1>
      <p className="mb-8 max-w-sm font-mono text-sm text-white/40">
        Your GitHub account is not authorised to access this system.
        Contact the administrator to request access.
      </p>
      <a
        href="/"
        className="rounded-lg border border-white/10 bg-white/[0.04] px-6 py-2 font-mono text-xs tracking-wider text-white/50 transition hover:border-white/20 hover:text-white/70"
      >
        ← BACK TO LOGIN
      </a>
    </div>
  );
}
