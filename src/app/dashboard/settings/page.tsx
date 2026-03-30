"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";

interface User {
  id: string;
  githubUsername: string;
  role: string;
  invitedBy: string | null;
  invitedAt: string;
  acceptedAt: string | null;
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");
  const [inviteLink, setInviteLink] = useState("");
  const [error, setError] = useState("");
  const [inviting, setInviting] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) setUsers(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInviteLink("");
    setInviting(true);

    try {
      const res = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubUsername: inviteUsername, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to invite user");
      } else {
        setInviteLink(data.inviteLink);
        setInviteUsername("");
        fetchUsers();
      }
    } catch {
      setError("Network error");
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (id: string, username: string) => {
    if (!confirm(`Remove ${username}? They will lose access.`)) return;
    try {
      const res = await fetch("/api/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) fetchUsers();
      else {
        const data = await res.json();
        alert(data.error || "Failed to remove user");
      }
    } catch {
      alert("Network error");
    }
  };

  const currentUsername = (session?.user as Record<string, unknown> | undefined)?.username;

  const roleBadgeColor: Record<string, string> = {
    super_admin: "text-red-400 border-red-400/30 bg-red-400/10",
    admin: "text-amber-400 border-amber-400/30 bg-amber-400/10",
    viewer: "text-blue-400 border-blue-400/30 bg-blue-400/10",
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-8">
        <h1 className="font-mono text-xl font-bold tracking-wider text-white/90">
          USER MANAGEMENT
        </h1>
        <p className="mt-1 font-mono text-xs text-white/40">
          Invite users and manage access roles
        </p>
      </div>

      {/* Invite Form */}
      <div className="glass-card mb-8 p-6" style={{ borderColor: "rgba(0, 240, 255, 0.1)" }}>
        <h2 className="mb-4 font-mono text-sm font-bold tracking-wider text-white/70">
          INVITE USER
        </h2>
        <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">
              GITHUB USERNAME
            </label>
            <input
              type="text"
              value={inviteUsername}
              onChange={(e) => setInviteUsername(e.target.value)}
              placeholder="username"
              required
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white/80 placeholder:text-white/20 focus:border-neo/40 focus:outline-none"
            />
          </div>
          <div className="w-36">
            <label className="mb-1 block font-mono text-[10px] tracking-wider text-white/30">
              ROLE
            </label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm text-white/80 focus:border-neo/40 focus:outline-none"
            >
              <option value="viewer">Viewer</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={inviting}
            className="rounded-lg border border-neo/30 bg-neo/10 px-5 py-2 font-mono text-xs font-bold tracking-wider text-neo transition hover:bg-neo/20 disabled:opacity-50"
          >
            {inviting ? "INVITING..." : "INVITE"}
          </button>
        </form>

        {error && (
          <p className="mt-3 font-mono text-xs text-red-400">{error}</p>
        )}

        {inviteLink && (
          <div className="mt-4 rounded-lg border border-neo/20 bg-neo/5 p-3">
            <p className="mb-1 font-mono text-[10px] tracking-wider text-neo/60">
              INVITE LINK (share with the user):
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all font-mono text-xs text-neo/80">
                {inviteLink}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(inviteLink)}
                className="shrink-0 rounded border border-neo/20 px-2 py-1 font-mono text-[10px] text-neo/60 hover:bg-neo/10"
              >
                COPY
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Users Table */}
      <div className="glass-card p-6" style={{ borderColor: "rgba(0, 240, 255, 0.1)" }}>
        <h2 className="mb-4 font-mono text-sm font-bold tracking-wider text-white/70">
          CURRENT USERS
        </h2>

        {loading ? (
          <p className="font-mono text-xs text-white/30">Loading...</p>
        ) : users.length === 0 ? (
          <p className="font-mono text-xs text-white/30">No users found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="py-2 text-left font-mono text-[10px] tracking-wider text-white/30">
                    USERNAME
                  </th>
                  <th className="py-2 text-left font-mono text-[10px] tracking-wider text-white/30">
                    ROLE
                  </th>
                  <th className="py-2 text-left font-mono text-[10px] tracking-wider text-white/30">
                    STATUS
                  </th>
                  <th className="py-2 text-left font-mono text-[10px] tracking-wider text-white/30">
                    INVITED BY
                  </th>
                  <th className="py-2 text-right font-mono text-[10px] tracking-wider text-white/30">
                    ACTIONS
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-white/[0.03] last:border-0"
                  >
                    <td className="py-3 font-mono text-sm text-white/70">
                      {user.githubUsername}
                      {user.githubUsername === currentUsername && (
                        <span className="ml-2 text-[10px] text-neo/50">(you)</span>
                      )}
                    </td>
                    <td className="py-3">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wider ${roleBadgeColor[user.role] || "text-white/40 border-white/10"}`}
                      >
                        {user.role.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 font-mono text-xs">
                      {user.acceptedAt ? (
                        <span className="text-green-400/70">Active</span>
                      ) : (
                        <span className="text-yellow-400/70">Pending</span>
                      )}
                    </td>
                    <td className="py-3 font-mono text-xs text-white/40">
                      {user.invitedBy || "—"}
                    </td>
                    <td className="py-3 text-right">
                      {user.githubUsername !== currentUsername &&
                        user.role !== "super_admin" && (
                          <button
                            onClick={() =>
                              handleRemove(user.id, user.githubUsername)
                            }
                            className="font-mono text-[10px] tracking-wider text-red-400/60 transition hover:text-red-400"
                          >
                            REMOVE
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
