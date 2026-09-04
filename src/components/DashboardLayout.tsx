import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  Users,
  FolderKanban,
  MessageSquare,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import NotificationBell from "@/components/NotificationBell";
import BrandMark from "@/components/BrandMark";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/clients", label: "Agencies", icon: Users },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/feedback", label: "Feedback", icon: MessageSquare },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout() {
  const { user, signOut, roles, rolesLoading } = useAuth();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(false);

  const sidebarButton = "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border transition-all duration-300",
          "h-screen shrink-0 sticky top-0",
          collapsed ? "w-20" : "w-64",
        )}
      >
        {/* Logo */}
        <div className="px-4 py-5 border-b border-sidebar-border flex items-center justify-between gap-2">
          <Link to="/dashboard" className={cn("min-w-0", collapsed && "w-full")}>
            <BrandMark size="lg" logoOnly={collapsed} onDark />
          </Link>

          {!collapsed && (
            <Button variant="ghost" size="icon" className={sidebarButton} onClick={() => setCollapsed(true)}>
              <PanelLeftClose className="w-5 h-5" />
              <span className="sr-only">Collapse sidebar</span>
            </Button>
          )}
        </div>

        {/* Collapse Button */}
        {collapsed && (
          <div className="flex justify-center py-3 border-b border-sidebar-border">
            <Button variant="ghost" size="icon" className={sidebarButton} onClick={() => setCollapsed(false)}>
              <PanelLeftOpen className="w-5 h-5" />
              <span className="sr-only">Expand sidebar</span>
            </Button>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex items-center rounded-lg text-sm transition-colors",
                  collapsed ? "justify-center py-3" : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )
              }
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-sidebar-border p-3">
          {!collapsed && (
            <div className="mb-3 px-2">
              <div className="truncate text-sm font-medium text-sidebar-accent-foreground">{user?.email}</div>
              <div className="text-xs capitalize text-sidebar-foreground/70">{roles[0] ?? "Member"}</div>
            </div>
          )}

          <Button
            variant="ghost"
            className={cn("w-full", sidebarButton, collapsed ? "justify-center" : "justify-start")}
            onClick={async () => {
              await signOut();
              navigate("/login");
            }}
          >
            <LogOut className="w-4 h-4" />
            {!collapsed && <span className="ml-2">Sign out</span>}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <header className="h-14 bg-card border-b border-border flex items-center justify-end px-6 shrink-0">
          <NotificationBell />
        </header>

        <div className="flex-1 overflow-auto bg-secondary/40">
          {!rolesLoading && roles.length === 0 && (
            <div className="m-6 mb-0 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
              <ShieldAlert className="mt-0.5 w-4 h-4 shrink-0 text-warning" />
              <div>
                <div className="font-medium">Your account is waiting for a role</div>
                <p className="mt-1 text-muted-foreground">
                  You're signed in, but until an owner or admin assigns you a role under Settings → Team you won't see
                  any agencies, projects or feedback, and you can't create them.
                </p>
              </div>
            </div>
          )}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
