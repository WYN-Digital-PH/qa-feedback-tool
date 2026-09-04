import type { AuthError, PostgrestError } from "@supabase/supabase-js";

/**
 * Turn a Supabase auth failure into something a team member can act on.
 *
 * Raw GoTrue messages ("Invalid login credentials") don't say what to do next,
 * and the signup path has failure modes — an unconfirmed address, an exhausted
 * email quota — that look identical to the user without an explanation.
 */
export function describeAuthError(
  error: AuthError,
  context: "signin" | "signup" | "reset",
): string {
  switch (error.code) {
    case "invalid_credentials":
      return "That email and password don't match an account. Check both and try again.";
    case "email_not_confirmed":
      return "Confirm your email first — open the link we sent when the account was created.";
    case "user_already_exists":
    case "email_exists":
      return "An account with that email already exists. Sign in instead.";
    case "user_not_found":
      return "No account exists for that email address.";
    case "same_password":
      return "That's the password you already have. Choose a different one.";
    case "session_expired":
    case "flow_state_expired":
      return "This reset link has expired. Request a new one.";
    case "reauthentication_needed":
      return "For security, request a fresh reset link and try again.";
    case "email_address_invalid":
      return "That doesn't look like a valid email address.";
    case "weak_password":
      return error.message || "Pick a longer, less predictable password.";
    case "over_email_send_rate_limit":
      if (context === "signup") {
        return "We couldn't send the confirmation email — too many have gone out recently. Try again later, or ask an owner for an invite link.";
      }
      return context === "reset"
        ? "A reset email was sent recently. Check your inbox and spam folder before requesting another."
        : "Too many emails sent recently. Try again later.";
    case "over_request_rate_limit":
      return "Too many attempts. Wait a minute, then try again.";
    case "signup_disabled":
      return "New sign-ups are turned off. Ask an owner to send you an invite link.";
    case "user_banned":
      return "This account has been suspended. Contact an owner or admin.";
    case "validation_failed":
      return "Check the details you entered and try again.";
    case "unexpected_failure":
      if (context === "signup") {
        return "The account couldn't be created. Try again, and tell an owner if it keeps happening.";
      }
      return context === "reset"
        ? "The password couldn't be changed. Try again, and tell an owner if it keeps happening."
        : "Something went wrong signing in. Try again in a moment.";
    default:
      return error.message;
  }
}

/** Postgres `insufficient_privilege` — what RLS returns when a policy blocks a write. */
const INSUFFICIENT_PRIVILEGE = "42501";

/**
 * Explain a failed write against a table guarded by row-level security.
 *
 * `subject` is the plural noun for what was being written ("agencies") and
 * `action` the verb that failed. What a role may do is configurable per
 * workspace (Settings → Roles & permissions), so `hasRole` separates "you were
 * never given access" — which needs a role assigned — from "your role isn't
 * granted this", which needs the owner to change a permission. The two have
 * very different follow-up.
 */
export function describeWriteError(
  error: PostgrestError,
  { subject, hasRole, action = "create" }: { subject: string; hasRole: boolean; action?: string },
): string {
  switch (error.code) {
    case INSUFFICIENT_PRIVILEGE:
      return hasRole
        ? `Your role isn't allowed to ${action} ${subject}. An owner can grant it under Settings → Roles & permissions.`
        : `Your account hasn't been given a role yet, so it can't ${action} ${subject}. Ask an owner or admin to assign one under Settings → Team.`;
    case "23505":
      return "An entry with those details already exists.";
    case "23503":
      return "Something still refers to this record, so it can't be removed. Refresh the page and try again.";
    case "23502":
      return "A required field is missing.";
    case "PGRST301":
      return "Your session has expired. Sign in again to continue.";
    default:
      return error.message;
  }
}
