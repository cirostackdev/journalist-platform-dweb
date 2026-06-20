"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { WorkspaceShell } from "@/components/WorkspaceShell"
import { Loader2, AlertCircle } from "lucide-react"

type User = { id: string; username: string; role: string; created_at: string }
type NewUserResult = { userId: string; totpSecret: string }

export default function AdminPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newUsername, setNewUsername] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [newRole, setNewRole] = useState<"journalist" | "editor" | "admin">("journalist")
  const [createResult, setCreateResult] = useState<NewUserResult | null>(null)
  const [resetResult, setResetResult] = useState<{ username: string; totpSecret: string } | null>(null)

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (sessionStorage.getItem("role") !== "admin") {
        router.replace("/dashboard")
        return
      }
    }
    fetchUsers()
  }, [router])

  async function fetchUsers() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/admin/users")
      if (!r.ok) {
        setError("Failed to load users")
        return
      }
      setUsers(await r.json())
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    setCreateResult(null)
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword, role: newRole }),
      })
      const body = await r.json()
      if (!r.ok) {
        setError(body.error || "Failed to create user")
        return
      }
      setCreateResult(body)
      setNewUsername("")
      setNewPassword("")
      setNewRole("journalist")
      await fetchUsers()
    } catch {
      setError("Network error")
    } finally {
      setCreating(false)
    }
  }

  async function handleResetTotp(user: User) {
    if (!window.confirm(`Reset TOTP for ${user.username}? They will need to re-scan a new QR code.`)) return
    try {
      const r = await fetch(`/api/admin/users/${user.id}/reset-totp`, { method: "POST" })
      const body = await r.json()
      if (!r.ok) {
        setError(body.error || "Reset failed")
        return
      }
      setResetResult({ username: user.username, totpSecret: body.totpSecret })
    } catch {
      setError("Network error")
    }
  }

  return (
    <WorkspaceShell title="Admin">
      <div className="space-y-6">
        {error && (
          <div className="flex items-center gap-3 bg-red-500/10 border border-red-900 rounded-lg px-4 py-3 text-red-200">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Create user form */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Create user</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Username</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  required
                  autoComplete="off"
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Role</label>
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value as any)}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                >
                  <option value="journalist">Journalist</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={creating}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                  {creating ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          </form>

          {createResult && (
            <div className="mt-6 p-4 bg-green-500/10 border border-green-900 rounded-lg">
              <p className="text-sm font-semibold text-green-200 mb-2">User created — TOTP secret (show this once):</p>
              <code className="block font-mono text-xs text-green-300 bg-black/30 rounded px-3 py-2 mb-3 break-all">
                {createResult.totpSecret}
              </code>
              <p className="text-xs text-gray-400 mb-3">
                Enter this secret into an authenticator app (or generate a QR code from it). It will not be shown again.
              </p>
              <button
                onClick={() => setCreateResult(null)}
                className="text-xs text-green-300 hover:text-green-200 font-medium"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Reset TOTP result */}
        {resetResult && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 border-green-900 bg-green-500/10">
            <p className="text-sm font-semibold text-green-200 mb-2">
              New TOTP secret for {resetResult.username}:
            </p>
            <code className="block font-mono text-xs text-green-300 bg-black/30 rounded px-3 py-2 mb-3 break-all">
              {resetResult.totpSecret}
            </code>
            <p className="text-xs text-gray-400 mb-3">
              User must re-scan this in their authenticator app.
            </p>
            <button
              onClick={() => setResetResult(null)}
              className="text-xs text-green-300 hover:text-green-200 font-medium"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* User list */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="p-6 border-b border-gray-700">
            <h2 className="text-lg font-semibold text-white">Users ({users.length})</h2>
          </div>
          {loading ? (
            <div className="p-6 text-center text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              <p className="text-sm">Loading users…</p>
            </div>
          ) : users.length === 0 ? (
            <div className="p-6 text-center text-gray-400">
              <p className="text-sm">No users.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {users.map(u => (
                <div key={u.id} className="flex items-center justify-between px-6 py-4 hover:bg-gray-700/30 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{u.username}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(u.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className="mx-4 inline-flex items-center rounded-full bg-gray-700 px-2 py-1 text-xs font-medium text-gray-300">
                    {u.role}
                  </span>
                  <button
                    onClick={() => handleResetTotp(u)}
                    className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors"
                  >
                    Reset TOTP
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  )
}
