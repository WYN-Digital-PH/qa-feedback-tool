import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, X } from "lucide-react";
import { toast } from "sonner";

type Role = "owner" | "admin" | "consultant" | "developer" | "qa" | "viewer";
const ROLES: Role[] = ["owner", "admin", "consultant", "developer", "qa", "viewer"];

interface Invite {
  id: string;
  email: string;
  role: Role;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export default function TeamInvites() {
  const { isOwner, can } = useAuth();
  const canManage = can("team.manage");

  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("invitations")
      .select("id, email, role, token, expires_at, accepted_at, revoked_at, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      return;
    }
    setInvites((data ?? []) as Invite[]);
  }

  useEffect(() => {
    load();
  }, []);

  function linkFor(t: string) {
    return `${window.location.origin}/signup?invite=${t}`;
  }

  async function copyLink(i: Invite) {
    if (await copyToClipboard(linkFor(i.token))) {
      toast.success("Invite link copied");
      return;
    }
    // No clipboard access (the app isn't on HTTPS or localhost) — show the link
    // so it can still be selected and copied by hand.
    setRevealed(i.id);
    toast.error("Couldn't reach the clipboard — copy the link shown below.");
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const { data, error } = await supabase
      .from("invitations")
      .insert({ email: email.trim().toLowerCase(), role })
      .select("id, token")
      .single();
    setCreating(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "There is already a pending invite for that email." : error.message);
      return;
    }
    setEmail("");
    // Refresh before copying: a clipboard failure must never keep the new
    // invite from showing up in the list.
    await load();
    if (await copyToClipboard(linkFor(data.token))) {
      toast.success("Invite created — link copied to clipboard");
    } else {
      setRevealed(data.id);
      toast.success("Invite created — copy the link shown below.");
    }
  }

  async function revoke(id: string) {
    const { error } = await supabase.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Invite revoked");
      load();
    }
  }

  function statusOf(i: Invite) {
    if (i.accepted_at) return "accepted";
    if (i.revoked_at) return "revoked";
    if (new Date(i.expires_at) < new Date()) return "expired";
    return "pending";
  }

  if (!canManage) return <p className="text-sm text-muted-foreground">Your role can't manage invites.</p>;

  return (
    <div className="space-y-6">
      <form onSubmit={createInvite} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
          />
        </div>
        <div className="w-40">
          <Label>Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.filter((r) => isOwner || r !== "owner").map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={creating}>
          {creating ? "Creating…" : "Create invite"}
        </Button>
      </form>

      <div className="space-y-3">
        {invites.map((i) => {
          const status = statusOf(i);
          return (
            <div key={i.id} className="border-b border-border pb-3 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{i.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.role} · {status}
                    {status === "pending" && ` · expires ${new Date(i.expires_at).toLocaleDateString()}`}
                  </div>
                </div>
                {status === "pending" && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => copyLink(i)}>
                      <Copy className="w-4 h-4 mr-1" /> Copy link
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => revoke(i.id)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                )}
                {status !== "pending" && <Badge variant="secondary">{status}</Badge>}
              </div>
              {revealed === i.id && (
                <Input
                  readOnly
                  className="mt-2 text-xs"
                  value={linkFor(i.token)}
                  onFocus={(e) => e.currentTarget.select()}
                  autoFocus
                />
              )}
            </div>
          );
        })}
        {invites.length === 0 && <p className="text-sm text-muted-foreground">No invites yet.</p>}
      </div>
    </div>
  );
}
