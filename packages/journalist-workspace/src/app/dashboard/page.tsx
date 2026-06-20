"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import WorkspaceShell from "@/components/WorkspaceShell"

interface Case {
  id: string
  submission_ref: string
  status: "new" | "active" | "closed"
  created_at: string
}

function StatusBadge({ status }: { status: Case["status"] }) {
  const styles: Record<Case["status"], string> = {
    new: "bg-yellow-500/20 text-yellow-400",
    active: "bg-blue-500/20 text-blue-400",
    closed: "bg-gray-500/20 text-gray-400",
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? styles.closed}`}
    >
      {status}
    </span>
  )
}

function SkeletonRow() {
  return (
    <tr className="border-b border-border">
      {[1, 2, 3].map((i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
        </td>
      ))}
    </tr>
  )
}

export default function DashboardPage() {
  const [cases, setCases] = useState<Case[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const token = sessionStorage.getItem("session")
    if (!token) return // WorkspaceShell handles redirect

    fetch("/api/cases", { headers: { "x-session": token } })
      .then((r) => r.json())
      .then(({ cases, error }) => {
        if (error) {
          setError(error)
        } else {
          setCases(cases ?? [])
        }
      })
      .catch(() => setError("Failed to load cases"))
  }, [])

  return (
    <WorkspaceShell title="Cases">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">All Cases</h2>
          {cases !== null && (
            <span className="text-sm text-muted-foreground">
              {cases.length} {cases.length === 1 ? "case" : "cases"}
            </span>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Ref
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {cases === null ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : cases.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    No cases assigned to you yet.
                  </td>
                </tr>
              ) : (
                cases.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/cases/${c.id}`}
                        className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                      >
                        {c.submission_ref
                          ? c.submission_ref.substring(0, 16) +
                            (c.submission_ref.length > 16 ? "…" : "")
                          : c.id.substring(0, 8) + "…"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {c.created_at
                        ? new Date(c.created_at).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </WorkspaceShell>
  )
}
