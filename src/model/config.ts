/**
 * Configuration for the optional local-model summary.
 *
 * Only loopback endpoints are accepted, so trace data can be sent to a runtime
 * on this computer and nowhere else. Settings contain no secrets and are kept
 * in this browser's localStorage when available.
 */

export interface ModelConfig {
  /** Base URL of the local Ollama server. Must be a loopback address. */
  endpoint: string;
  /** Ollama model tag, e.g. `granite4.2:3b`. */
  model: string;
  /** Abort a summary request after this long. The first request also loads the model. */
  timeoutMs: number;
  /** Context window requested from the runtime (`num_ctx`). */
  contextTokens: number;
}

/** Default: IBM Granite 4.2 3B on Ollama (Apache 2.0). See docs/research-notes.md. */
export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  endpoint: 'http://127.0.0.1:11434',
  model: 'granite4.2:3b',
  timeoutMs: 180_000,
  contextTokens: 16_384,
};

const STORAGE_KEY = 'aii.local-model';

export type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/** Accepts only http(s) URLs on this computer (localhost, 127.0.0.0/8, or [::1]). */
export function checkEndpoint(endpoint: string): Check<string> {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return { ok: false, reason: 'The endpoint is not a valid URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'The endpoint must start with http:// or https://.' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'The endpoint must not contain a user name or password.' };
  }
  if (!isLoopbackHost(url.hostname)) {
    return {
      ok: false,
      reason: `The endpoint must be on this computer (localhost or 127.0.0.1), not ${url.hostname}. Trace data is never sent to other hosts.`,
    };
  }
  return { ok: true, value: url.origin };
}

/**
 * Ollama cloud models (for example `gemma4:cloud` or `gpt-oss:120b-cloud`) run
 * prompts on remote servers, so they are refused.
 */
export function isCloudModelName(model: string): boolean {
  return /(^|[:\-_/])cloud$/i.test(model.trim());
}

export function checkModelName(model: string): Check<string> {
  const trimmed = model.trim();
  if (trimmed === '') return { ok: false, reason: 'Enter a model name, such as granite4.2:3b.' };
  if (/\s/.test(trimmed) || trimmed.length > 200) {
    return { ok: false, reason: 'Model names cannot contain spaces.' };
  }
  if (isCloudModelName(trimmed)) {
    return {
      ok: false,
      reason: `${trimmed} is an Ollama cloud model, which processes prompts on remote servers. Choose a model that runs locally.`,
    };
  }
  return { ok: true, value: trimmed };
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : fallback;
}

/** Validates a full config, returning the normalized config or the first problem found. */
export function validateConfig(config: ModelConfig): Check<ModelConfig> {
  const endpoint = checkEndpoint(config.endpoint);
  if (!endpoint.ok) return endpoint;
  const model = checkModelName(config.model);
  if (!model.ok) return model;
  return {
    ok: true,
    value: {
      endpoint: endpoint.value,
      model: model.value,
      timeoutMs: clamp(config.timeoutMs, 10_000, 900_000, DEFAULT_MODEL_CONFIG.timeoutMs),
      contextTokens: clamp(config.contextTokens, 4096, 131_072, DEFAULT_MODEL_CONFIG.contextTokens),
    },
  };
}

export function loadModelConfig(): ModelConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_MODEL_CONFIG;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_MODEL_CONFIG;
    const candidate = { ...DEFAULT_MODEL_CONFIG, ...(parsed as Partial<ModelConfig>) };
    const checked = validateConfig({
      endpoint: String(candidate.endpoint),
      model: String(candidate.model),
      timeoutMs: Number(candidate.timeoutMs),
      contextTokens: Number(candidate.contextTokens),
    });
    return checked.ok ? checked.value : DEFAULT_MODEL_CONFIG;
  } catch {
    return DEFAULT_MODEL_CONFIG;
  }
}

export function saveModelConfig(config: ModelConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage can be blocked; the setting then lasts for this page view only.
  }
}
