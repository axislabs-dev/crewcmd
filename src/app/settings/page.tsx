"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { Avatar } from "@/components/avatar";
import { ThemeToggle } from "@/components/theme-toggle";

interface Profile {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  role: string;
  hasPassword: boolean;
}

interface FlashMessage {
  type: "success" | "error";
  text: string;
}

const inputClassName = "w-full rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)] focus:bg-[var(--accent-soft)]";
const cardClassName = "glass-card border border-[var(--border-subtle)] p-5 sm:p-6";

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<FlashMessage | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadProfile();
  }, []);

  const roleLabel = useMemo(() => profile?.role?.replaceAll("_", " ").toUpperCase() ?? "USER", [profile?.role]);

  async function loadProfile() {
    setLoading(true);
    try {
      const res = await fetch("/api/user/profile", { cache: "no-store" });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to load settings");
      }

      setProfile(data);
      setName(data.name ?? "");
      setEmail(data.email ?? "");
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to load settings" });
    } finally {
      setLoading(false);
    }
  }

  async function handleProfileSave() {
    setSavingProfile(true);
    setMessage(null);

    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save profile");
      }

      setProfile(data);
      setMessage({ type: "success", text: "Profile updated. Refresh the page to see header changes everywhere." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to save profile" });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handlePasswordSave() {
    setSavingPassword(true);
    setMessage(null);

    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to update password");
      }

      setProfile(data);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage({ type: "success", text: "Password updated." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to update password" });
    } finally {
      setSavingPassword(false);
    }
  }

  async function uploadAvatar(file: File) {
    setUploadingAvatar(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to upload avatar");
      }

      setProfile(data);
      setMessage({ type: "success", text: "Avatar updated." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to upload avatar" });
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleAvatarRemove() {
    setUploadingAvatar(true);
    setMessage(null);

    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: null }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to remove avatar");
      }

      setProfile(data);
      setMessage({ type: "success", text: "Avatar removed." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Failed to remove avatar" });
    } finally {
      setUploadingAvatar(false);
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      void uploadAvatar(file);
    }
  }

  function onDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void uploadAvatar(file);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-5xl items-center justify-center px-4 py-12">
        <div className="h-10 w-10 animate-pulse rounded-full bg-[var(--accent)]/40" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <p className="text-xs font-semibold tracking-[0.25em] text-[var(--text-tertiary)]">SETTINGS</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-[var(--text-primary)]">Your account</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
          Manage your identity, sign-in details, avatar, and visual preferences from one place.
        </p>
      </div>

      {message && (
        <div className={`mb-6 rounded-xl border px-4 py-3 text-sm ${message.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
          {message.text}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-6">
          <div className={cardClassName}>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Profile</h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">Update the name and email your team sees.</p>
              </div>
              <div className="inline-flex rounded-full border border-[var(--border-medium)] px-3 py-1 text-[10px] font-semibold tracking-[0.2em] text-[var(--text-tertiary)]">
                {roleLabel}
              </div>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs tracking-wide text-[var(--text-tertiary)]">NAME</span>
                <input className={inputClassName} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs tracking-wide text-[var(--text-tertiary)]">EMAIL</span>
                <input className={inputClassName} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>
            </div>

            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => void handleProfileSave()} disabled={savingProfile} className="rounded-xl border border-[var(--accent-medium)] bg-[var(--accent-soft)] px-4 py-2 text-sm font-medium text-[var(--accent)] transition hover:border-[var(--accent)] disabled:opacity-50">
                {savingProfile ? "Saving..." : "Save profile"}
              </button>
            </div>
          </div>

          <div className={cardClassName}>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Password</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {profile?.hasPassword ? "Change your sign-in password safely." : "This account does not support password changes yet."}
              </p>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-xs tracking-wide text-[var(--text-tertiary)]">CURRENT PASSWORD</span>
                <input className={inputClassName} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} disabled={!profile?.hasPassword} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs tracking-wide text-[var(--text-tertiary)]">NEW PASSWORD</span>
                <input className={inputClassName} type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} disabled={!profile?.hasPassword} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs tracking-wide text-[var(--text-tertiary)]">CONFIRM PASSWORD</span>
                <input className={inputClassName} type="password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} disabled={!profile?.hasPassword} />
              </label>
            </div>

            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => void handlePasswordSave()} disabled={!profile?.hasPassword || savingPassword} className="rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50">
                {savingPassword ? "Updating..." : "Update password"}
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className={cardClassName}>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Avatar</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Upload, replace, or remove the image used across your workspace.</p>

            <div className="mt-6 flex flex-col items-center gap-4 text-center">
              <Avatar src={profile?.avatarUrl} alt={profile?.name || profile?.email || "User"} size="xl" className="h-24 w-24 text-xl" />
              <button type="button" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragActive(true); }} onDragLeave={() => setDragActive(false)} onDrop={onDrop} className={`w-full rounded-2xl border border-dashed px-4 py-6 text-sm transition ${dragActive ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--border-medium)] bg-[var(--bg-surface-hover)] text-[var(--text-secondary)]"}`} disabled={uploadingAvatar}>
                {uploadingAvatar ? "Uploading..." : "Drop an image here or click to upload"}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
              <div className="flex w-full gap-3">
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingAvatar} className="flex-1 rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50">
                  {profile?.avatarUrl ? "Replace avatar" : "Upload avatar"}
                </button>
                <button type="button" onClick={() => void handleAvatarRemove()} disabled={!profile?.avatarUrl || uploadingAvatar} className="flex-1 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2 text-sm font-medium text-red-300 transition hover:border-red-500/40 disabled:opacity-50">
                  Remove avatar
                </button>
              </div>
            </div>
          </div>

          <div className={cardClassName}>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Preferences</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Pick the interface theme that feels right for your command center.</p>
            <div className="mt-4 rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] p-3">
              <ThemeToggle />
            </div>
          </div>

          <div className={cardClassName}>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Session</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Finished making changes? End this session cleanly.</p>
            <button type="button" onClick={() => signOut({ callbackUrl: "/" })} className="mt-4 w-full rounded-xl border border-[var(--border-medium)] bg-[var(--bg-surface-hover)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]">
              Sign out
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
