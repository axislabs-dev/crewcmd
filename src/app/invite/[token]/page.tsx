"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const { data: session, status } = useSession();
  const [state, setState] = useState<"loading" | "success" | "error" | "login">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (status === "loading") return;

    if (!session) {
      setState("login");
      return;
    }

    // Accept the invite
    fetch("/api/users/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setState("success");
          setMessage(`Welcome! You've been granted ${data.role} access.`);
        } else {
          setState("error");
          setMessage(data.error || "Failed to accept invite");
        }
      })
      .catch(() => {
        setState("error");
        setMessage("Network error. Please try again.");
      });
  }, [session, status, token]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      {state === "loading" && (
        <>
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-neo/30 border-t-neo" />
          <p className="font-mono text-sm text-white/40">Processing invite...</p>
        </>
      )}

      {state === "login" && (
        <>
          <div className="mb-6 text-5xl">🔑</div>
          <h1 className="mb-2 font-mono text-xl font-bold tracking-wider text-white/90">
            INVITE LINK
          </h1>
          <p className="mb-6 max-w-sm font-mono text-sm text-white/40">
            Sign in with your GitHub account to accept this invite.
          </p>
          <a
            href="/"
            className="rounded-lg border border-neo/30 bg-neo/10 px-6 py-2.5 font-mono text-xs font-bold tracking-wider text-neo transition hover:bg-neo/20"
          >
            SIGN IN WITH GITHUB
          </a>
        </>
      )}

      {state === "success" && (
        <>
          <div className="mb-6 text-5xl">✅</div>
          <h1 className="mb-2 font-mono text-xl font-bold tracking-wider text-white/90">
            ACCESS GRANTED
          </h1>
          <p className="mb-6 font-mono text-sm text-white/40">{message}</p>
          <a
            href="/dashboard"
            className="rounded-lg border border-neo/30 bg-neo/10 px-6 py-2.5 font-mono text-xs font-bold tracking-wider text-neo transition hover:bg-neo/20"
          >
            ENTER MISSION CONTROL
          </a>
        </>
      )}

      {state === "error" && (
        <>
          <div className="mb-6 text-5xl">⚠️</div>
          <h1 className="mb-2 font-mono text-xl font-bold tracking-wider text-white/90">
            INVITE ERROR
          </h1>
          <p className="mb-6 font-mono text-sm text-red-400/70">{message}</p>
          <a
            href="/"
            className="rounded-lg border border-white/10 bg-white/[0.04] px-6 py-2 font-mono text-xs tracking-wider text-white/50 transition hover:border-white/20 hover:text-white/70"
          >
            ← BACK TO LOGIN
          </a>
        </>
      )}
    </div>
  );
}
