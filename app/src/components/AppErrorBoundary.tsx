import { Component, type ErrorInfo, type ReactNode } from 'react';
import { showStartupFallback } from '../lib/startup-guard';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** Empêche une erreur de rendu de démonter toute l'application sans recours. */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ElyWalk] erreur d’interface', error, info.componentStack);
    // Le rendu en échec est maintenant démonté : la racine peut accueillir le
    // contenu de secours même si React ne peut plus rien afficher.
    showStartupFallback(error);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
