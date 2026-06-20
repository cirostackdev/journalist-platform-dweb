"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { WorkspaceShell } from "@/components/WorkspaceShell"
import { Loader2, ArrowLeft } from "lucide-react"

interface Article {
  id: string
  case_id: string
  author_id: string
  status: "draft" | "review" | "published"
  created_at: string
  body?: string
}

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-orange-500/20 text-orange-300",
  review: "bg-purple-500/20 text-purple-300",
  published: "bg-green-500/20 text-green-300",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        STATUS_BADGE[status] ?? "bg-gray-500/20 text-gray-400"
      }`}
    >
      {status}
    </span>
  )
}

export default function ArticleEditorPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const { id } = params

  const [article, setArticle] = useState<Article | null>(null)
  const [body, setBody] = useState("")
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<string | null>(null)

  const [saveLoading, setSaveLoading] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewMsg, setReviewMsg] = useState<string | null>(null)

  const [publishLoading, setPublishLoading] = useState(false)
  const [publishMsg, setPublishMsg] = useState<string | null>(null)

  function getToken() {
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
        // body is encrypted server-side; leave textarea blank for new content
        setBody(data.article?.body ?? "")
      }
    } catch {
      setLoadError("Failed to load article")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const token = sessionStorage.getItem("session")
    if (!token) {
      router.replace("/login")
      return
    }
    setRole(sessionStorage.getItem("role"))
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
  const isJournalist = role === "journalist"
  const articleTitle = article ? `Article: ${id.substring(0, 8)}…` : "Article Editor"

  return (
    <WorkspaceShell title={articleTitle}>
      <div className="max-w-3xl space-y-6">
        {article?.case_id && (
          <Link
            href={`/cases/${article.case_id}`}
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to case
          </Link>
        )}

        {loadError && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
            {loadError}
          </div>
        )}

        {loading && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-3 animate-pulse">
            <div className="h-5 bg-gray-700 rounded w-1/3" />
            <div className="h-32 bg-gray-700 rounded" />
          </div>
        )}

        {article && (
          <>
            {/* Article header */}
            <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex items-center justify-between flex-wrap gap-2">
              <div className="space-y-1">
                <p className="text-xs text-gray-500 font-mono">ID: {article.id}</p>
                <p className="text-xs text-gray-500">
                  Author: {article.author_id} &middot; Created:{" "}
                  {new Date(article.created_at).toLocaleDateString()}
                </p>
              </div>
              <StatusBadge status={article.status} />
            </div>

            {/* Editor */}
            <form onSubmit={handleSave} className="space-y-3">
              <label className="block text-sm font-semibold text-white">
                Article body (Markdown)
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={18}
                placeholder="Write your article in Markdown…"
                className="bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 w-full text-sm focus:outline-none focus:border-indigo-500 font-mono resize-y placeholder-gray-500"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="submit"
                  disabled={saveLoading}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  {saveLoading && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {saveLoading ? "Saving…" : "Save"}
                </button>
                {saveMsg && (
                  <span
                    className={`text-xs ${
                      saveMsg.startsWith("Error")
                        ? "text-red-400"
                        : "text-green-400"
                    }`}
                  >
                    {saveMsg}
                  </span>
                )}
              </div>
            </form>

            {/* Submit for review — journalist, draft only */}
            {article.status === "draft" && isJournalist && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-white">
                  Submit for Review
                </h2>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleSubmitForReview}
                    disabled={reviewLoading}
                    className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                  >
                    {reviewLoading && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    {reviewLoading ? "Submitting…" : "Submit for Review"}
                  </button>
                  {reviewMsg && (
                    <span
                      className={`text-xs ${
                        reviewMsg.startsWith("Error")
                          ? "text-red-400"
                          : "text-green-400"
                      }`}
                    >
                      {reviewMsg}
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* Publish — editor/admin, review status only */}
            {article.status === "review" && isEditorOrAdmin && (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold text-white">Publish</h2>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handlePublish}
                    disabled={publishLoading}
                    className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                  >
                    {publishLoading && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    )}
                    {publishLoading ? "Publishing…" : "Publish Article"}
                  </button>
                  {publishMsg && (
                    <span
                      className={`text-xs ${
                        publishMsg.startsWith("Error")
                          ? "text-red-400"
                          : "text-green-400"
                      }`}
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
