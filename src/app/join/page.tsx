"use client";

import { Suspense, useState, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

interface InviteInfo {
  companyName: string;
  email: string | null;
  role: string;
  expired: boolean;
  alreadyAccepted: boolean;
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-neo/30 border-t-neo" />
          <p className="text-sm text-[var(--text-tertiary)]">Loading...</p>
        </div>
      }
    >
      <JoinPageContent />
    </Suspense>
  );
}

function JoinPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const { data: session, status: sessionStatus } = useSession();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Signup form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Validate the token on mount
  useEffect(() => {
    if (!token) {
      setError("No invite token provided");
      setLoading(false);
      return;
    }

    fetch(`/api/invite/validate?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Invalid invite");
        } else {
          setInvite(data);
          if (data.email) setEmail(data.email);
        }
      })
      .catch(() => setError("Failed to validate invite"))
      .finally(() => setLoading(false));
  }, [token]);

  // If already logged in, try to accept directly
  useEffect(() => {
    if (sessionStatus !== "authenticated" || !session || !token || !invite) return;
    acceptInvite();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, invite]);

  async function acceptInvite() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to accept invite");
        setSubmitting(false);
        return;
      }
      // Set active company cookie and redirect
      document.cookie = `active_company=${data.companyId};path=/;max-age=${60 * 60 * 24 * 365}`;
      router.push("/dashboard");
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  async function handleSignupAndJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setError("");

    try {
      // 1. Sign up with the invite token
      const signupRes = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, inviteToken: token }),
      });
      const signupData = await signupRes.json();

      if (!signupRes.ok) {
        setError(signupData.error || "Signup failed");
        setSubmitting(false);
        return;
      }

      // 2. Auto sign-in
      const signInRes = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (signInRes?.error) {
        setError("Account created but sign-in failed. Try logging in.");
        setSubmitting(false);
        return;
      }

      // 3. Accept the invite (join the company)
      const acceptRes = await fetch("/api/invite/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const acceptData = await acceptRes.json();

      if (!acceptRes.ok) {
        // User was created but company join failed — redirect to dashboard anyway
        router.push("/dashboard");
        return;
      }

      document.cookie = `active_company=${acceptData.companyId};path=/;max-age=${60 * 60 * 24 * 365}`;
      router.push("/dashboard");
    } catch {
      setError("Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]/50";
  const btnPrimary =
    "w-full rounded-lg bg-[var(--accent-soft)] px-4 py-2.5 font-mono text-xs tracking-wider text-[var(--accent)] transition-colors hover:bg-[var(--accent-medium)] disabled:opacity-50";

  // Loading state
  if (loading || sessionStatus === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-neo/30 border-t-neo" />
        <p className="text-sm text-[var(--text-tertiary)]">Validating invite...</p>
      </div>
    );
  }

  // Error state (no valid invite)
  if (error && !invite) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <div className="mb-6 text-5xl">{"\u26A0\uFE0F"}</div>
        <h1 className="mb-2 font-mono text-xl font-bold tracking-wider text-[var(--text-primary)]">
          INVITE ERROR
        </h1>
        <p className="mb-6 font-mono text-sm text-red-400/70">{error}</p>
        <a
          href="/"
          className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] px-6 py-2 text-xs tracking-wider text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
        >
          GO TO LOGIN
        </a>
      </div>
    );
  }

  if (invite?.alreadyAccepted) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <div className="mb-6 text-5xl">{"\u2705"}</div>
        <h1 className="mb-2 font-mono text-xl font-bold tracking-wider text-[var(--text-primary)]">
          ALREADY ACCEPTED
        </h1>
        <p className="mb-6 text-sm text-[var(--text-tertiary)]">
          This invite has already been used. Sign in to continue.
        </p>
        <a
          href="/"
          className="rounded-lg border border-[var(--accent-medium)] bg-[var(--accent-soft)] px-6 py-2.5 font-mono text-xs font-bold tracking-wider text-[var(--accent)] transition hover:bg-[var(--accent-medium)]"
        >
          SIGN IN
        </a>
      </div>
    );
  }

  if (invite?.expired) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <div className="mb-6 text-5xl">{"\u23F0"}</div>
        <h1 className="mb-2 font-mono text-xl font-bold tracking-wider text-[var(--text-primary)]">
          INVITE EXPIRED
        </h1>
        <p className="mb-6 text-sm text-[var(--text-tertiary)]">
          This invite link has expired. Ask your admin for a new one.
        </p>
        <a
          href="/"
          className="rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] px-6 py-2 text-xs tracking-wider text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
        >
          GO TO LOGIN
        </a>
      </div>
    );
  }

  // If logged in, show accepting state
  if (session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        {submitting ? (
          <>
            <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-neo/30 border-t-neo" />
            <p className="text-sm text-[var(--text-tertiary)]">Joining {invite?.companyName}...</p>
          </>
        ) : (
          <>
            <div className="mb-6 text-5xl">{"\u{1F3E2}"}</div>
            <h1 className="mb-2 font-mono text-xl font-bold tracking-wider text-[var(--text-primary)]">
              JOIN {invite?.companyName?.toUpperCase()}
            </h1>
            <p className="mb-4 text-sm text-[var(--text-tertiary)]">
              You&apos;ve been invited as <span className="text-[var(--accent)]">{invite?.role}</span>
            </p>
            {error && <p className="mb-4 font-mono text-sm text-red-400/70">{error}</p>}
            <button onClick={acceptInvite} disabled={submitting} className={btnPrimary}>
              ACCEPT INVITE
            </button>
          </>
        )}
      </div>
    );
  }

  // Not logged in — show signup form
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <h1 className="font-mono text-xl font-bold tracking-wider text-[var(--accent)]">
            JOIN {invite?.companyName?.toUpperCase()}
          </h1>
          <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
            Create your account to join as <span className="text-[var(--accent)]">{invite?.role}</span>
          </p>
        </div>

        <form onSubmit={handleSignupAndJoin} className="mt-6 space-y-4">
          <div>
            <label className="block text-[11px] tracking-wider text-[var(--text-tertiary)]">NAME</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              required
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-[11px] tracking-wider text-[var(--text-tertiary)]">EMAIL</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              readOnly={!!invite?.email}
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-[11px] tracking-wider text-[var(--text-tertiary)]">PASSWORD</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 8 characters"
              required
              minLength={8}
              className={inputClass}
            />
          </div>

          {error && <p className="font-mono text-xs text-red-400/70">{error}</p>}

          <button type="submit" disabled={submitting} className={btnPrimary}>
            {submitting ? "CREATING ACCOUNT..." : "CREATE ACCOUNT & JOIN"}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] text-[var(--text-tertiary)]">
          Already have an account?{" "}
          <a href="/" className="text-[var(--accent)] hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
