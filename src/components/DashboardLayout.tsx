import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
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
  Menu,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import NotificationBell from "@/components/NotificationBell";
import BrandMark from "@/components/BrandMark";
import { roleLabel } from "@/lib/permissions";
import { useIsDesktop } from "@/hooks/use-mobile";

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
  const location = useLocation();

  const [collapsed, setCollapsed] = useState(false);
  const isDesktop = useIsDesktop();
  // Collapsing to an icon rail is a desktop affordance. The drawer is always
  // the full-width sidebar, however the rail was left on a wider screen.
  const railed = collapsed && isDesktop;
  // Below `lg` the sidebar is an overlay rather than a column -- 16rem of
  // permanent chrome leaves a phone with almost nothing to read the page in.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Navigating is the end of the errand the drawer was opened for.
  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  // Escape closes it, the way the dialogs elsewhere behave.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileNavOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  const sidebarButton = "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

  return (
    <div className="h-screen flex overflow-hidden bg-background">
      {/* Scrim for the mobile drawer. Hidden from assistive tech: the close
          button and Escape are the announced ways out. */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/50 lg:hidden"
          aria-hidden="true"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "bg-sidebar text-sidebar-foreground flex flex-col border-r border-sidebar-border transition-transform duration-300",
          "h-screen shrink-0",
          // Off-canvas drawer below `lg`, a column of the layout from `lg` up.
          "fixed inset-y-0 left-0 z-50 w-64",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          "lg:static lg:translate-x-0 lg:transition-all",
          collapsed ? "lg:w-20" : "lg:w-64",
        )}
      >
        {/* Logo */}
        <div className="px-4 py-5 border-b border-sidebar-border flex items-center justify-between gap-2">
          <Link to="/dashboard" className={cn("min-w-0", railed && "w-full")}>
            <BrandMark size="lg" logoOnly={railed} onDark />
          </Link>

          {/* The drawer closes; the desktop column collapses. */}
          <Button
            variant="ghost"
            size="icon"
            className={cn(sidebarButton, "lg:hidden")}
            onClick={() => setMobileNavOpen(false)}
          >
            <X className="w-5 h-5" />
            <span className="sr-only">Close navigation</span>
          </Button>

          {!railed && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(sidebarButton, "hidden lg:inline-flex")}
              onClick={() => setCollapsed(true)}
            >
              <PanelLeftClose className="w-5 h-5" />
              <span className="sr-only">Collapse sidebar</span>
            </Button>
          )}
        </div>

        {/* Collapse Button */}
        {railed && (
          <div className="hidden lg:flex justify-center py-3 border-b border-sidebar-border">
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
                          railed ? "justify-center py-3" : "gap-3 px-3 py-2.5",
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )
              }
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!railed && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-sidebar-border p-3">
          {!railed && (
            <div className="mb-3 px-2">
              <div className="truncate text-sm font-medium text-sidebar-accent-foreground">{user?.email}</div>
              <div className="text-xs text-sidebar-foreground/70">{roleLabel(roles[0]) || "Member"}</div>
            </div>
          )}

          <Button
            variant="ghost"
            className={cn("w-full", sidebarButton, railed ? "justify-center" : "justify-start")}
            onClick={async () => {
              await signOut();
              navigate("/login");
            }}
          >
            <LogOut className="w-4 h-4" />
            {!railed && <span className="ml-2">Sign out</span>}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <header className="h-14 bg-card border-b border-border flex items-center justify-between gap-2 px-4 sm:px-6 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="w-5 h-5" />
            <span className="sr-only">Open navigation</span>
          </Button>
          {/* Keeps the bell right-aligned once the menu button is gone. */}
          <div className="hidden lg:block" />
          <NotificationBell />
        </header>

        <div className="flex-1 overflow-auto bg-secondary/40">
          {!rolesLoading && roles.length === 0 && (
            <div className="m-4 mb-0 sm:m-6 sm:mb-0 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
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
