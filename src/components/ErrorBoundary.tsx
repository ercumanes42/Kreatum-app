import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // En producción, aquí se podría enviar a un servicio como Sentry
    console.error('Kreatum ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            textAlign: 'center',
            background: '#f8fafc',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚗️</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.5rem', color: '#102F40' }}>
            Algo salió mal
          </h1>
          <p style={{ color: '#404040', marginBottom: '2rem', maxWidth: '400px', lineHeight: 1.6 }}>
            La aplicación encontró un error inesperado. Intenta recargar la página.
            Si el problema persiste, contacta con tu facilitador.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.75rem 2rem',
              background: '#A2549C',
              color: 'white',
              border: 'none',
              borderRadius: '1rem',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: 500,
            }}
          >
            Recargar página
          </button>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre
              style={{
                marginTop: '2rem',
                padding: '1rem',
                background: '#fee2e2',
                borderRadius: '0.5rem',
                fontSize: '0.75rem',
                textAlign: 'left',
                maxWidth: '600px',
                overflow: 'auto',
                color: '#991b1b',
              }}
            >
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
