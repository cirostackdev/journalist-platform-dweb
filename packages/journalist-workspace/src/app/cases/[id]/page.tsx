"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import WorkspaceShell from "@/components/WorkspaceShell"

interface Note {
  id: string
  author_id: string
  created_at: string
  body: string
}

interface CaseData {
  id: string
  submission_ref: string
  status: "new" | "active" | "closed"
  created_at: string
  assigned_to?: string
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
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

export default function CasePage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { id } = params

  const [caseData, setCaseData] = useState<CaseData | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Note form
  const [noteText, setNoteText] = useState("")
  const [noteLoading, setNoteLoading] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  // Reply form
  const [replyText, setReplyText] = useState("")
  const [replyLoading, setReplyLoading] = useState(false)
  const [replyMsg, setReplyMsg] = useState<string | null>(null)

  // Status
  const [selectedStatus, setSelectedStatus] = useState<string>("new")
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  // Assign (admin only)
  const [assignUserId, setAssignUserId] = useState("")
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignMsg, setAssignMsg] = useState<string | null>(null)
  const [role, setRole] = useState<string | null>(null)

  function getToken(): string {
    return sessionStorage.getItem("session") ?? ""
  }

  async function loadCase() {
    const token = getToken()
    if (!token) return

    try {
      const res = await fetch(`/api/cases/${id}`, {
        headers: { "x-session": token },
      })
      const data = await res.json()
      if (data.error) {
        setLoadError(data.error)
      } else {
        setCaseData(data.case)
        setNotes(data.notes ?? [])
        setSelectedStatus(data.case?.status ?? "new")
      }
    } catch {
      setLoadError("Failed to load case")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const storedRole = sessionStorage.getItem("role")
    setRole(storedRole)
    loadCase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleAddNote(e: React.FormEvent) {
    e.preventDefault()
    if (!noteText.trim()) return
    setNoteLoading(true)
    setNoteError(null)
    try {
      const res = await fetch(`/api/cases/${id}/reply/notes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session": getToken(),
        },
        body: JSON.stringify({ text: noteText }),
      })
      const data = await res.json()
      if (data.error) {
        setNoteError(data.error)
      } else {
        setNoteText("")
        await loadCase()
      }
    } catch {
      setNoteError("Failed to add note")
    } finally {
      setNoteLoading(false)
    }
  }

  async function handleReply(e: React.FormEvent) {
    e.preventDefault()
    if (!replyText.trim()) return
    setReplyLoading(true)
    setReplyMsg(null)
    try {
      const res = await fetch(`/api/cases/${id}/reply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-session": getToken(),
        },
        body: JSON.stringify({ text: replyText }),
      })
      const data = await res.json()
      if (data.error) {
        setReplyMsg("Error: " + data.error)
      } else {
        setReplyText("")
        setReplyMsg("Reply sent successfully.")
      }
    } catch {
      setReplyMsg("Failed to send reply")
    } finally {
      setReplyLoading(false)
    }
  }

  async function handleUpdateStatus() {
    setStatusLoading(true)
    setStatusMsg(null)
    try {
      const res = await fetch(`/api/cases/${id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-session": getToken(),
        },
        body: JSON.stringify({ status: selectedStatus }),
      })
      const data = await res.json()
      if (data.error) {
        setStatusMsg("Error: " + data.error)
      } else {
        setStatusMsg("Status updated.")
        await loadCase()
      }
    } catch {
      setStatusMsg("Failed to update status")
    } finally {
      setStatusLoading(false)
    }
  }

  async function handleAssign() {
    if (!assignUserId.trim()) return
    setAssignLoading(true)
    setAssignMsg(null)
    try {
      const res = await fetch(`/api/cases/${id}/assign`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-session": getToken(),
        },
        body: JSON.stringify({ userId: assignUserId }),
      })
      const data = await res.json()
      if (data.error) {
        setAssignMsg("Error: " + data.error)
      } else {
        setAssignMsg("Case assigned.")
        setAssignUserId("")
        await loadCase()
      }
    } catch {
      setAssignMsg("Failed to assign case")
    } finally {
      setAssignLoading(false)
    }
  }

  async function handleCreateArticle() {
    const token = getToken()
    try {
      const res = await fetch(`/api/cases/${id}/articles`, {
        method: "POST",
        headers: { "x-session": token },
      })
      const data = await res.json()
      if (data.articleId) {
        router.push(`/articles/${data.articleId}`)
      }
    } catch {
      // ignore
    }
  }

  const isAdmin = role === "admin"
  const caseTitle = caseData?.submission_ref
    ? `Case: ${caseData.submission_ref.substring(0, 16)}${caseData.submission_ref.length > 16 ? "…" : ""}`
    : `Case: ${id.substring(0, 8)}…`

  return (
    <WorkspaceShell title={caseTitle}>
      <div className="max-w-3xl space-y-6">
        {/* Back link */}
        <a
          href="/dashboard"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to cases
        </a>

        {loadError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
            {loadError}
          </div>
        )}

        {loading && (
          <div className="rounded-xl border border-border bg-card p-6 space-y-3 animate-pulse">
            <div className="h-5 bg-muted rounded w-1/3" />
            <div className="h-4 bg-muted rounded w-1/2" />
          </div>
        )}

        {caseData && (
          <>
            {/* Case header */}
            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground break-all">
                  {caseData.submission_ref || caseData.id}
                </span>
                <StatusBadge status={caseData.status} />
              </div>
              <p className="text-xs text-muted-foreground">
                Created:{" "}
                {new Date(caseData.created_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
              {caseData.assigned_to && (
                <p className="text-xs text-muted-foreground">
                  Assigned to: <span className="text-foreground">{caseData.assigned_to}</span>
                </p>
              )}
            </div>

            {/* Notes */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Notes</h2>
              {notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                <div className="space-y-2">
                  {notes.map((note) => (
                    <div
                      key={note.id}
                      className="rounded-xl border border-border bg-card p-3 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {note.author_id}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(note.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{note.body}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Add note form */}
              <form onSubmit={handleAddNote} className="space-y-2">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  rows={3}
                  placeholder="Add an internal note…"
                  className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
                {noteError && (
                  <p className="text-xs text-red-400">{noteError}</p>
                )}
                <button
                  type="submit"
                  disabled={noteLoading || !noteText.trim()}
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  {noteLoading ? "Adding…" : "Add Note"}
                </button>
              </form>
            </section>

            {/* Reply to source */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Reply to Source</h2>
              <form onSubmit={handleReply} className="space-y-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  rows={3}
                  placeholder="Write a reply to the source…"
                  className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
                {replyMsg && (
                  <p
                    className={`text-xs ${replyMsg.startsWith("Error") ? "text-red-400" : "text-green-400"}`}
                  >
                    {replyMsg}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={replyLoading || !replyText.trim()}
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  {replyLoading ? "Sending…" : "Send Reply"}
                </button>
              </form>
            </section>

            {/* Status */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Update Status</h2>
              <div className="flex items-center gap-3 flex-wrap">
                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="new">New</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
                <button
                  onClick={handleUpdateStatus}
                  disabled={statusLoading}
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  {statusLoading ? "Updating…" : "Update Status"}
                </button>
                {statusMsg && (
                  <span
                    className={`text-xs ${statusMsg.startsWith("Error") ? "text-red-400" : "text-green-400"}`}
                  >
                    {statusMsg}
                  </span>
                )}
              </div>
            </section>

            {/* Assign (admin only) */}
            {isAdmin && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-foreground">Assign Case</h2>
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    type="text"
                    value={assignUserId}
                    onChange={(e) => setAssignUserId(e.target.value)}
                    placeholder="User ID"
                    className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    onClick={handleAssign}
                    disabled={assignLoading || !assignUserId.trim()}
                    className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                  >
                    {assignLoading ? "Assigning…" : "Assign"}
                  </button>
                  {assignMsg && (
                    <span
                      className={`text-xs ${assignMsg.startsWith("Error") ? "text-red-400" : "text-green-400"}`}
                    >
                      {assignMsg}
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* Create article */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">Article</h2>
              <button
                onClick={handleCreateArticle}
                className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Create Article from Case
              </button>
            </section>
          </>
        )}
      </div>
    </WorkspaceShell>
  )
}
