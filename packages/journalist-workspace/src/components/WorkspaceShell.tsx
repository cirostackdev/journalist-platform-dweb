"use client"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import {
  LayoutDashboard,
  FolderOpen,
  FileText,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Shield,
  Play,
} from "lucide-react"

export function WorkspaceShell({
  children,
  title,
}: {
  children: React.ReactNode
  title?: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [role, setRole] = useState<string | null>(null)

  useEffect(() => {
    const role = sessionStorage.getItem("role")
    if (!role) {
      router.replace("/login")
      return
    }
    setRole(role)
  }, [router])

  const NAV = [
    { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { href: "/cases", icon: FolderOpen, label: "Cases" },
    { href: "/videos", icon: Play, label: "Videos" },
    ...(role === "admin" || role === "editor"
      ? [{ href: "/articles", icon: FileText, label: "Articles" }]
      : []),
  ]

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" })
    sessionStorage.clear()
    router.replace("/login")
  }

  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <>
      <div className="flex items-center justify-between px-3 py-4 border-b border-white/10 min-h-[57px]">
        {mobile ? (
          <>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-400" />
              <span className="font-semibold text-sm text-white">Newsroom</span>
            </div>
            <button
              onClick={() => setMobileOpen(false)}
              className="p-2 text-gray-400 hover:text-white rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        ) : collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="mx-auto text-gray-400 hover:text-white"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-400" />
              <span className="font-semibold text-sm text-white truncate">Newsroom</span>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              className="text-gray-400 hover:text-white ml-1"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </>
        )}
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active =
            href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(href)
          const isCollapsed = !mobile && collapsed
          return (
            <Link
              key={href}
              href={href}
              onClick={() => mobile && setMobileOpen(false)}
              title={isCollapsed ? label : undefined}
              className={`flex items-center gap-2.5 py-2 rounded-lg text-sm transition-colors ${
                isCollapsed ? "justify-center px-2" : "px-3"
              } ${
                active
                  ? "bg-white/10 text-white"
                  : "text-gray-400 hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!isCollapsed && label}
            </Link>
          )
        })}
      </nav>

      <div className="p-2 border-t border-white/10">
        <button
          onClick={logout}
          title={!mobile && collapsed ? "Sign out" : undefined}
          className={`flex items-center gap-2.5 py-2 w-full rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors ${
            !mobile && collapsed ? "justify-center px-2" : "px-3"
          }`}
        >
          <LogOut className="w-4 h-4" />
          {(mobile || !collapsed) && "Sign out"}
        </button>
      </div>
    </>
  )

  return (
    <div
      className="flex bg-gray-900 text-white overflow-hidden"
      style={{ height: "100dvh" }}
    >
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-gray-950 border-r border-white/10 transition-transform duration-200 lg:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <SidebarContent mobile />
      </aside>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex ${
          collapsed ? "w-14" : "w-56"
        } shrink-0 border-r border-white/10 flex-col bg-gray-950 transition-[width] duration-200`}
      >
        <SidebarContent />
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile top bar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 -ml-2 text-gray-400 hover:text-white rounded-lg"
          >
            <Menu className="w-5 h-5" />
          </button>
          {title && (
            <h1 className="text-base font-semibold truncate">{title}</h1>
          )}
        </div>

        {/* Desktop page title bar */}
        {title && (
          <div className="hidden lg:block px-6 py-4 border-b border-white/10">
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4 md:p-6">{children}</div>
      </main>
    </div>
  )
}

// Default export for backward-compat with existing imports
export default WorkspaceShell
