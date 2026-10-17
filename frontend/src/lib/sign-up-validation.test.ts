import { describe, expect, it } from 'vitest';

import {
  CODE_ERROR,
  CODE_EXPIRED_ERROR,
  EMAIL_FORMAT_ERROR,
  NAME_REQUIRED_ERROR,
  PASSWORD_ERROR,
  PASSWORD_MAX_LENGTH,
  RATE_LIMIT_ERROR,
  RESET_LINK_ERROR,
  SignUpError,
  toAccountErrorMessage,
  toSignUpError,
  validateCode,
  validateDetails,
  validateEmail,
  validatePassword,
} from './sign-up-validation';

describe('validateDetails', () => {
  it('accepts a name and a well-formed email', () => {
    expect(validateDetails('Ada', 'ada@example.com')).toBeNull();
  });

  it('requires a name', () => {
    expect(validateDetails('', 'ada@example.com')).toBe(NAME_REQUIRED_ERROR);
  });

  it.each(['', 'ada', 'ada@', '@example.com', 'ada@example', 'ada lovelace@example.com'])(
    'rejects %j',
    (email) => {
      expect(validateDetails('Ada', email)).toBe(EMAIL_FORMAT_ERROR);
    },
  );
});

describe('validateCode', () => {
  it('accepts six digits', () => {
    expect(validateCode('012345')).toBeNull();
  });

  it.each(['', '12345', '1234567', '12345a', '12 345'])('rejects %j', (code) => {
    expect(validateCode(code)).toBe(CODE_ERROR);
  });
});

describe('validatePassword', () => {
  it('accepts 8+ characters with a letter and a number', () => {
    expect(validatePassword('password1')).toBeNull();
  });

  it.each([
    ['too short', 'pass1'],
    ['no number', 'password'],
    ['no letter', '12345678'],
    ['too long', `a1${'x'.repeat(PASSWORD_MAX_LENGTH)}`],
  ])('rejects a password that is %s', (_reason, password) => {
    expect(validatePassword(password)).toBe(PASSWORD_ERROR);
  });
});

describe('toSignUpError', () => {
  it.each([
    ['INVALID_EMAIL', 'details', EMAIL_FORMAT_ERROR],
    ['INVALID_CODE', 'code', CODE_ERROR],
    ['CODE_EXPIRED', 'code', CODE_EXPIRED_ERROR],
    ['TOO_MANY_ATTEMPTS', 'code', CODE_EXPIRED_ERROR],
    ['PASSWORD_TOO_SHORT', 'password', PASSWORD_ERROR],
    ['PASSWORD_TOO_WEAK', 'password', PASSWORD_ERROR],
  ])('sends %s back to the %s step', (code, step, message) => {
    const error = toSignUpError({ code });
    expect(error).toBeInstanceOf(SignUpError);
    expect(error).toMatchObject({ step, message });
  });

  it('reports rate limiting without changing step', () => {
    const error = toSignUpError({ status: 429, code: 'INVALID_CODE' });
    expect(error).not.toBeInstanceOf(SignUpError);
    expect(error.message).toMatch(/wait a minute/i);
  });

  it('falls back to the server message for unknown errors', () => {
    const error = toSignUpError({ code: 'SOMETHING_ELSE', message: 'Boom' });
    expect(error).not.toBeInstanceOf(SignUpError);
    expect(error.message).toBe('Boom');
  });
});

describe('validateEmail', () => {
  it('accepts a well-formed email', () => {
    expect(validateEmail('ada@example.com')).toBeNull();
  });

  it('rejects a malformed one', () => {
    expect(validateEmail('ada@example')).toBe(EMAIL_FORMAT_ERROR);
  });
});

describe('toAccountErrorMessage', () => {
  it.each([
    ['PASSWORD_TOO_WEAK', PASSWORD_ERROR],
    ['INVALID_TOKEN', RESET_LINK_ERROR],
    ['INVALID_PASSWORD', 'Your current password is incorrect.'],
  ])('maps %s', (code, message) => {
    expect(toAccountErrorMessage({ code })).toBe(message);
  });

  it('reports rate limiting', () => {
    expect(toAccountErrorMessage({ status: 429 })).toBe(RATE_LIMIT_ERROR);
  });

  it('falls back to the server message', () => {
    expect(toAccountErrorMessage({ code: 'OTHER', message: 'Boom' })).toBe('Boom');
  });
});
