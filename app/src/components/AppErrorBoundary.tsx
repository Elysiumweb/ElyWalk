import { Component, type ErrorInfo, type ReactNode } from 'react';
import { showStartupFallback } from '../lib/startup-guard';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Filet de sécurité de l'interface.
 *
 * Sans lui, une exception levée pendant le rendu (donnée inattendue venue de
 * Firestore, appareil exotique, mémoire insuffisante…) démonte tout l'arbre
 * React : l'écran reste blanc et l'application semble plantée au lancement.
 * Ici, l'utilisateur voit un écran de secours avec un bouton « Réessayer ».
 */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ElyWalk] erreur d’interface', error, info.componentStack);
    // Affiche aussi l'écran de secours DOM (utile si React ne rend plus rien).
    showStartupFallback(error);
  }

  render(): ReactNode {
    if (this.state.failed) {
      // `showStartupFallback` a déjà posé le contenu de secours dans #root.
      return null;
    }
    return this.props.children;
  }
}
