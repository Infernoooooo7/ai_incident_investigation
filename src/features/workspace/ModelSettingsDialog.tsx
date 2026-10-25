import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { DEFAULT_MODEL_CONFIG, validateConfig } from '../../model/config';
import type { ModelConfig } from '../../model/config';

interface ModelSettingsDialogProps {
  open: boolean;
  config: ModelConfig;
  onClose: () => void;
  onSave: (config: ModelConfig) => void;
}

/** Endpoint and model for local analysis. Only addresses on this computer are accepted. */
export function ModelSettingsDialog({ open, config, onClose, onSave }: ModelSettingsDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Local model settings" className="dialog--narrow">
      {/* Remounted each time the dialog opens, so the form starts from the saved settings. */}
      {open && <SettingsForm config={config} onCancel={onClose} onSave={onSave} />}
    </Dialog>
  );
}

function SettingsForm({
  config,
  onCancel,
  onSave,
}: {
  config: ModelConfig;
  onCancel: () => void;
  onSave: (config: ModelConfig) => void;
}) {
  const id = useId();
  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [model, setModel] = useState(config.model);
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(Math.round(config.timeoutMs / 1000)));
  const [contextTokens, setContextTokens] = useState(String(config.contextTokens));
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const checked = validateConfig({
      endpoint,
      model,
      timeoutMs: Number(timeoutSeconds) * 1000,
      contextTokens: Number(contextTokens),
    });
    if (!checked.ok) {
      setError(checked.reason);
      return;
    }
    onSave(checked.value);
  };

  const reset = () => {
    setEndpoint(DEFAULT_MODEL_CONFIG.endpoint);
    setModel(DEFAULT_MODEL_CONFIG.model);
    setTimeoutSeconds(String(DEFAULT_MODEL_CONFIG.timeoutMs / 1000));
    setContextTokens(String(DEFAULT_MODEL_CONFIG.contextTokens));
    setError(null);
  };

  return (
    <form className="dialog__form" onSubmit={submit} noValidate>
      <div className="dialog__body settings-form">
        <p className="muted">
          The app talks to an{' '}
          <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
            Ollama
          </a>{' '}
          server on this computer. Addresses on other hosts are refused, and so are Ollama cloud
          models, because they would send trace data off this machine. Settings are saved in this
          browser.
        </p>
        <div className="field">
          <label htmlFor={`${id}-endpoint`} className="field-label">
            Ollama address
          </label>
          <input
            id={`${id}-endpoint`}
            className="input"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
          />
          <p className="field-hint">localhost, 127.0.0.1, or [::1] only.</p>
        </div>
        <div className="field">
          <label htmlFor={`${id}-model`} className="field-label">
            Model
          </label>
          <input
            id={`${id}-model`}
            className="input"
            autoComplete="off"
            spellCheck={false}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
          <p className="field-hint">
            A model you have pulled, for example <code className="inline-code">granite4.2:3b</code>.
          </p>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor={`${id}-timeout`} className="field-label">
              Timeout (seconds)
            </label>
            <input
              id={`${id}-timeout`}
              className="input"
              type="number"
              inputMode="numeric"
              min={10}
              max={900}
              value={timeoutSeconds}
              onChange={(event) => setTimeoutSeconds(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-context`} className="field-label">
              Context window (tokens)
            </label>
            <input
              id={`${id}-context`}
              className="input"
              type="number"
              inputMode="numeric"
              min={4096}
              max={131072}
              step={1024}
              value={contextTokens}
              onChange={(event) => setContextTokens(event.target.value)}
            />
          </div>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog__footer">
        <button type="button" className="button button--ghost" onClick={reset}>
          Reset to defaults
        </button>
        <span className="dialog__spacer" />
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button button--primary">
          Save settings
        </button>
      </div>
    </form>
  );
}
