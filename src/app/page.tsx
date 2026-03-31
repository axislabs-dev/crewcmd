"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Check if any users exist — if not, default to signup mode
  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.hasUsers) setMode("signup");
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });
        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Signup failed");
          setLoading(false);
          return;
        }

        // Auto sign-in after signup
        const signInRes = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (signInRes?.error) {
          setError("Account created but sign-in failed. Try logging in.");
          setMode("login");
          setLoading(false);
          return;
        }

        router.push("/onboarding");
      } else {
        const res = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (res?.error) {
          setError("Invalid email or password");
          setLoading(false);
          return;
        }

        router.push("/dashboard");
      }
    } catch {
      setError("Something went wrong. Try again.");
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="grid-bg scanlines flex min-h-screen items-center justify-center">
        <div className="h-4 w-4 rounded-full bg-neo animate-pulse" style={{ boxShadow: "0 0 20px rgba(0, 240, 255, 0.8)" }} />
      </div>
    );
  }

  return (
    <div className="grid-bg scanlines flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Branding */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div
            className="h-4 w-4 rounded-full bg-neo"
            style={{ boxShadow: "0 0 20px rgba(0, 240, 255, 0.8)" }}
          />
          <div className="text-center">
            <h1 className="glow-text-neo font-mono text-2xl font-bold tracking-[0.2em] text-neo">
              CREWCMD
            </h1>
            <p className="mt-1 font-mono text-[10px] tracking-[0.4em] text-white/30">
              COMMAND CENTER
            </p>
          </div>
        </div>

        {/* Login Card */}
        <div
          className="glass-card p-8"
          style={{ borderColor: "rgba(0, 240, 255, 0.1)" }}
        >
          <div className="mb-6 text-center">
            <h2 className="font-mono text-sm font-bold tracking-[0.15em] text-white/70">
              {mode === "signup" ? "CREATE YOUR ACCOUNT" : "TACTICAL ACCESS"}
            </h2>
            <p className="mt-1.5 text-xs text-white/30">
              {mode === "signup"
                ? "Set up the first admin account"
                : "Authenticate to enter the command center"}
            </p>
          </div>

          {/* Divider */}
          <div className="mb-6 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

          {/* Error */}
          {error && (
            <div className="mb-4 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-center font-mono text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="mb-1.5 block font-mono text-[10px] tracking-wider text-white/40">
                  NAME
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="Your name"
                  className="w-full rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 py-2.5 font-mono text-sm text-white/80 placeholder-white/20 outline-none transition-colors focus:border-neo/40 focus:bg-neo/[0.04]"
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block font-mono text-[10px] tracking-wider text-white/40">
                EMAIL
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 py-2.5 font-mono text-sm text-white/80 placeholder-white/20 outline-none transition-colors focus:border-neo/40 focus:bg-neo/[0.04]"
              />
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-[10px] tracking-wider text-white/40">
                PASSWORD
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Min 8 characters"
                className="w-full rounded-lg border border-white/[0.12] bg-white/[0.04] px-3 py-2.5 font-mono text-sm text-white/80 placeholder-white/20 outline-none transition-colors focus:border-neo/40 focus:bg-neo/[0.04]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="group flex w-full items-center justify-center gap-3 rounded-lg border border-white/[0.12] bg-white/[0.04] px-4 py-3 font-mono text-sm font-bold tracking-wider text-white/80 transition-all duration-200 hover:border-neo/40 hover:bg-neo/[0.08] hover:text-neo hover:shadow-[0_0_20px_rgba(0,240,255,0.1)] disabled:opacity-50"
            >
              {loading
                ? "AUTHENTICATING..."
                : mode === "signup"
                  ? "CREATE ACCOUNT"
                  : "SIGN IN"}
            </button>
          </form>

          {/* Toggle mode */}
          <div className="mt-4 text-center">
            <button
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError("");
              }}
              className="font-mono text-[10px] tracking-wider text-white/30 transition-colors hover:text-neo/60"
            >
              {mode === "login"
                ? "NEED AN ACCOUNT? CREATE ONE"
                : "ALREADY HAVE AN ACCOUNT? SIGN IN"}
            </button>
          </div>

          {/* Footer note */}
          <p className="mt-4 text-center font-mono text-[9px] tracking-wider text-white/20">
            ACCESS RESTRICTED TO AUTHORIZED PERSONNEL
          </p>
        </div>

        {/* Bottom branding */}
        <div className="mt-6 text-center">
          <span className="font-mono text-[9px] tracking-wider text-white/15">
            CREWCMD v0.2.0 · crewcmd.dev
          </span>
        </div>
      </div>
    </div>
  );
}
