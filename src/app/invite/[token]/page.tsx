"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

/** Legacy invite page — redirects to the new /join flow */
export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/join?token=${encodeURIComponent(token)}`);
  }, [token, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-neo/30 border-t-neo" />
      <p className="text-sm text-[var(--text-tertiary)]">Redirecting...</p>
    </div>
  );
}
