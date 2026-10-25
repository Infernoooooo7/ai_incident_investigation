import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkEndpoint,
  checkModelName,
  DEFAULT_MODEL_CONFIG,
  isCloudModelName,
  loadModelConfig,
  saveModelConfig,
  validateConfig,
} from './config';

describe('checkEndpoint', () => {
  it.each([
    ['http://127.0.0.1:11434', 'http://127.0.0.1:11434'],
    ['http://localhost:11434/', 'http://localhost:11434'],
    ['http://[::1]:11434', 'http://[::1]:11434'],
    ['http://127.8.9.10:8080/api', 'http://127.8.9.10:8080'],
  ])('accepts the loopback endpoint %s', (endpoint, origin) => {
    expect(checkEndpoint(endpoint)).toEqual({ ok: true, value: origin });
  });

  it.each([
    'https://ollama.com',
    'http://192.168.1.10:11434',
    'http://example.com:11434',
    'http://localhost.example.com:11434',
  ])('refuses the non-local endpoint %s', (endpoint) => {
    expect(checkEndpoint(endpoint)).toEqual({
      ok: false,
      reason: expect.stringContaining('must be on this computer'),
    });
  });

  it('refuses malformed URLs, other schemes, and embedded credentials', () => {
    expect(checkEndpoint('not a url').ok).toBe(false);
    expect(checkEndpoint('ftp://localhost:21').ok).toBe(false);
    expect(checkEndpoint('http://user:pass@localhost:11434').ok).toBe(false);
  });
});

describe('model names', () => {
  it('recognizes Ollama cloud models', () => {
    expect(isCloudModelName('gemma4:cloud')).toBe(true);
    expect(isCloudModelName('gpt-oss:120b-cloud')).toBe(true);
    expect(isCloudModelName('granite4.2:3b')).toBe(false);
    expect(isCloudModelName('mycloudmodel')).toBe(false);
  });

  it('validates names before any request is made', () => {
    expect(checkModelName('  granite4.2:3b ')).toEqual({ ok: true, value: 'granite4.2:3b' });
    expect(checkModelName('').ok).toBe(false);
    expect(checkModelName('two words').ok).toBe(false);
    expect(checkModelName('gemma4:cloud')).toEqual({
      ok: false,
      reason: expect.stringContaining('remote servers'),
    });
  });
});

describe('validateConfig and persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('clamps numbers and falls back for non-numbers', () => {
    const result = validateConfig({
      ...DEFAULT_MODEL_CONFIG,
      timeoutMs: Number.NaN,
      contextTokens: 10,
    });
    expect(result).toEqual({
      ok: true,
      value: { ...DEFAULT_MODEL_CONFIG, timeoutMs: 180_000, contextTokens: 4096 },
    });
  });

  it('defaults to IBM Granite 4.2 3B on the local Ollama port', () => {
    expect(DEFAULT_MODEL_CONFIG).toMatchObject({
      endpoint: 'http://127.0.0.1:11434',
      model: 'granite4.2:3b',
    });
  });

  it('round-trips settings and ignores stored values that fail validation', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    saveModelConfig({ ...DEFAULT_MODEL_CONFIG, model: 'qwen3.5:4b' });
    expect(loadModelConfig().model).toBe('qwen3.5:4b');
    store.set('aii.local-model', JSON.stringify({ endpoint: 'https://example.com' }));
    expect(loadModelConfig()).toEqual(DEFAULT_MODEL_CONFIG);
  });

  it('falls back to defaults when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadModelConfig()).toEqual(DEFAULT_MODEL_CONFIG);
  });
});
