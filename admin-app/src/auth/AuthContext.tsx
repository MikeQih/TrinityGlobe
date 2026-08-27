import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { AdminRole } from "../lib/types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  role: AdminRole | null;
}

const AuthContext = createContext<AuthState>({ loading: true, session: null, role: null });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: true, session: null, role: null });

  useEffect(() => {
    let cancelled = false;

    async function loadRole(session: Session | null) {
      if (!session) {
        if (!cancelled) setState({ loading: false, session: null, role: null });
        return;
      }
      const { data, error } = await supabase
        .from("admin_profiles")
        .select("role")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) console.error("AuthProvider: failed to load admin_profiles role", error);
      if (!cancelled) {
        setState({ loading: false, session, role: (data?.role as AdminRole | undefined) ?? null });
      }
    }

    supabase.auth.getSession().then(({ data }) => loadRole(data.session));

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((s) => ({ ...s, loading: true }));
      void loadRole(session);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
