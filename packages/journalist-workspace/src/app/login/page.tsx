"use client"
import { useState, FormEvent } from "react"
import { useRouter } from "next/navigation"
import { Shield, Loader2 } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError("")
    const data = Object.fromEntries(new FormData(e.currentTarget))
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      const body = await res.json()
      if (body.token) {
        sessionStorage.setItem("session", body.token)
        sessionStorage.setItem("role", body.role ?? "journalist")
        router.replace("/dashboard")
      } else {
        setError(body.error ?? "Login failed")
      }
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <Shield className="w-8 h-8 text-indigo-400" />
          <span className="text-xl font-bold text-white">Newsroom</span>
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h1 className="text-lg font-semibold text-white mb-5">Sign in</h1>
          <form onSubmit={onSubmit} className="space-y-4" autoComplete="off">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Username
              </label>
              <input
                name="username"
                type="text"
                required
                autoComplete="off"
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                Password
              </label>
              <input
                name="password"
                type="password"
                required
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                TOTP Code
              </label>
              <input
                name="totpToken"
                type="text"
                required
                inputMode="numeric"
                maxLength={6}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
