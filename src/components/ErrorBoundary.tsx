import { OctagonAlert } from 'lucide-react';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { StateMessage } from './StateMessage';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Keeps a rendering bug in one view from blanking the whole app. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('View failed to render', error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <StateMessage
        tone="danger"
        role="alert"
        icon={<OctagonAlert />}
        title="This view could not be displayed"
        actions={
          <>
            <button type="button" className="button" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <a className="button button--ghost" href="#/">
              Go to Runs
            </a>
          </>
        }
      >
        <p>
          Something in this run's data could not be rendered. Details: <code>{error.message}</code>
        </p>
      </StateMessage>
    );
  }
}
