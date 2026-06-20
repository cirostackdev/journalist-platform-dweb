"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { WorkspaceShell } from "@/components/WorkspaceShell"
import { FolderOpen } from "lucide-react"

type Case = {
  id: string
  submission_ref: string
  status: string
  created_at: string
  assigned_to: string | null
}

const STATUS_BADGE: Record<string, string> = {
  new: "bg-yellow-500/20 text-yellow-300",
  active: "bg-blue-500/20 text-blue-300",
  closed: "bg-gray-500/20 text-gray-400",
}

export default function DashboardPage() {
  const router = useRouter()
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!sessionStorage.getItem("role")) {
      router.replace("/login")
      return
    }
    fetch("/api/cases")
      .then((r) => r.json())
      .then(({ cases }) => {
        setCases(cases ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [router])

  return (
    <WorkspaceShell title="Cases">
      {loading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : cases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-500">
          <FolderOpen className="w-10 h-10 mb-3" />
          <p className="text-sm">No cases yet.</p>
        </div>
      ) : (
        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="divide-y divide-gray-700">
            {cases.map((c) => (
              <Link
                key={c.id}
                href={`/cases/${c.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-700/50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-mono text-gray-200 truncate">
                    {c.submission_ref}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {new Date(c.created_at).toLocaleDateString()}
                  </p>
                  {c.assigned_to && (
                    <p className="text-xs text-gray-500 mt-0.5">→ {c.assigned_to}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      STATUS_BADGE[c.status] ?? "bg-gray-500/20 text-gray-400"
                    }`}
                  >
                    {c.status}
                  </span>
                  {!c.assigned_to && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-500/20 text-orange-300">
                      unassigned
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </WorkspaceShell>
  )
}
