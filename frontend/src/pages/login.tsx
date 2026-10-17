import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  GitCommitHorizontal,
  Package,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { authClient } from '../lib/auth-client';
import { useAuth } from '../lib/auth-context';
import { SignInCard } from '../components/sign-in-card';
import { SignUpCard, type SignUpCredentials } from '../components/sign-up-card';
import { toSignUpError } from '../lib/sign-up-validation';
import { Badge } from '../shadcn/components/ui/badge';

import styles from './login.module.scss';

export interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

// type Provider = 'github' | 'gitlab' | 'bitbucket';
type AuthMode = 'signin' | 'signup';

export interface LoginPageProps {
  productName?: string;
  description?: string;
  features?: readonly Feature[];
}

const defaultFeatures: readonly Feature[] = [
  {
    icon: GitCommitHorizontal,
    title: 'History snapshots',
    description: 'Daily, weekly or per release.',
  },
  {
    icon: Package,
    title: 'Dependency changes',
    description: 'When each package came and went.',
  },
  {
    icon: Users,
    title: 'Owners',
    description: 'Who knows which part of the code.',
  },
];

// A failed verification link redirects to /login?error=<code>.
function verifyLinkNotice(error: string | null): string | null {
  if (!error) return null;
  return error === 'TOKEN_EXPIRED'
    ? 'That confirmation link has expired. Sign in to get a new one.'
    : "That confirmation link isn't valid. Sign in to get a new one.";
}

export default function LoginPage({
  productName = 'SideProject',
  description =
  'Point it at a repository. Get snapshots of files, dependencies and ownership across its whole history.',
  features = defaultFeatures,
}: LoginPageProps) {
  const navigate = useNavigate();
  const { refreshSession } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [searchParams] = useSearchParams();
  const [signInEmail, setSignInEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(() =>
    verifyLinkNotice(searchParams.get('error')),
  );

  async function handleSignIn({
    email,
    password,
  }: {
    email: string;
    password: string;
  }) {
    const result = await authClient.signIn.email({
      email,
      password,
      callbackURL: '/login',
    });

    if (result.error?.code === 'EMAIL_NOT_VERIFIED') {
      throw new Error(
        `Confirm your email first. We've sent a new link to ${email}.`,
      );
    }
    if (result.error) {
      throw new Error(result.error.message || 'Authentication failed.');
    }

    const success = await refreshSession();

    if (!success) {
      throw new Error(
        'Sign-in succeeded, but no session was found. Check your authentication configuration.',
      );
    }

    navigate('/landing', { replace: true });
  }


  async function postSignUpStep(path: string, body: object) {
    const { error } = await authClient.$fetch(path, { method: 'POST', body });
    if (error) throw toSignUpError(error);
  }

  const handleSendCode = (email: string) =>
    postSignUpStep('/sign-up/send-code', { email });

  const handleVerifyCode = (email: string, code: string) =>
    postSignUpStep('/sign-up/verify-code', { email, code });

  async function handleSignUp({
    name,
    email,
    password,
    code,
  }: SignUpCredentials): Promise<void> {
    await postSignUpStep('/sign-up/email', { name, email, password, code });
    setSignInEmail(email);
    setNotice('Account created. Sign in to continue.');
    setMode('signin');
  }

  function changeMode(nextMode: AuthMode) {
    setNotice(null);
    setMode(nextMode);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="/">
            {productName}
          </a>
          <span>Developer workspace</span>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <Badge variant="outline" className={styles.badge}>
            Git history analysis
          </Badge>

          <h1 className={styles.headline}>
            Your projects.
            <br />
            <span>Your workflow.</span>
          </h1>

          <p className={styles.description}>{description}</p>

          <ul className={styles.features}>
            {features.map(({ icon: Icon, title, description }) => (
              <li key={title} className={styles.feature}>
                <Icon className={styles.featureIcon} aria-hidden="true" />

                <div>
                  <p className={styles.featureTitle}>{title}</p>
                  <p className={styles.featureDescription}>
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section
          className={styles.authCard}
          aria-labelledby="auth-title"
        >

          {mode === 'signin' ? (
            <SignInCard
              onSignIn={handleSignIn}
              onSignUp={() => changeMode('signup')}
              notice={notice}
              defaultEmail={signInEmail}
              termsHref="/terms"
              privacyHref="/privacy"
            />
          ) : (
            <SignUpCard
              onSendCode={handleSendCode}
              onVerifyCode={handleVerifyCode}
              onSignUp={handleSignUp}
              onSignIn={() => changeMode('signin')}
              termsHref="/terms"
              privacyHref="/privacy"
            />
          )}
        </section>
      </main>

      <footer className={styles.footer}>
        <span>
          © {new Date().getFullYear()} {productName}
        </span>
        <span>Made for people who build.</span>
      </footer>
    </div>
  );
}
