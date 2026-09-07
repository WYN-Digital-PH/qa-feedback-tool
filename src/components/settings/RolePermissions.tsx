import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Info, Loader2, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { EDITABLE_ROLES, ROLES, ROLE_SUMMARY, roleLabel, type Role } from "@/lib/permissions";
import { InlineEmptyState } from "@/components/ui/states";

interface PermissionRow {
  key: string;
  category: string;
  label: string;
  description: string;
  is_locked: boolean;
  sort_order: number;
}

/** grants[role][permissionKey] === true when that role is allowed. */
type Grants = Record<string, Record<string, boolean>>;

export default function RolePermissions() {
  const { isOwner, refreshAccess } = useAuth();

  const [catalogue, setCatalogue] = useState<PermissionRow[]>([]);
  const [grants, setGrants] = useState<Grants>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  // One role is edited at a time. `admin` is the first role anyone actually
  // adjusts; `owner` is fixed, so opening on it would show a dead panel.
  const [activeRole, setActiveRole] = useState<Role>("admin");

  const load = useCallback(async () => {
    const [{ data: perms }, { data: rows }] = await Promise.all([
      supabase.from("permissions").select("*").order("sort_order"),
      supabase.from("role_permissions").select("role, permission, allowed"),
    ]);
    setCatalogue((perms ?? []) as PermissionRow[]);
    const next: Grants = {};
    for (const role of ROLES) next[role] = {};
    for (const row of rows ?? []) {
      next[row.role] = next[row.role] ?? {};
      next[row.role][row.permission] = row.allowed;
    }
    setGrants(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const byCategory = new Map<string, PermissionRow[]>();
    for (const p of catalogue) {
      const list = byCategory.get(p.category) ?? [];
      list.push(p);
      byCategory.set(p.category, list);
    }
    return Array.from(byCategory.entries());
  }, [catalogue]);

  // Owners always hold every permission — the database ignores their rows, so
  // the owner tab is rendered on and disabled rather than being editable.
  function isAllowed(role: Role, key: string): boolean {
    if (role === "owner") return true;
    return grants[role]?.[key] ?? false;
  }

  async function toggle(role: Role, key: string, next: boolean) {
    const cell = `${role}:${key}`;
    setSaving(cell);
    // Optimistic: these are independent switches, and waiting on a round trip
    // per click makes working through a category feel broken.
    setGrants((g) => ({ ...g, [role]: { ...(g[role] ?? {}), [key]: next } }));

    // A blocked UPDATE matches no rows rather than raising, so an unauthorised
    // write would otherwise look like it succeeded. Ask for the row back.
    const { data, error } = await supabase
      .from("role_permissions")
      .update({ allowed: next })
      .eq("role", role)
      .eq("permission", key)
      .select("role, permission, allowed");

    setSaving(null);
    if (error || !data?.length) {
      setGrants((g) => ({ ...g, [role]: { ...(g[role] ?? {}), [key]: !next } }));
      toast.error(
        !error || error.code === "42501"
          ? "Only the workspace owner can change permissions."
          : error.message,
      );
      return;
    }
    await refreshAccess();
  }

  async function resetToDefaults() {
    setResetting(true);
    const { data: defaults, error: defErr } = await supabase.rpc("default_role_permissions");
    if (defErr || !defaults) {
      setResetting(false);
      toast.error(defErr?.message ?? "Couldn't read the default permissions.");
      return;
    }
    // Owner rows are immutable, so they are left untouched.
    const rows = (defaults as { role: Role; permission: string; allowed: boolean }[]).filter(
      (r) => r.role !== "owner",
    );
    const { error } = await supabase
      .from("role_permissions")
      .upsert(rows, { onConflict: "role,permission" });

    setResetting(false);
    if (error) {
      toast.error(error.code === "42501" ? "Only the workspace owner can change permissions." : error.message);
      return;
    }
    toast.success("Permissions reset to defaults");
    await load();
    await refreshAccess();
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading permissions…</p>;
  if (catalogue.length === 0) {
    return (
      <InlineEmptyState message="No permissions found. Run the database migrations to create the permission catalogue." />
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            {isOwner
              ? "Choose what each role may do. Changes apply immediately, to both the app and the database."
              : "What each role may do in this workspace. Only the owner can change these."}
          </p>
          {isOwner && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={resetting} className="shrink-0">
                  {resetting ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  ) : (
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                  )}
                  Reset to defaults
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset permissions to defaults?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every role goes back to the recommended set described in the documentation. Any customisation you
                    have made is discarded. Member roles themselves are not changed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={resetToDefaults}>Reset</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* One role at a time. The matrix this replaced laid six roles across
            the page, so reading it meant tracking a column of anonymous
            checkboxes back to a row label that had scrolled out of sight. */}
        <Tabs value={activeRole} onValueChange={(v) => setActiveRole(v as Role)}>
          <TabsList className="h-auto w-full flex-wrap justify-start gap-1 p-1">
            {ROLES.map((role) => (
              <TabsTrigger key={role} value={role} className="text-xs">
                {roleLabel(role)}
              </TabsTrigger>
            ))}
          </TabsList>

          {ROLES.map((role) => (
            <TabsContent key={role} value={role} className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">{ROLE_SUMMARY[role]}</p>

              {role === "owner" && (
                <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                  The owner holds every permission and cannot be restricted, so these are shown for reference only.
                </div>
              )}

              {/* Every category starts shut, so a role opens as five headline
                  counts rather than twenty switches. The badge is what makes
                  that readable — a closed category still says how much is on,
                  which is the question being asked most of the time. */}
              <Accordion type="multiple" className="space-y-2">
                {groups.map(([category, items]) => {
                  const on = items.filter((p) => isAllowed(role, p.key)).length;
                  return (
                    <AccordionItem
                      key={category}
                      value={category}
                      className="rounded-lg border border-border px-3"
                    >
                      <AccordionTrigger className="py-3 hover:no-underline">
                        <div className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-2">
                          <span className="truncate text-sm font-medium">{category}</span>
                          {/* A shut category still says how much of it is on. */}
                          <Badge variant="secondary" className="shrink-0 text-[11px] font-normal tabular-nums">
                            {on} of {items.length} on
                          </Badge>
                        </div>
                      </AccordionTrigger>

                      <AccordionContent className="pb-2">
                        <ul className="divide-y divide-border border-t border-border">
                          {items.map((p) => {
                            const editable = isOwner && role !== "owner" && !p.is_locked;
                            const cell = `${role}:${p.key}`;
                            return (
                              <li key={p.key} className="flex items-start justify-between gap-4 py-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm">{p.label}</span>
                                    {p.is_locked && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Lock className="w-3 h-3 shrink-0 cursor-help text-muted-foreground" />
                                        </TooltipTrigger>
                                        <TooltipContent side="top" className="max-w-64">
                                          Fixed for every role — it cannot be granted or withdrawn here.
                                        </TooltipContent>
                                      </Tooltip>
                                    )}
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Info className="w-3.5 h-3.5 shrink-0 cursor-help text-muted-foreground" />
                                      </TooltipTrigger>
                                      <TooltipContent side="right" className="max-w-64">
                                        {p.description}
                                      </TooltipContent>
                                    </Tooltip>
                                  </div>
                                  <div className="truncate font-mono text-[11px] text-muted-foreground">{p.key}</div>
                                </div>

                                <Switch
                                  className="mt-0.5 shrink-0"
                                  checked={isAllowed(role, p.key)}
                                  disabled={!editable || saving === cell}
                                  onCheckedChange={(v) => toggle(role, p.key, v === true)}
                                  aria-label={`${p.label} for ${roleLabel(role)}`}
                                />
                              </li>
                            );
                          })}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </TabsContent>
          ))}
        </Tabs>

        <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground space-y-1">
          <p>
            <span className="font-medium text-foreground">Owner</span> always holds every permission and cannot be
            restricted — this is what stops a workspace from locking itself out.
          </p>
          <p>
            Only an owner can grant the owner role or change these, whoever else holds{" "}
            <span className="font-mono">team.manage</span>.
          </p>
          <p>
            Roles in use: {EDITABLE_ROLES.map((r) => roleLabel(r)).join(", ")}. See{" "}
            <span className="font-mono">docs/ROLES_AND_PERMISSIONS.md</span> for the full reference.
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}
