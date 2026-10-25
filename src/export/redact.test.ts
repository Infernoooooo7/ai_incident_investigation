import { describe, expect, it } from 'vitest';
import { code, rich } from '../domain/richText';
import { createRedactor, isSensitiveKey, REDACTED } from './redact';

// Credential-shaped fixtures are assembled at runtime so secret scanners do
// not flag this file. None of them are real credentials.
const fake = {
  openAi: ['sk', 'proj', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('-'),
  github: `${'gh'}p_${'a1B2'.repeat(9)}`,
  aws: `${'AK'}IA${'ABCDEFGHIJKLMNOP'}`,
  slack: `${'xo'}xb-${'1234567890-abcdefghij'}`,
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ0ZXN0LXVzZXIifQ', 'c2lnbmF0dXJlLXZhbHVl'].join('.'),
};

describe('isSensitiveKey', () => {
  it.each([
    'password',
    'x-api-key',
    'NPM_TOKEN',
    'accessToken',
    'Authorization',
    'client_secret',
    'auth',
  ])('treats %s as sensitive', (key) => expect(isSensitiveKey(key)).toBe(true));

  it.each(['input_tokens', 'max_tokens', 'author', 'request_id', 'tokenizer', 'api_base'])(
    'leaves %s alone',
    (key) => expect(isSensitiveKey(key)).toBe(false),
  );
});

describe('createRedactor().text', () => {
  const redact = (value: string) => createRedactor().text(value);

  it('redacts bearer tokens and authorization headers', () => {
    expect(redact(`Bearer ${fake.jwt}`)).toBe(`Bearer ${REDACTED}`);
    expect(redact('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toBe(`Authorization: ${REDACTED}`);
  });

  it('redacts common provider key formats and JWTs', () => {
    for (const secret of [fake.openAi, fake.github, fake.aws, fake.slack, fake.jwt]) {
      expect(redact(`key is ${secret} ok`)).toBe(`key is ${REDACTED} ok`);
    }
  });

  it('redacts secret assignments but keeps the key name', () => {
    expect(redact('password=hunter2 user=sam')).toBe(`password=${REDACTED} user=sam`);
    expect(redact('export GITHUB_TOKEN=abc123')).toBe(`export GITHUB_TOKEN=${REDACTED}`);
    expect(redact('{"client_secret": "s3cr3t"}')).toBe(`{"client_secret": "${REDACTED}"}`);
  });

  it('redacts passwords in URLs and sensitive query parameters', () => {
    expect(redact('postgres://svc:pa55word@db.internal:5432/app')).toBe(
      `postgres://svc:${REDACTED}@db.internal:5432/app`,
    );
    expect(redact('https://x.example/cb?state=1&access_token=abc.def')).toBe(
      `https://x.example/cb?state=1&access_token=${REDACTED}`,
    );
  });

  it('redacts private key blocks', () => {
    const pem = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    expect(redact(`key:\n${pem}\nend`)).toBe('key:\n[REDACTED PRIVATE KEY]\nend');
  });

  it('leaves ordinary operational text untouched', () => {
    for (const text of [
      'Request to tickets-api.internal.example timed out after 30000 ms',
      'max_tokens: 1024',
      'The token budget was exceeded',
      'Bearer tokens must be rotated',
      'https://docs.example.com/api/rate-limits?page=2',
    ]) {
      expect(redact(text)).toBe(text);
    }
  });
});

describe('createRedactor().json', () => {
  it('redacts values under sensitive keys at any depth and counts each one', () => {
    const redactor = createRedactor();
    const result = redactor.json({
      headers: { authorization: `Bearer ${fake.jwt}`, 'x-request-id': 'req_1' },
      env: { NPM_TOKEN: 'abc', CI: 'true' },
      usage: { input_tokens: 1200 },
      list: [{ password: 'pw' }, 'plain'],
      empty: { api_key: '' },
    });
    expect(result).toEqual({
      headers: { authorization: REDACTED, 'x-request-id': 'req_1' },
      env: { NPM_TOKEN: REDACTED, CI: 'true' },
      usage: { input_tokens: 1200 },
      list: [{ password: REDACTED }, 'plain'],
      empty: { api_key: '' },
    });
    expect(redactor.count).toBe(3);
  });

  it('is idempotent', () => {
    const first = createRedactor();
    const once = first.json({ token: 'abc', note: 'password=hunter2' });
    const second = createRedactor();
    expect(second.json(once)).toEqual(once);
    expect(second.count).toBe(0);
  });

  it('keeps "__proto__" keys as plain data', () => {
    const parsed = JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}') as Record<
      string,
      never
    >;
    const result = createRedactor().json(parsed) as Record<string, unknown>;
    expect(Object.hasOwn(result, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('createRedactor().rich', () => {
  it('redacts text and code segments but keeps event references', () => {
    const redactor = createRedactor();
    const value = rich`Sent ${code(`Bearer ${fake.jwt}`)} with password=pw at ${{ type: 'event', eventId: 'evt_1' }}`;
    expect(redactor.rich(value)).toEqual([
      { type: 'text', text: 'Sent ' },
      { type: 'code', text: `Bearer ${REDACTED}` },
      { type: 'text', text: ` with password=${REDACTED} at ` },
      { type: 'event', eventId: 'evt_1' },
    ]);
    expect(redactor.count).toBe(2);
  });
});
