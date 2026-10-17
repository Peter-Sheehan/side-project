import { createContext, useContext } from "react";

export type Session = {
  user: {
    email: string;
    name: string;
    image?: string | null;
  };
};

export interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  /** Re-reads the session cookie. Resolves true when a user is signed in. */
  refreshSession: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside <AuthProvider>.");
  }

  return context;
}
