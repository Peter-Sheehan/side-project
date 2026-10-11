import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import LoginPage from "./pages/login";
import SuccessPage from "@/pages/success";

// Matches the auth service's session.updateAge: renewing more often is a no-op.
const RENEW_INTERVAL_MS = 5 * 60 * 1000;

type Session = {
  user: {
    email: string;
    name: string;
  };
};

export default function App() {
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

  // Sessions expire after 30 idle minutes (see services/auth/src/auth.ts).
  // While the user is active, renew at most every RENEW_INTERVAL_MS; if the
  // session has already expired, refreshSession clears it and shows the login.
  const signedIn = !!session?.user;
  useEffect(() => {
    if (!signedIn) return;

    let lastRenew = Date.now();
    const onActivity = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastRenew < RENEW_INTERVAL_MS) return;
      lastRenew = Date.now();
      void refreshSession();
    };

    const events = ["pointerdown", "keydown", "visibilitychange"] as const;
    events.forEach((e) => document.addEventListener(e, onActivity));
    return () => events.forEach((e) => document.removeEventListener(e, onActivity));
  }, [signedIn, refreshSession]);

  async function handleSignOut() {
    const { error } = await authClient.signOut();

    if (error) {
      console.error("Sign-out failed:", error);
      return;
    }

    setSession(null);
  }

  if (loading) {
    return (
      <main className="flex min-h-svh items-center justify-center">
        Checking your session...
      </main>
    );
  }

  if (session?.user) {
    return (
      <SuccessPage
        email={session.user.email}
        onSignOut={handleSignOut}
      />
    );
  }

  return <LoginPage onSignIn={refreshSession} />;
}
