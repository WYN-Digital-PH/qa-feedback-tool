import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BrandMark from "@/components/BrandMark";
import { toast } from "sonner";

export default function Signup() {
  const { signUp } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get("invite");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [invite, setInvite] = useState<{ email: string; role: string } | null>(null);
  const [inviteChecked, setInviteChecked] = useState(!inviteToken);

  useEffect(() => {
    if (!inviteToken) return;
    (async () => {
      const { data } = await supabase.rpc("get_invitation_by_token", { _token: inviteToken });
      const row = Array.isArray(data) ? data[0] : null;
      if (row) {
        setInvite({ email: row.email, role: row.role });
        setEmail(row.email);
      }
      setInviteChecked(true);
    })();
  }, [inviteToken]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    setLoading(true);
    const { error, alreadyRegistered, needsConfirmation } = await signUp(email, password, fullName);
    setLoading(false);

    if (error) { toast.error(error); return; }

    if (alreadyRegistered) {
      toast.error("An account already uses that email. Sign in instead, or reset your password.");
      return;
    }

    if (needsConfirmation) {
      toast.success(`Account created. Open the confirmation link sent to ${email} to activate it.`);
    } else if (invite) {
      toast.success(`Account created with the ${invite.role} role. You can sign in now.`);
    } else {
      toast.success("Account created. An admin must grant you access before you can view workspace data.");
    }
    nav("/login");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/40 px-4">
      <div className="w-full max-w-sm">
        <BrandMark className="justify-center mb-6" />
        <div className="surface-elevated p-6">
          <h1 className="text-lg font-semibold mb-1">Create team account</h1>
          {invite ? (
            <p className="text-sm text-muted-foreground mb-5">
              You've been invited as <span className="font-medium text-foreground">{invite.role}</span>. Create your
              account with <span className="font-medium text-foreground">{invite.email}</span> to accept.
            </p>
          ) : inviteToken && inviteChecked ? (
            <p className="text-sm text-destructive mb-5">
              This invite link is invalid, expired, or already used. You can still sign up, but an admin will need to
              grant you access.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mb-5">First account becomes the workspace owner. Additional accounts need an admin to assign a role before they can access any data. You'll confirm your email address before signing in.</p>
          )}
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input id="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                readOnly={!!invite}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading || !inviteChecked}>
              {loading ? "Creating…" : "Create account"}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
