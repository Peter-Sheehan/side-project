import { createAuthClient } from "better-auth/client";

// No baseURL: the auth service is reached on this origin at /api/auth, through
// Caddy in Docker or the Vite dev proxy.
export const authClient = createAuthClient();

export type AuthError = { code?: string; message?: string; status?: number };

export async function postAuth(path: string, body: object): Promise<AuthError | null> {
  const { error } = await authClient.$fetch(path, { method: "POST", body });
  return error ?? null;
}
