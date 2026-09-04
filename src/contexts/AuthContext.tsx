import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { describeAuthError } from "@/lib/errors";
import { EMPTY_PERMISSIONS, makePermissionSet, type Permission, type Role } from "@/lib/permissions";
import type { Session, User } from "@supabase/supabase-js";

interface SignUpResult {
  error: string | null;
  /** Supabase reports an existing email as a success, so callers must check this. */
  alreadyRegistered: boolean;
  /** No session came back, meaning a confirmation email has to be opened first. */
  needsConfirmation: boolean;
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  loading: boolean;
  roles: Role[];
  rolesLoading: boolean;
  isOwner: boolean;
  /**
   * Whether the signed-in user holds a permission. The database enforces the
   * same rule through RLS — this is only so the UI can avoid offering an
   * action that would be rejected.
   */
  can: (permission: Permission) => boolean;
  /** Re-reads roles and permissions, e.g. after an owner edits the matrix. */
  refreshAccess: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<SignUpResult>;
  /** Emails a recovery link. Resolves the same way whether or not the address exists. */
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  /** Sets a new password for the session opened by a recovery link. */
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState(EMPTY_PERMISSIONS);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        setTimeout(() => fetchAccess(s.user.id), 0);
      } else {
        setRoles([]);
        setPermissions(EMPTY_PERMISSIONS);
        setRolesLoading(false);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) fetchAccess(data.session.user.id);
      else setRolesLoading(false);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Tracked separately from `loading`: the session resolves before the roles
  // query returns, and treating that gap as "no roles" makes the UI claim the
  // account has no access every time it loads.
  //
  // Permissions come from my_permissions(), which resolves the user's roles
  // against the owner-editable grant matrix in one round trip.
  async function fetchAccess(uid: string) {
    setRolesLoading(true);
    const [{ data: roleRows }, { data: permissionKeys }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", uid),
      supabase.rpc("my_permissions"),
    ]);
    setRoles((roleRows ?? []).map((r) => r.role as Role));
    setPermissions(makePermissionSet((permissionKeys as string[] | null) ?? []));
    setRolesLoading(false);
  }

  const refreshAccess = useCallback(async () => {
    if (user?.id) await fetchAccess(user.id);
  }, [user?.id]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? describeAuthError(error, "signin") : null };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { full_name: fullName },
      },
    });
    if (error) {
      return { error: describeAuthError(error, "signup"), alreadyRegistered: false, needsConfirmation: false };
    }
    // Supabase hides "this email is taken" behind a success response carrying a
    // user with no identities, so signups against an existing address otherwise
    // look like they worked while creating nothing.
    const alreadyRegistered = !!data.user && (data.user.identities?.length ?? 0) === 0;
    return { error: null, alreadyRegistered, needsConfirmation: !data.session };
  };

  // Supabase answers identically for an unknown address, which is what stops
  // this form being used to find out who has an account. The screen says
  // "if an account exists" for the same reason.
  const sendPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error ? describeAuthError(error, "reset") : null };
  };

  const updatePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error ? describeAuthError(error, "reset") : null };
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  const isOwner = roles.includes("owner");
  const can = useCallback((permission: Permission) => permissions.has(permission), [permissions]);

  return (
    <Ctx.Provider
      value={{
        user, session, loading, roles, rolesLoading, isOwner, can, refreshAccess,
        signIn, signUp, sendPasswordReset, updatePassword, signOut,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be inside AuthProvider");
  return v;
}
