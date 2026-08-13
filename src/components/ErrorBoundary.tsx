import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from '../lib/clientLogger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportClientError('KREATUM ErrorBoundary caught', error);
    void info;
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <main
        className="min-h-screen grid place-items-center bg-kreatum-bg-light px-6 text-center"
        role="alert"
      >
        <div className="max-w-md">
          <div
            className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl bg-red-500/10 text-2xl font-bold text-red-600"
            aria-hidden="true"
          >
            !
          </div>
          <h1 className="text-2xl font-bold text-kreatum-dark">Algo salió mal</h1>
          <p className="mt-3 leading-relaxed text-kreatum-gray/75">
            KREATUM encontró un error inesperado. Recarga la página y, si continúa,
            comunica el problema al facilitador.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-7 rounded-xl bg-kreatum-purple px-6 py-3 font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-kreatum-purple focus-visible:ring-offset-2"
          >
            Recargar página
          </button>
          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-8 max-h-48 overflow-auto rounded-xl bg-red-50 p-4 text-left text-xs text-red-800">
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      </main>
    );
  }
}
