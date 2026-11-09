import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Isole une erreur de rendu d'un écran sans masquer les erreurs natives. */
export default class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ElyWalk] Erreur de rendu', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="screen" role="alert">
          <h1 className="screen-title">Cet écran est temporairement indisponible</h1>
          <p>Une erreur s’est produite. Vous pouvez réessayer ou choisir un autre onglet.</p>
          <button className="btn btn-outline" onClick={() => this.setState({ failed: false })}>Réessayer</button>
        </main>
      );
    }
    return this.props.children;
  }
}
