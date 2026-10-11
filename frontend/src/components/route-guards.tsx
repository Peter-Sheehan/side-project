import { Navigate, Outlet } from "react-router";

import { useAuth } from "@/lib/auth-context";

interface GuardProps {
  redirectTo: string;
}

function CheckingSession() {
  return (
    <main className="flex min-h-svh items-center justify-center">
      Checking your session...
    </main>
  );
}

/** Renders child routes only for signed-in users; everyone else is redirected. */
export function RequireAuth({ redirectTo }: GuardProps) {
  const { session, loading } = useAuth();

  if (loading) return <CheckingSession />;
  if (!session?.user) return <Navigate to={redirectTo} replace />;

  return <Outlet />;
}

/** Renders child routes only for signed-out users, e.g. the login page. */
export function RequireGuest({ redirectTo }: GuardProps) {
  const { session, loading } = useAuth();

  if (loading) return <CheckingSession />;
  if (session?.user) return <Navigate to={redirectTo} replace />;

  return <Outlet />;
}
