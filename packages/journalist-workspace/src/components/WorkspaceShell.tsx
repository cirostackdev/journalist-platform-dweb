"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import {
  LayoutDashboard,
  FolderOpen,
  FileText,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
} from "lucide-react"

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Cases", href: "/cases", icon: FolderOpen },
  { label: "Articles", href: "/articles", icon: FileText, adminOnly: true },
]

interface WorkspaceShellProps {
  children: React.ReactNode
  title?: string
}

export default function WorkspaceShell({ children, title }: WorkspaceShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const token = sessionStorage.getItem("session")
    const storedRole = sessionStorage.getItem("role")
    if (!token) {
      router.replace("/login")
      return
    }
    setRole(storedRole)
  }, [router])

  function handleLogout() {
    const token = sessionStorage.getItem("session")
    fetch("/api/auth/logout", {
      method: "POST",
      headers: { "x-session": token ?? "" },
    }).finally(() => {
      sessionStorage.clear()
      router.replace("/login")
    })
  }

  const isEditor = role === "editor" || role === "admin"
  const visibleItems = NAV_ITEMS.filter((item) => !item.adminOnly || isEditor)

  function isActive(href: string) {
    if (href === "/dashboard") return pathname === "/dashboard"
    return pathname.startsWith(href)
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo / branding */}
      <div
        className={`flex items-center gap-3 px-3 py-4 border-b border-white/10 ${
          collapsed ? "justify-center" : ""
        }`}
      >
        {!collapsed && (
          <span className="text-white font-semibold text-sm truncate">
            Journalist WS
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 space-y-1 px-2">
        {visibleItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                collapsed ? "justify-center" : ""
              } ${
                active
                  ? "bg-primary text-white"
                  : "text-gray-400 hover:text-white hover:bg-white/10"
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={18} />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Bottom: logout */}
      <div className="px-2 pb-4 border-t border-white/10 pt-3">
        <button
          onClick={handleLogout}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white hover:bg-white/10 transition-colors w-full ${
            collapsed ? "justify-center" : ""
          }`}
          title={collapsed ? "Logout" : undefined}
        >
          <LogOut size={18} />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  )

  if (!mounted) return null

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col bg-gray-950 border-r border-white/10 flex-shrink-0 transition-all duration-200 ${
          collapsed ? "w-14" : "w-56"
        }`}
      >
        <SidebarContent />
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute left-0 top-1/2 -translate-y-1/2 translate-x-full bg-gray-950 border border-white/10 rounded-r-md p-1 text-gray-400 hover:text-white z-10"
          style={{ marginLeft: collapsed ? "3.5rem" : "14rem" }}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-56 bg-gray-950 border-r border-white/10 flex flex-col md:hidden transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-3 py-4 border-b border-white/10">
          <span className="text-white font-semibold text-sm">Journalist WS</span>
          <button
            onClick={() => setMobileOpen(false)}
            className="text-gray-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <SidebarContent />
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card flex-shrink-0">
          {/* Mobile hamburger */}
          <button
            className="md:hidden text-muted-foreground hover:text-foreground"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={20} />
          </button>
          <h1 className="text-sm font-semibold text-foreground truncate">
            {title ?? "Journalist Workspace"}
          </h1>
          {role && (
            <span className="ml-auto text-xs text-muted-foreground capitalize bg-muted px-2 py-1 rounded-md">
              {role}
            </span>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  )
}
