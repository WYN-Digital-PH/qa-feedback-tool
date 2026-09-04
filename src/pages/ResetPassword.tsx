import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BrandMark from "@/components/BrandMark";
import { LoadingState } from "@/components/ui/states";
import { toast } from "sonner";

/** How long to wait for the recovery link to open a session before giving up. */
const LINK_TIMEOUT_MS = 5000;

type Phase = "checking" | "ready" | "invalid";

/**
 * Set a new password.
 *
 * Reached two ways: from a recovery email, where the link itself opens a
 * short-lived session, and from Settings, where the user is already signed in.
 * Both cases come down to "there is a session, so `updateUser` may change the
 * password", which is why one screen serves both.
 */
export default function ResetPassword() {
  const { updatePassword } = useAuth();
  const nav = useNavigate();

  const [phase, setPhase] = useState<Phase>("checking");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // A rejected link comes back as parameters rather than an error response,
    // and the Supabase client clears the fragment once it has read it — so
    // check the URL before anything else gets a chance to.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const described = hash.get("error_description") ?? query.get("error_description");
    if (described) {
      setLinkError(described.replace(/\+/g, " "));
      setPhase("invalid");
      return;
    }

    let settled = false;
    const ready = () => { settled = true; setPhase("ready"); };

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) ready();
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) ready();
    });

    // A link that was already used, or opened in a browser other than the one
    // that requested it, produces neither a session nor an error. Without this
    // the page would spin forever instead of explaining what to do.
    const timer = setTimeout(() => { if (!settled) setPhase("invalid"); }, LINK_TIMEOUT_MS);

    return () => { sub.subscription.unsubscribe(); clearTimeout(timer); };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    if (password !== confirm) { toast.error("The two passwords don't match"); return; }

    setSaving(true);
    const { error } = await updatePassword(password);
    setSaving(false);
    if (error) { toast.error(error); return; }

    toast.success("Password updated. You're signed in.");
    nav("/dashboard", { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/40 px-4">
      <div className="w-full max-w-sm">
        <BrandMark className="justify-center mb-6" />
        <div className="surface-elevated p-6">
          {phase === "checking" && <LoadingState label="Checking your link…" />}

          {phase === "invalid" && (
            <div className="text-center">
              <h1 className="text-lg font-semibold mb-1">This link can't be used</h1>
              <p className="text-sm text-muted-foreground">
                {linkError ?? "It may have expired, already been used, or been opened in a different browser."}
              </p>
              <Button asChild className="w-full mt-5">
                <Link to="/forgot-password">Request a new link</Link>
              </Button>
            </div>
          )}

          {phase === "ready" && (
            <>
              <h1 className="text-lg font-semibold mb-1">Choose a new password</h1>
              <p className="text-sm text-muted-foreground mb-5">
                At least 8 characters. You'll stay signed in on this device.
              </p>
              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    autoFocus
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="confirm">Confirm new password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={saving}>
                  {saving ? "Saving…" : "Update password"}
                </Button>
              </form>
            </>
          )}

          <div className="mt-4 text-center text-sm text-muted-foreground">
            <Link to="/login" className="text-primary hover:underline">Back to sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
