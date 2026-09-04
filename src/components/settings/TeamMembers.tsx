import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

import { ROLES, ROLE_SUMMARY, type Role } from "@/lib/permissions";
import { humanize } from "@/lib/feedbackMeta";
import { profileName } from "@/lib/displayName";

interface Member {
  id: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
  role: Role | null;
}

export default function TeamMembers() {
  const { user, isOwner, can } = useAuth();
  const canManage = can("team.manage");

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    const [{ data: profiles }, { data: userRoles }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, created_at").order("created_at"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    const roleMap = new Map<string, Role>();
    (userRoles ?? []).forEach((r) => roleMap.set(r.user_id, r.role as Role));
    setMembers(
      (profiles ?? []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        created_at: p.created_at,
        role: roleMap.get(p.id) ?? null,
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const ownerCount = members.filter((m) => m.role === "owner").length;

  function canEdit(m: Member) {
    if (!canManage) return false;
    if (m.id === user?.id) return false; // never edit your own role
    if (!isOwner && m.role === "owner") return false; // admins can't touch owners
    return true;
  }

  // Only an owner may hand out the owner role — the database enforces the same
  // rule, whoever else holds team.manage.
  function allowedRoles(): Role[] {
    if (isOwner) return [...ROLES];
    return ROLES.filter((r) => r !== "owner");
  }

  async function changeRole(m: Member, next: Role | "none") {
    if (m.role === next) return;
    // Fast feedback only — a trigger on user_roles is what actually holds the
    // line, since this count is as old as the last load.
    if (m.role === "owner" && ownerCount <= 1) {
      toast.error("You can't remove the last owner. Give someone else the owner role first.");
      return;
    }

    setSaving(m.id);

    // Grant before revoking. The other order leaves the member with no role at
    // all whenever the insert is refused, and only an owner can put one back.
    if (next !== "none") {
      const { error } = await supabase
        .from("user_roles")
        .upsert({ user_id: m.id, role: next }, { onConflict: "user_id,role" });
      if (error) {
        setSaving(null);
        toast.error(error.message);
        return;
      }
    }

    let revoke = supabase.from("user_roles").delete().eq("user_id", m.id);
    if (next !== "none") revoke = revoke.neq("role", next);
    const { error: delErr } = await revoke;

    if (delErr) {
      // The grant landed but the revoke didn't — removing the last owner is the
      // usual reason. Undo it rather than leave the member holding two roles.
      if (next !== "none") {
        await supabase.from("user_roles").delete().eq("user_id", m.id).eq("role", next);
      }
      setSaving(null);
      toast.error(delErr.message);
      await load();
      return;
    }

    setSaving(null);
    toast.success("Role updated");
    load();
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading members…</p>;

  return (
    <div className="space-y-3">
      {members.map((m) => (
        <div key={m.id} className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">
              {profileName(m)}
              {m.id === user?.id && <span className="text-muted-foreground font-normal"> (you)</span>}
            </div>
            <div className="text-xs text-muted-foreground truncate">{m.email}</div>
          </div>
          {canEdit(m) ? (
            <Select
              value={m.role ?? "none"}
              disabled={saving === m.id}
              onValueChange={(v) => changeRole(m, v as Role | "none")}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No access</SelectItem>
                {allowedRoles().map((r) => (
                  <SelectItem key={r} value={r}>
                    <span className="capitalize">{r}</span>
                    <span className="block text-xs text-muted-foreground">{ROLE_SUMMARY[r]}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="secondary">{m.role ? humanize(m.role) : "No access"}</Badge>
          )}
        </div>
      ))}
      {members.length === 0 && <p className="text-sm text-muted-foreground">No members yet.</p>}
    </div>
  );
}
