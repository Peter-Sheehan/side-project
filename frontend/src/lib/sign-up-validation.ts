export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const EMAIL_FORMAT_ERROR =
  'That email address looks wrong. Check the format (e.g. you@example.com) and try again.';
export const NAME_REQUIRED_ERROR = 'Enter your name.';
export const PASSWORD_REQUIREMENTS = `Use ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters, with at least one letter and one number.`;
export const PASSWORD_ERROR = `That password doesn't meet the requirements. ${PASSWORD_REQUIREMENTS}`;
export const CODE_ERROR =
  "That code isn't right. Check the 6-digit code in the email and try again.";
export const RESET_LINK_ERROR =
  'That reset link has expired or was already used. Request a new one.';
export const RATE_LIMIT_ERROR = 'Too many attempts. Wait a minute and try again.';
export const CODE_EXPIRED_ERROR =
  'That code has expired or had too many wrong tries. Send a new one.';

export type SignUpStep = 'details' | 'code' | 'password';

export class SignUpError extends Error {
  readonly step: SignUpStep;

  constructor(message: string, step: SignUpStep) {
    super(message);
    this.step = step;
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | null {
  return EMAIL_PATTERN.test(email) ? null : EMAIL_FORMAT_ERROR;
}

export function validateDetails(name: string, email: string): string | null {
  if (!name) return NAME_REQUIRED_ERROR;
  return validateEmail(email);
}

export function validatePassword(password: string): string | null {
  const ok =
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password);
  return ok ? null : PASSWORD_ERROR;
}

export function validateCode(code: string): string | null {
  return /^\d{6}$/.test(code) ? null : CODE_ERROR;
}

export function toSignUpError(error: {
  code?: string;
  message?: string;
  status?: number;
}): Error {
  if (error.status === 429) {
    return new Error(RATE_LIMIT_ERROR);
  }
  switch (error.code) {
    case 'INVALID_EMAIL':
      return new SignUpError(EMAIL_FORMAT_ERROR, 'details');
    case 'INVALID_CODE':
      return new SignUpError(CODE_ERROR, 'code');
    case 'CODE_EXPIRED':
    case 'TOO_MANY_ATTEMPTS':
      return new SignUpError(CODE_EXPIRED_ERROR, 'code');
    case 'PASSWORD_TOO_SHORT':
    case 'PASSWORD_TOO_LONG':
    case 'PASSWORD_TOO_WEAK':
      return new SignUpError(PASSWORD_ERROR, 'password');
    default:
      return new Error(error.message || 'Account creation failed.');
  }
}

/** Message for an error from password reset, change-password or profile updates. */
export function toAccountErrorMessage(error: {
  code?: string;
  message?: string;
  status?: number;
}): string {
  if (error.status === 429) return RATE_LIMIT_ERROR;
  switch (error.code) {
    case 'PASSWORD_TOO_SHORT':
    case 'PASSWORD_TOO_LONG':
    case 'PASSWORD_TOO_WEAK':
      return PASSWORD_ERROR;
    case 'INVALID_PASSWORD':
      return 'Your current password is incorrect.';
    case 'CREDENTIAL_ACCOUNT_NOT_FOUND':
      return "Your account doesn't have a password yet. Sign out and use “Forgot password?” to set one.";
    case 'INVALID_TOKEN':
      return RESET_LINK_ERROR;
    case 'INVALID_AVATAR':
      return 'That image is too large or not a supported type. Try another.';
    default:
      return error.message || 'Something went wrong. Try again.';
  }
}
