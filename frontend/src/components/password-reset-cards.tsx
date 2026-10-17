import { useActionState, useState } from 'react';
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
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_REQUIREMENTS,
  validateEmail,
  validatePassword,
} from '../lib/sign-up-validation';

import styles from './sign-in-card.module.scss';

function BackToSignIn({ onSignIn }: { onSignIn: () => void }) {
  return (
    <CardFooter className={styles.footer}>
      <p>
        Remembered it?{' '}
        <button type="button" onClick={onSignIn} className={styles.strongLink}>
          Back to sign in
        </button>
      </p>
    </CardFooter>
  );
}

export function ForgotPasswordCard({
  onRequestReset,
  onSignIn,
  initialError = null,
}: {
  onRequestReset: (email: string) => Promise<void>;
  onSignIn: () => void;
  initialError?: string | null;
}) {
  const [sentTo, setSentTo] = useState<string | null>(null);

  const [error, action, pending] = useActionState(
    async (_prev: string | null, data: FormData): Promise<string | null> => {
      const email = String(data.get('email') ?? '').trim();
      const problem = validateEmail(email);
      if (problem) return problem;
      try {
        await onRequestReset(email);
        setSentTo(email);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Something went wrong. Try again.';
      }
    },
    initialError,
  );

  if (sentTo) {
    return (
      <Card className={styles.card}>
        <CardHeader>
          <CardTitle className={styles.title}>Check your email</CardTitle>
          {/* Worded the same whether or not the account exists. */}
          <CardDescription>
            If there&apos;s an account for <strong>{sentTo}</strong>, we&apos;ve sent it a
            link to reset the password. The link expires in 1 hour.
          </CardDescription>
        </CardHeader>
        <BackToSignIn onSignIn={onSignIn} />
      </Card>
    );
  }

  return (
    <Card className={styles.card}>
      <CardHeader>
        <CardTitle className={styles.title}>Reset your password</CardTitle>
        <CardDescription>Enter your email and we&apos;ll send you a reset link.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className={styles.form} noValidate>
          <div className={styles.field}>
            <Label htmlFor="forgot-email">Email</Label>
            <Input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={error ? true : undefined}
              autoFocus
              disabled={pending}
            />
          </div>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <Button type="submit" className={styles.submit} disabled={pending}>
            {pending && <LoaderCircle className={styles.spinner} aria-hidden />}
            Send reset link
          </Button>
        </form>
      </CardContent>
      <BackToSignIn onSignIn={onSignIn} />
    </Card>
  );
}

export function ResetPasswordCard({
  onReset,
  onSignIn,
}: {
  onReset: (newPassword: string) => Promise<void>;
  onSignIn: () => void;
}) {
  const [error, action, pending] = useActionState(
    async (_prev: string | null, data: FormData): Promise<string | null> => {
      const password = String(data.get('password') ?? '');
      const problem = validatePassword(password);
      if (problem) return problem;
      try {
        await onReset(password);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : 'Something went wrong. Try again.';
      }
    },
    null,
  );

  return (
    <Card className={styles.card}>
      <CardHeader>
        <CardTitle className={styles.title}>Choose a new password</CardTitle>
        <CardDescription>
          {PASSWORD_REQUIREMENTS} You&apos;ll be signed out everywhere else.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className={styles.form} noValidate>
          <div className={styles.field}>
            <Label htmlFor="reset-password">New password</Label>
            <Input
              id="reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              maxLength={PASSWORD_MAX_LENGTH}
              aria-invalid={error ? true : undefined}
              autoFocus
              disabled={pending}
            />
          </div>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <Button type="submit" className={styles.submit} disabled={pending}>
            {pending && <LoaderCircle className={styles.spinner} aria-hidden />}
            Reset password
          </Button>
        </form>
      </CardContent>
      <BackToSignIn onSignIn={onSignIn} />
    </Card>
  );
}
