import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeWriteError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/** Long enough for any real name, short enough not to break the surfaces that show it. */
const MAX_LENGTH = 80;

/**
 * Lets the signed-in user set the name everyone else sees them under.
 *
 * `profiles.full_name` is the single source of truth for this — every surface
 * resolves a person through `displayName.ts`, which reads that column and falls
 * back to the email address only when it is blank. The signup metadata
 * (`raw_user_meta_data.full_name`) is read once, by the `handle_new_user`
 * trigger, and never again, so there is nothing to keep in step here.
 *
 * Rows a team member wrote still carry their email in `guest_name` from write
 * time; those resolve through `created_by_user_id` instead, so a rename shows
 * up on old feedback too.
 */
export default function DisplayName({ onSaved }: { onSaved?: () => void }) {
  const { user, roles } = useAuth();
  const [saved, setSaved] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        // An empty field is indistinguishable from a name that failed to load.
        toast.error("Could not load your profile.");
      }
      const current = data?.full_name ?? "";
      setSaved(current);
      setValue(current);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const trimmed = value.trim();
  const dirty = saved !== null && trimmed !== saved.trim();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.id) return;
    if (!trimmed) {
      setError("Enter the name you want to be shown by.");
      return;
    }
    setError(null);
    setSaving(true);
    // Deliberately no `.select()` read-back. The UPDATE policy is
    // `auth.uid() = id` and we filter to exactly that row, so an error is the
    // only way this fails -- while SELECT is gated on `is_team_member()`, which
    // is false until somebody grants a role. Reading the row back would report
    // zero rows for an account still awaiting one and turn a successful save
    // into a false "could not be updated".
    const { error: writeError } = await supabase
      .from("profiles")
      .update({ full_name: trimmed })
      .eq("id", user.id);
    setSaving(false);

    if (writeError) {
      toast.error(
        describeWriteError(writeError, { subject: "your profile", hasRole: roles.length > 0, action: "update" }),
      );
      return;
    }

    setSaved(trimmed);
    setValue(trimmed);
    toast.success("Display name updated");
    // The team list on this same page renders this account too; without this it
    // would keep showing the old name until the page was reloaded.
    onSaved?.();
  }

  return (
    <form onSubmit={save} className="space-y-2">
      <Label htmlFor="display-name">Display name</Label>
      <Input
        id="display-name"
        value={value}
        maxLength={MAX_LENGTH}
        disabled={loading || saving}
        aria-invalid={!!error}
        aria-describedby="display-name-help"
        className={cn(error && "border-destructive")}
        placeholder={loading ? "Loading…" : "e.g. Briggs Pedrera"}
        onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
      />
      {error ? (
        <p id="display-name-help" className="text-xs text-destructive">{error}</p>
      ) : (
        <p id="display-name-help" className="text-xs text-muted-foreground">
          What your team sees on feedback, replies and the assignee list. Your email is used if this is blank.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={!dirty || saving || loading}>
          {saving ? "Saving…" : "Save name"}
        </Button>
        {dirty && !saving && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => { setValue(saved ?? ""); setError(null); }}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
