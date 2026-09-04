import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BrandMark from "@/components/BrandMark";
import { MailCheck } from "lucide-react";
import { toast } from "sonner";

export default function ForgotPassword() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await sendPasswordReset(email.trim());
    setLoading(false);
    // Rate limiting is the one failure worth surfacing — everything else is
    // deliberately indistinguishable so this form can't be used to check
    // which email addresses have accounts.
    if (error) { toast.error(error); return; }
    setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-secondary/40 px-4">
      <div className="w-full max-w-sm">
        <BrandMark className="justify-center mb-6" />
        <div className="surface-elevated p-6">
          {sent ? (
            <div className="text-center">
              <MailCheck className="w-10 h-10 mx-auto text-primary mb-3" aria-hidden />
              <h1 className="text-lg font-semibold mb-1">Check your inbox</h1>
              <p className="text-sm text-muted-foreground">
                If an account exists for <span className="font-medium text-foreground">{email}</span>, a reset link is
                on its way. It expires in an hour, and only the most recent link works.
              </p>
              <p className="text-xs text-muted-foreground mt-3">
                Nothing arrived? Check your spam folder, then{" "}
                <button type="button" className="text-primary hover:underline" onClick={() => setSent(false)}>
                  try a different address
                </button>
                .
              </p>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-semibold mb-1">Reset your password</h1>
              <p className="text-sm text-muted-foreground mb-5">
                Enter the email you sign in with and we'll send you a link to set a new password.
              </p>
              <form onSubmit={onSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? "Sending…" : "Send reset link"}
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
