import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { authClient } from "@/lib/auth-client";
import { AuthContext, type Session } from "@/lib/auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const { data, error } = await authClient.getSession();

    if (error) {
      console.error("Failed to get session:", error);
      setSession(null);
      return false;
    }

    setSession(data as Session | null);
    return !!data?.user;
  }, []);

  useEffect(() => {
    refreshSession().finally(() => setLoading(false));
  }, [refreshSession]);

  const signOut = useCallback(async () => {
    const { error } = await authClient.signOut();

    if (error) {
      console.error("Sign-out failed:", error);
      return;
    }

    setSession(null);
  }, []);

  const value = useMemo(
    () => ({ session, loading, refreshSession, signOut }),
    [session, loading, refreshSession, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
