import { useActionState } from 'react';
import { LoaderCircle } from 'lucide-react';

import { Button } from '../shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../shadcn/components/ui/card';
import { Input } from '../shadcn/components/ui/input';
import { Label } from '../shadcn/components/ui/label';

import styles from './sign-in-card.module.scss';

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface SignInCardProps {
  onSignIn: (credentials: SignInCredentials) => Promise<void>;
  onSignUp?: () => void;
  /** A message shown above the form, e.g. after creating an account. */
  notice?: string | null;
  /** Prefills the email field, e.g. with the address just signed up with. */
  defaultEmail?: string;
  forgotPasswordHref?: string;
  signUpHref?: string;
  termsHref?: string;
  privacyHref?: string;
  id?: string;
}

export function SignInCard({
  onSignIn,
  onSignUp,
  notice,
  defaultEmail,
  forgotPasswordHref = '/forgot-password',
  signUpHref = '/sign-up',
  termsHref = '/terms',
  privacyHref = '/privacy',
  id = 'sign-in',
}: SignInCardProps) {
  const [error, signInAction, pending] = useActionState(
    async (_prev: string | null, data: FormData): Promise<string | null> => {
      try {
        await onSignIn({
          email: String(data.get('email') ?? '').trim(),
          password: String(data.get('password') ?? ''),
        });
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Sign in failed. Try again.';
      }
    },
    null,
  );

  return (
    <Card id={id} className={styles.card}>
      <CardHeader>
        <CardTitle className={styles.title}>Sign in to continue</CardTitle>
        <CardDescription>Use your email and password.</CardDescription>
      </CardHeader>

      <CardContent>
        <form action={signInAction} className={styles.form}>
          <div className={styles.field}>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              defaultValue={defaultEmail}
              required
              disabled={pending}
            />
          </div>

          <div className={styles.field}>
            <div className={styles.labelRow}>
              <Label htmlFor="password">Password</Label>
              <a href={forgotPasswordHref} className={styles.mutedLink}>
                Forgot password?
              </a>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={pending}
            />
          </div>

          {notice && !error && (
            <p role="status" className={styles.notice}>
              {notice}
            </p>
          )}

          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}

          <Button type="submit" className={styles.submit} disabled={pending}>
            {pending && <LoaderCircle className={styles.spinner} aria-hidden />}
            Continue
          </Button>
        </form>
      </CardContent>

      <CardFooter className={styles.footer}>
        <p>
          Don&apos;t have an account?{' '}
          {onSignUp ? (
            <button
              type="button"
              onClick={onSignUp}
              className={styles.strongLink}
            >
              Sign up
            </button>
          ) : (
            <a href={signUpHref} className={styles.strongLink}>
              Sign up
            </a>
          )}
        </p>
        <p> By continuing you agree to the{" "}
          <button type="button" className={styles.link}
            onClick={() => console.log("Terms clicked:", termsHref)} >
            Terms </button>{" "} and{" "}
          <button type="button" className={styles.link}
            onClick={() => console.log("Privacy policy clicked:", privacyHref)}
          > Privacy policy </button> . </p>
      </CardFooter>
    </Card>
  );
}
