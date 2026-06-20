"use client"

import { useEffect, useState } from "react"
import WorkspaceShell from "@/components/WorkspaceShell"

interface Article {
  id: string
  case_id: string
  author_id: string
  status: "draft" | "review" | "published"
  created_at: string
  body?: string
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-yellow-500/20 text-yellow-400",
    review: "bg-blue-500/20 text-blue-400",
    published: "bg-green-500/20 text-green-400",
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? "bg-gray-500/20 text-gray-400"}`}
    >
      {status}
    </span>
  )
}

export default function ArticleEditorPage({ params }: { params: { id: string } }) {
  const { id } = params

  const [article, setArticle] = useState<Article | null>(null)
  const [body, setBody] = useState("")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [saveLoading, setSaveLoading] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewMsg, setReviewMsg] = useState<string | null>(null)

  const [publishLoading, setPublishLoading] = useState(false)
  const [publishMsg, setPublishMsg] = useState<string | null>(null)

  const [role, setRole] = useState<string | null>(null)

  function getToken(): string {
    return sessionStorage.getItem("session") ?? ""
  }

  async function loadArticle() {
    const token = getToken()
    if (!token) return
    try {
      const res = await fetch(`/api/articles/${id}`, {
        headers: { "x-session": token },
      })
      const data = await res.json()
      if (data.error) {
        setLoadError(data.error)
      } else {
        setArticle(data.article)
        setBody(data.article?.body ?? "")
      }
    } catch {
      setLoadError("Failed to load article")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const storedRole = sessionStorage.getItem("role")
    setRole(storedRole)
    loadArticle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaveLoading(true)
    setSaveMsg(null)
    try {
      const res = await fetch(`/api/articles/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-session": getToken(),
        },
        body: JSON.stringify({ body }),
      })
      const data = await res.json()
      if (data.error) {
        setSaveMsg("Error: " + data.error)
      } else {
        setSaveMsg("Saved.")
        await loadArticle()
      }
    } catch {
      setSaveMsg("Failed to save")
    } finally {
      setSaveLoading(false)
    }
  }

  async function handleSubmitForReview() {
    setReviewLoading(true)
    setReviewMsg(null)
    try {
      const res = await fetch(`/api/articles/${id}/review`, {
        method: "PATCH",
        headers: { "x-session": getToken() },
      })
      const data = await res.json()
      if (data.error) {
        setReviewMsg("Error: " + data.error)
      } else {
        setReviewMsg("Submitted for review.")
        await loadArticle()
      }
    } catch {
      setReviewMsg("Failed to submit for review")
    } finally {
      setReviewLoading(false)
    }
  }

  async function handlePublish() {
    setPublishLoading(true)
    setPublishMsg(null)
    try {
      const res = await fetch(`/api/articles/${id}/publish`, {
        method: "POST",
        headers: { "x-session": getToken() },
      })
      const data = await res.json()
      if (data.error) {
        setPublishMsg("Error: " + data.error)
      } else {
        setPublishMsg("Article published.")
        await loadArticle()
      }
    } catch {
      setPublishMsg("Failed to publish")
    } finally {
      setPublishLoading(false)
    }
  }

  const isEditorOrAdmin = role === "editor" || role === "admin"
  const articleTitle = article ? `Article: ${id.substring(0, 8)}…` : "Article Editor"

  return (
    <WorkspaceShell title={articleTitle}>
      <div className="max-w-3xl space-y-6">
        {/* Back link */}
        {article?.case_id && (
          <a
            href={`/cases/${article.case_id}`}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to case
          </a>
        )}

        {loadError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
            {loadError}
          </div>
        )}

        {loading && (
          <div className="rounded-xl border border-border bg-card p-6 space-y-3 animate-pulse">
            <div className="h-5 bg-muted rounded w-1/3" />
            <div className="h-32 bg-muted rounded" />
          </div>
        )}

        {article && (
          <>
            {/* Article header */}
            <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between flex-wrap gap-2">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-mono">ID: {article.id}</p>
                <p className="text-xs text-muted-foreground">
                  Author: {article.author_id} &middot; Created:{" "}
                  {new Date(article.created_at).toLocaleDateString()}
                </p>
              </div>
              <StatusBadge status={article.status} />
            </div>

            {/* Editor */}
            <form onSubmit={handleSave} className="space-y-3">
              <label className="block text-sm font-semibold text-foreground">
                Article body (Markdown)
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={18}
                placeholder="Write your article in Markdown…"
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono resize-y"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="submit"
                  disabled={saveLoading}
                  className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  {saveLoading ? "Saving…" : "Save"}
                </button>
                {saveMsg && (
                  <span
                    className={`text-xs ${saveMsg.startsWith("Error") ? "text-red-400" : "text-green-400"}`}
                  >
                    {saveMsg}
                  </span>
                )}
              </div>
            </form>

            {/* Submit for review (draft only) */}
            {article.status === "draft" && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-foreground">Submit for Review</h2>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleSubmitForReview}
                    disabled={reviewLoading}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:bg-blue-500 transition-colors"
                  >
                    {reviewLoading ? "Submitting…" : "Submit for Review"}
                  </button>
                  {reviewMsg && (
                    <span
                      className={`text-xs ${reviewMsg.startsWith("Error") ? "text-red-400" : "text-green-400"}`}
                    >
                      {reviewMsg}
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* Publish (review + editor/admin only) */}
            {article.status === "review" && isEditorOrAdmin && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-foreground">Publish</h2>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handlePublish}
                    disabled={publishLoading}
                    className="bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed hover:bg-green-600 transition-colors"
                  >
                    {publishLoading ? "Publishing…" : "Publish Article"}
                  </button>
                  {publishMsg && (
                    <span
                      className={`text-xs ${publishMsg.startsWith("Error") ? "text-red-400" : "text-green-400"}`}
                    >
                      {publishMsg}
                    </span>
                  )}
                </div>
              </section>
            )}

            {article.status === "published" && (
              <div className="rounded-xl border border-green-500/20 bg-green-500/10 p-4 text-sm text-green-400">
                This article has been published.
              </div>
            )}
          </>
        )}
      </div>
    </WorkspaceShell>
  )
}
