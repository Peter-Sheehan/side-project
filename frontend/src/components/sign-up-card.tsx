import { useActionState, useState, type ReactNode } from 'react';
import { Check, LoaderCircle } from 'lucide-react';

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
  SignUpError,
  validateCode,
  validateDetails,
  validatePassword,
  type SignUpStep,
} from '../lib/sign-up-validation';

import styles from './sign-in-card.module.scss';
import stepStyles from './sign-up-card.module.scss';

const STEPS: readonly { id: SignUpStep; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'code', label: 'Verify' },
  { id: 'password', label: 'Password' },
];

export interface SignUpCredentials {
  name: string;
  email: string;
  password: string;
  code: string;
}

export interface SignUpCardProps {
  onSendCode: (email: string) => Promise<void>;
  onVerifyCode: (email: string, code: string) => Promise<void>;
  onSignUp: (credentials: SignUpCredentials) => Promise<void>;
  onSignIn?: () => void;
  signInHref?: string;
  termsHref?: string;
  privacyHref?: string;
  id?: string;
}

interface Details {
  name: string;
  email: string;
}

export function SignUpCard({
  onSendCode,
  onVerifyCode,
  onSignUp,
  onSignIn,
  signInHref = '/sign-in',
  termsHref = '/terms',
  privacyHref = '/privacy',
  id = 'sign-up',
}: SignUpCardProps) {
  const [step, setStep] = useState<SignUpStep>('details');
  const [details, setDetails] = useState<Details>({ name: '', email: '' });
  const [code, setCode] = useState('');
  const [carriedError, setCarriedError] = useState<string | null>(null);

  function goTo(next: SignUpStep, error: string | null = null) {
    setCarriedError(error);
    setStep(next);
  }

  async function run(task: () => Promise<void>): Promise<string | null> {
    try {
      await task();
      return null;
    } catch (err) {
      if (err instanceof SignUpError && err.step !== step) {
        goTo(err.step, err.message);
        return null;
      }
      return err instanceof Error ? err.message : 'Something went wrong. Try again.';
    }
  }

  return (
    <Card id={id} className={styles.card}>
      {step === 'details' && (
        <DetailsStep
          id={id}
          initial={details}
          initialError={carriedError}
          onSubmit={(next) =>
            run(async () => {
              setDetails(next);
              await onSendCode(next.email);
              goTo('code');
            })
          }
        />
      )}

      {step === 'code' && (
        <CodeStep
          id={id}
          email={details.email}
          initialError={carriedError}
          onSubmit={(entered) =>
            run(async () => {
              await onVerifyCode(details.email, entered);
              setCode(entered);
              goTo('password');
            })
          }
          onResend={() => onSendCode(details.email)}
          onChangeEmail={() => goTo('details')}
        />
      )}

      {step === 'password' && (
        <PasswordStep
          id={id}
          email={details.email}
          initialError={carriedError}
          onSubmit={(password) =>
            run(() => onSignUp({ ...details, password, code }))
          }
        />
      )}

      <CardFooter className={styles.footer}>
        <p>
          Already have an account?{' '}
          {onSignIn ? (
            <button
              type="button"
              onClick={onSignIn}
              className={styles.strongLink}
            >
              Sign in
            </button>
          ) : (
            <a href={signInHref} className={styles.strongLink}>
              Sign in
            </a>
          )}
        </p>

        <p>
          By continuing you agree to the{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() => console.log('Terms clicked:', termsHref)}
          >
            Terms
          </button>{' '}
          and{' '}
          <button
            type="button"
            className={styles.link}
            onClick={() => console.log('Privacy policy clicked:', privacyHref)}
          >
            Privacy policy
          </button>
          .
        </p>
      </CardFooter>
    </Card>
  );
}

interface StepProps {
  step: SignUpStep;
  title: string;
  description: ReactNode;
  action: (data: FormData) => void;
  pending: boolean;
  error: string | null;
  notice?: string | null;
  submitLabel: string;
  secondary?: ReactNode;
  children: ReactNode;
}

function Progress({ current }: { current: SignUpStep }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className={stepStyles.steps} aria-label="Sign-up progress">
      {STEPS.map(({ id, label }, index) => {
        const state =
          index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
        return (
          <li
            key={id}
            className={stepStyles.step}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className={stepStyles.marker}>
              {state === 'done' ? <Check aria-label="Done" /> : index + 1}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function Step({
  step,
  title,
  description,
  action,
  pending,
  error,
  notice,
  submitLabel,
  secondary,
  children,
}: StepProps) {
  return (
    <>
      <CardHeader>
        <Progress current={step} />
        <CardTitle className={styles.title}>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent>
        {/* noValidate: the step's own checks show the error, not the browser's popup. */}
        <form action={action} className={styles.form} noValidate>
          {children}

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
            {submitLabel}
          </Button>

          {secondary}
        </form>
      </CardContent>
    </>
  );
}

function DetailsStep({
  id,
  initial,
  initialError,
  onSubmit,
}: {
  id: string;
  initial: Details;
  initialError: string | null;
  onSubmit: (details: Details) => Promise<string | null>;
}) {
  // React resets the form after each submit, so keep what was typed and use it
  // as the inputs' default values; a bad email can then be fixed in place.
  const [typed, setTyped] = useState<Details>(initial);

  const [error, action, pending] = useActionState(
    async (_prev: string | null, data: FormData): Promise<string | null> => {
      const next = {
        name: String(data.get('name') ?? '').trim(),
        email: String(data.get('email') ?? '').trim(),
      };
      setTyped(next);
      return validateDetails(next.name, next.email) ?? (await onSubmit(next));
    },
    initialError,
  );

  return (
    <Step
      step="details"
      title="Create your account"
      description="Enter your name and email. We'll send you a code to confirm it."
      action={action}
      pending={pending}
      error={error}
      submitLabel="Send code"
    >
      <div className={styles.field}>
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          name="name"
          type="text"
          autoComplete="name"
          placeholder="Your name"
          defaultValue={typed.name}
          required
          disabled={pending}
        />
      </div>

      <div className={styles.field}>
        <Label htmlFor={`${id}-email`}>Email</Label>
        <Input
          id={`${id}-email`}
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          defaultValue={typed.email}
          aria-invalid={error ? true : undefined}
          required
          disabled={pending}
        />
      </div>
    </Step>
  );
}

function CodeStep({
  id,
  email,
  initialError,
  onSubmit,
  onResend,
  onChangeEmail,
}: {
  id: string;
  email: string;
  initialError: string | null;
  onSubmit: (code: string) => Promise<string | null>;
  onResend: () => Promise<void>;
  onChangeEmail: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const [error, action, pending] = useActionState(
    async (_prev: string | null, data: FormData): Promise<string | null> => {
      setNotice(null);
      const code = String(data.get('code') ?? '').replace(/\s/g, '');
      return validateCode(code) ?? (await onSubmit(code));
    },
    initialError,
  );

  async function resend() {
    setResending(true);
    try {
      await onResend();
      setNotice('New code requested. It can take a minute to arrive; check spam too.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't send a new code. Try again.");
    } finally {
      setResending(false);
    }
  }

  const busy = pending || resending;

  return (
    <Step
      step="code"
      title="Check your email"
      description={
        <>
          Enter the 6-digit code we sent to <strong>{email}</strong>. It expires
          in 10 minutes.
        </>
      }
      action={action}
      pending={pending}
      error={error}
      notice={notice}
      submitLabel="Verify email"
      secondary={
        <div className={stepStyles.actions}>
          <Button type="button" variant="ghost" onClick={resend} disabled={busy}>
            Send a new code
          </Button>
          <Button type="button" variant="ghost" onClick={onChangeEmail} disabled={busy}>
            Use a different email
          </Button>
        </div>
      }
    >
      <div className={styles.field}>
        <Label htmlFor={`${id}-code`}>Code</Label>
        <Input
          id={`${id}-code`}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={6}
          className={stepStyles.codeInput}
          aria-invalid={error ? true : undefined}
          autoFocus
          required
          disabled={busy}
        />
      </div>
    </Step>
  );
}

function PasswordStep({
  id,
  email,
  initialError,
  onSubmit,
}: {
  id: string;
  email: string;
  initialError: string | null;
  onSubmit: (password: string) => Promise<string | null>;
}) {
  const [error, action, pending] = useActionState(
    async (_prev: string | null, data: FormData): Promise<string | null> => {
      const password = String(data.get('password') ?? '');
      return validatePassword(password) ?? (await onSubmit(password));
    },
    initialError,
  );

  return (
    <Step
      step="password"
      title="Create a password"
      description={
        <>
          <strong>{email}</strong> is confirmed. {PASSWORD_REQUIREMENTS}
        </>
      }
      action={action}
      pending={pending}
      error={error}
      submitLabel="Create account"
    >
      {/* Hidden username so password managers save the login against the email. */}
      <input
        type="email"
        name="username"
        autoComplete="username"
        value={email}
        readOnly
        hidden
      />

      <div className={styles.field}>
        <Label htmlFor={`${id}-password`}>Password</Label>
        <Input
          id={`${id}-password`}
          name="password"
          type="password"
          autoComplete="new-password"
          maxLength={PASSWORD_MAX_LENGTH}
          aria-invalid={error ? true : undefined}
          autoFocus
          required
          disabled={pending}
        />
      </div>
    </Step>
  );
}
