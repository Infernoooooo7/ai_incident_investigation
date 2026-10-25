/**
 * Best-effort secret redaction for exported reports.
 *
 * Two complementary strategies:
 * 1. Key-based: values stored under keys that look sensitive (password,
 *    api_key, authorization, *_token, ...) are replaced wholesale.
 * 2. Pattern-based: every string is scanned for common credential shapes
 *    (bearer tokens, provider API keys, JWTs, private keys, credentials in
 *    URLs, and `secret=value` style assignments).
 *
 * Neither can recognize a secret with no tell-tale key or shape, which is why
 * the UI asks people to review exports before sharing them.
 */
import { mapRichText } from '../domain/richText';
import type { RichText } from '../domain/richText';
import type { JsonObject, JsonValue } from '../domain/types';

export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PARTS =
  /password|passwd|passphrase|secret|apikey|accesskey|privatekey|authorization|credential|cookie|sessionid|bearer/;
const SENSITIVE_KEY_EXACT = new Set(['auth', 'pwd', 'pass', 'token', 'jwt', 'sig', 'signature']);

/**
 * True for keys like `password`, `x-api-key`, `NPM_TOKEN`, or `accessToken`.
 * Plural "tokens" (e.g. `input_tokens`) is deliberately not matched because it
 * usually holds a count.
 */
export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    SENSITIVE_KEY_EXACT.has(normalized) ||
    normalized.endsWith('token') ||
    SENSITIVE_KEY_PARTS.test(normalized)
  );
}

interface SecretPattern {
  /** Must use the global flag. */
  regex: RegExp;
  /** Returns the replacement for a match, or the match itself to leave it untouched. */
  redact(match: RegExpExecArray): string;
}

const isAlreadyRedacted = (value: string | undefined) => value?.startsWith('[REDACTED') ?? false;

const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    // PEM private key blocks.
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    redact: () => '[REDACTED PRIVATE KEY]',
  },
  {
    // Authorization header values, e.g. `Authorization: Basic dXNlcjpwYXNz`.
    regex:
      /\b(authorization["']?\s*[:=]\s*["']?)((?:(?:Bearer|Basic|Digest|Token)\s+)?[^\s"',;]+)/gi,
    redact: (m) => (isAlreadyRedacted(m[2]) ? m[0] : `${m[1]}${REDACTED}`),
  },
  {
    // Bearer tokens anywhere in text.
    regex: /\b(Bearer\s+)([A-Za-z0-9\-._~+/]{16,}=*)/g,
    redact: (m) => `${m[1]}${REDACTED}`,
  },
  {
    // JSON Web Tokens.
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    redact: () => REDACTED,
  },
  {
    // Common provider key formats: sk-..., Stripe-style, GitHub, GitLab, Slack, AWS, Google, npm.
    regex:
      /\b(?:sk-[A-Za-z0-9_-]{20,}|[rsp]k_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|npm_[A-Za-z0-9]{36})\b/g,
    redact: () => REDACTED,
  },
  {
    // Passwords embedded in URLs: scheme://user:password@host
    regex: /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)@/gi,
    redact: (m) => (isAlreadyRedacted(m[2]) ? m[0] : `${m[1]}${REDACTED}@`),
  },
  {
    // Sensitive query parameters.
    regex:
      /([?&](?:access_token|refresh_token|id_token|token|api_key|apikey|key|sig|signature|password|secret|client_secret)=)([^&\s#"']+)/gi,
    redact: (m) => (isAlreadyRedacted(m[2]) ? m[0] : `${m[1]}${REDACTED}`),
  },
  {
    // Assignments such as `password=hunter2`, `API_KEY: abc`, `"client_secret": "x"`.
    regex:
      /\b([A-Za-z0-9_.-]*(?:password|passwd|passphrase|secret|api[_-]?key|access[_-]?key|private[_-]?key|credentials?|token)(?![A-Za-z]))(["']?\s*[:=]\s*)(["']?)([^\s"'`,;&]+)/gi,
    redact: (m) => (isAlreadyRedacted(m[4]) ? m[0] : `${m[1]}${m[2]}${m[3]}${REDACTED}`),
  },
];

function applyPattern(text: string, pattern: SecretPattern, onRedact: () => void): string {
  let result = '';
  let lastIndex = 0;
  for (const match of text.matchAll(pattern.regex)) {
    const replacement = pattern.redact(match);
    if (replacement !== match[0]) onRedact();
    result += text.slice(lastIndex, match.index) + replacement;
    lastIndex = match.index + match[0].length;
  }
  return result + text.slice(lastIndex);
}

export interface Redactor {
  text(value: string): string;
  json(value: JsonValue): JsonValue;
  object(value: JsonObject): JsonObject;
  rich(value: RichText): RichText;
  /** Number of values replaced so far. */
  readonly count: number;
}

/** Creates a redactor that counts every replacement it makes. */
export function createRedactor(): Redactor {
  let count = 0;
  const onRedact = () => {
    count += 1;
  };

  const text = (value: string): string =>
    SECRET_PATTERNS.reduce((current, pattern) => applyPattern(current, pattern, onRedact), value);

  const object = (value: JsonObject): JsonObject =>
    // Object.fromEntries defines own properties, so keys such as "__proto__" stay plain data.
    Object.fromEntries(
      Object.entries(value).map(([key, entry]): [string, JsonValue] => {
        if (isSensitiveKey(key) && entry !== null && entry !== '' && entry !== REDACTED) {
          onRedact();
          return [key, REDACTED];
        }
        return [key, json(entry)];
      }),
    );

  const json = (value: JsonValue): JsonValue => {
    if (typeof value === 'string') return text(value);
    if (Array.isArray(value)) return value.map(json);
    if (value !== null && typeof value === 'object') return object(value);
    return value;
  };

  return {
    text,
    json,
    object,
    rich: (value) => mapRichText(value, text),
    get count() {
      return count;
    },
  };
}
