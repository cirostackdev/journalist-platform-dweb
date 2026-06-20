"use client"
import { useEffect, useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { WorkspaceShell } from "@/components/WorkspaceShell"
import { Play, Trash2, Upload } from "lucide-react"

type VideoItem = {
  id: string
  title: string
  description: string | null
  sourceType: "submission" | "upload"
  submissionId: string | null
  fileIndex: number | null
  durationSecs: number | null
  status: string
  publishedAt: string | null
  createdBy: string
  createdAt: string
}

type Tab = "all" | "sources" | "mine" | "published"

export default function VideosPage() {
  const router = useRouter()
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("all")
  const [role, setRole] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (typeof window !== "undefined") {
      const r = sessionStorage.getItem("role")
      if (!r) {
        router.replace("/login")
        return
      }
      setRole(r)
    }
    fetchVideos()
  }, [router])

  async function fetchVideos() {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/videos")
      if (!r.ok) {
        setError("Failed to load videos")
        setLoading(false)
        return
      }
      setVideos(await r.json())
    } catch {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadProgress("Uploading…")
    setError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const r = await fetch("/api/videos/upload", { method: "POST", body: form })
      const body = await r.json()
      if (!r.ok) {
        setError(body.error || "Upload failed")
        return
      }
      await fetchVideos()
    } catch {
      setError("Upload failed")
    } finally {
      setUploadProgress(null)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this video?")) return
    const r = await fetch(`/api/videos/${id}`, { method: "DELETE" })
    if (r.ok) {
      fetchVideos()
      return
    }
    const b = await r.json()
    setError(b.error || "Delete failed")
  }

  async function handleRetract(id: string) {
    if (!confirm("Retract this video from the publication site?")) return
    const r = await fetch(`/api/videos/${id}/retract`, { method: "POST" })
    if (r.ok) {
      fetchVideos()
      return
    }
    const b = await r.json()
    setError(b.error || "Retract failed")
  }

  async function handlePublish(id: string) {
    if (
      !confirm(
        "Publish? ffmpeg will transcode to HLS. This may take several minutes."
      )
    )
      return
    const r = await fetch(`/api/videos/${id}/publish`, { method: "POST" })
    const b = await r.json()
    if (!r.ok) {
      setError(b.error || "Publish failed")
      return
    }
    fetchVideos()
  }

  const filtered = videos.filter((v) => {
    if (tab === "sources") return v.sourceType === "submission"
    if (tab === "mine") return v.sourceType === "upload"
    if (tab === "published") return v.status === "published"
    return true
  })

  const statusColor = (s: string) => {
    if (s === "published") return "bg-green-500/20 text-green-300"
    if (s === "processing") return "bg-indigo-500/20 text-indigo-300"
    return "bg-yellow-500/20 text-yellow-300"
  }

  const canUpload = role === "journalist" || role === "admin"
  const canPublish = role === "editor" || role === "admin"

  return (
    <WorkspaceShell title="Videos">
      <div className="space-y-4">
        {/* Header with upload button */}
        {canUpload && (
          <div className="flex items-center justify-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="video/*,.mp4,.mov,.avi,.mkv,.webm"
              className="hidden"
              onChange={handleUpload}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!!uploadProgress}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {uploadProgress ?? "Upload video"}
            </button>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-700">
          <div className="flex gap-8">
            {(["all", "sources", "mine", "published"] as const).map((t) => {
              const count =
                t === "all"
                  ? videos.length
                  : t === "sources"
                    ? videos.filter((v) => v.sourceType === "submission").length
                    : t === "mine"
                      ? videos.filter((v) => v.sourceType === "upload").length
                      : videos.filter((v) => v.status === "published").length

              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`pb-3 text-sm font-medium transition-colors border-b-2 ${
                    tab === t
                      ? "text-white border-indigo-500"
                      : "text-gray-400 border-transparent hover:text-gray-300"
                  }`}
                >
                  {t === "all"
                    ? `All (${count})`
                    : t === "sources"
                      ? `From sources (${count})`
                      : t === "mine"
                        ? `My uploads (${count})`
                        : `Published (${count})`}
                </button>
              )
            })}
          </div>
        </div>

        {/* Video list */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <div className="text-center">
              <p className="text-sm">
                No videos{tab !== "all" ? ` in "${tab}"` : ""}.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 bg-gray-800/50">
                    <th className="px-4 py-3 text-left font-medium text-gray-300">
                      Title
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-300">
                      Source
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-300">
                      Duration
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-300">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-gray-300">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700">
                  {filtered.map((v) => (
                    <tr
                      key={v.id}
                      className="hover:bg-gray-700/30 transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-white truncate max-w-xs">
                        {v.title}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {v.sourceType === "submission"
                          ? "Source submission"
                          : "My upload"}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {v.durationSecs
                          ? `${Math.floor(v.durationSecs / 60)}:${String(v.durationSecs % 60).padStart(2, "0")}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${statusColor(v.status)}`}>
                          {v.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2 flex-wrap">
                          {/* Watch button — upload videos use /api/videos/[id]/stream */}
                          {v.sourceType === "upload" && (
                            <a
                              href={`/api/videos/${v.id}/stream`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 rounded text-xs font-medium transition-colors"
                            >
                              <Play className="w-3 h-3" />
                              Watch
                            </a>
                          )}
                          {/* Publish */}
                          {canPublish && v.status === "draft" && (
                            <button
                              onClick={() => handlePublish(v.id)}
                              className="px-2 py-1 bg-green-500/20 hover:bg-green-500/30 text-green-300 rounded text-xs font-medium transition-colors"
                            >
                              Publish
                            </button>
                          )}
                          {/* Retract */}
                          {canPublish && v.status === "published" && (
                            <button
                              onClick={() => handleRetract(v.id)}
                              className="px-2 py-1 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 rounded text-xs font-medium transition-colors"
                            >
                              Retract
                            </button>
                          )}
                          {/* Delete */}
                          {(role === "journalist" || role === "admin") &&
                            v.status !== "published" && (
                              <button
                                onClick={() => handleDelete(v.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded text-xs font-medium transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  )
}
