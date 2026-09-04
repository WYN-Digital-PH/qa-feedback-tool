import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Info, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { EDITABLE_ROLES, ROLES, ROLE_SUMMARY, type Role } from "@/lib/permissions";
import { humanize } from "@/lib/feedbackMeta";
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
  // the column is rendered checked and disabled rather than being editable.
  function isAllowed(role: Role, key: string): boolean {
    if (role === "owner") return true;
    return grants[role]?.[key] ?? false;
  }

  async function toggle(role: Role, key: string, next: boolean) {
    const cell = `${role}:${key}`;
    setSaving(cell);
    // Optimistic: the matrix is a grid of independent switches, and waiting on
    // a round trip per click makes bulk edits feel broken.
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

        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left font-medium text-xs text-muted-foreground uppercase tracking-wider py-2 pr-4 sticky left-0 bg-card">
                  Permission
                </th>
                {ROLES.map((role) => (
                  <th key={role} className="px-3 py-2 text-center align-bottom">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="text-xs font-medium capitalize cursor-help">{role}</span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-56">
                        {ROLE_SUMMARY[role]}
                      </TooltipContent>
                    </Tooltip>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(([category, items]) => (
                <Fragment key={category}>
                  <tr>
                    <td
                      colSpan={ROLES.length + 1}
                      className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground sticky left-0 bg-card"
                    >
                      {category}
                    </td>
                  </tr>
                  {items.map((p) => (
                    <tr key={p.key} className="border-t border-border">
                      <td className="py-2 pr-4 sticky left-0 bg-card">
                        <div className="flex items-center gap-1.5">
                          <span>{p.label}</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-64">
                              {p.description}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="text-[11px] font-mono text-muted-foreground">{p.key}</div>
                      </td>
                      {ROLES.map((role) => {
                        const editable = isOwner && role !== "owner" && !p.is_locked;
                        const cell = `${role}:${p.key}`;
                        return (
                          <td key={role} className="px-3 py-2 text-center">
                            <Checkbox
                              checked={isAllowed(role, p.key)}
                              disabled={!editable || saving === cell}
                              onCheckedChange={(v) => toggle(role, p.key, v === true)}
                              aria-label={`${p.label} for ${role}`}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground space-y-1">
          <p>
            <span className="font-medium text-foreground">Owner</span> always holds every permission and cannot be
            restricted — this is what stops a workspace from locking itself out.
          </p>
          <p>
            Only an owner can grant the owner role or change this matrix, whoever else holds{" "}
            <span className="font-mono">team.manage</span>.
          </p>
          <p>
            Roles in use: {EDITABLE_ROLES.map((r) => humanize(r)).join(", ")}. See{" "}
            <span className="font-mono">docs/ROLES_AND_PERMISSIONS.md</span> for the full reference.
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}
