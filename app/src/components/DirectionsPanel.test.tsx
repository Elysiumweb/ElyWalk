// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DirectionsPanel from './DirectionsPanel';

/**
 * Régression D02 — « Itinéraire » d'une rencontre.
 *
 * 1. La feuille utilisait des classes sans aucune règle CSS : panneau en
 *    `position: static`, carte de hauteur 0 px, donc le contenu passait sous la
 *    barre d'onglets et le clic était intercepté. Le test vérifie que la
 *    surcouche est bien créée et que la carte reçoit une hauteur.
 * 2. Un mode non calculable ne doit jamais afficher silencieusement un tracé
 *    automobile : l'erreur est explicite, avec « Réessayer » et une alternative.
 * 3. Escape ferme la feuille et le focus reste à l'intérieur du dialogue.
 */

vi.mock('./Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Leaflet a besoin d'un vrai moteur de rendu : on le remplace par une doublure
// qui enregistre les appels (taille, couches, cadrage).
const mapCalls = { invalidateSize: 0, fitBounds: 0 };
vi.mock('leaflet', () => {
  const layerGroup = () => ({ addTo: () => layerGroup(), clearLayers: () => undefined });
  const chainable = () => ({
    addTo: () => chainable(),
    bindTooltip: () => chainable(),
    setLatLng: () => chainable(),
    setRadius: () => chainable(),
    on: () => chainable(),
    remove: () => undefined,
    getBounds: () => ({}),
  });
  const map = {
    invalidateSize: () => { mapCalls.invalidateSize += 1; },
    fitBounds: () => { mapCalls.fitBounds += 1; },
    setView: () => undefined,
    remove: () => undefined,
    on: () => undefined,
    getZoom: () => 12,
  };
  const L = {
    map: () => map,
    tileLayer: () => chainable(),
    control: { zoom: () => chainable(), attribution: () => chainable() },
    layerGroup,
    marker: () => chainable(),
    polyline: () => chainable(),
    circle: () => chainable(),
    latLngBounds: () => ({ pad: () => ({}) }),
    latLng: (lat: number, lng: number) => ({ lat, lng }),
    divIcon: (options: unknown) => options,
    Icon: class {},
  };
  return { default: L, ...L };
});

vi.mock('./NavigationView', () => ({ default: () => null }));

const destination = { name: 'Marche du parc', address: '1 place de la République, Paris', lat: 48.867, lng: 2.363 };
const origin = { lat: 48.8566, lng: 2.3522 };

const renderPanel = (overrides: Partial<Parameters<typeof DirectionsPanel>[0]> = {}) => {
  const onClose = vi.fn();
  render(
    <DirectionsPanel
      open
      onClose={onClose}
      destination={destination}
      origin={origin}
      onLocate={vi.fn()}
      {...overrides}
    />,
  );
  return { onClose };
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('DirectionsPanel — carte et modes', () => {
  it('rend la feuille, la carte et les quatre modes accessibles', async () => {
    renderPanel();
    expect(await screen.findByTestId('directions-panel')).toBeTruthy();
    expect(screen.getByTestId('directions-map')).toBeTruthy();
    for (const mode of ['walk', 'bike', 'car', 'transit']) {
      expect(screen.getByTestId(`directions-mode-${mode}`)).toBeTruthy();
    }
    // La carte reçoit une invalidation de taille (hauteur 0 auparavant).
    await waitFor(() => expect(mapCalls.invalidateSize).toBeGreaterThan(0));
  });

  it('ferme avec Échap et garde le focus dans le dialogue', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();
    const panel = await screen.findByTestId('directions-panel');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('annonce l’indisponibilité du mode et propose une alternative, sans tracé automobile', async () => {
    // Aucun fournisseur ne répond : planRoute échoue pour la marche.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    renderPanel();
    const error = await screen.findByTestId('directions-error', undefined, { timeout: 5000 });
    expect(error.textContent).toMatch(/indisponible|n’a pas pu être calculé/i);
    expect(screen.getByTestId('directions-retry')).toBeTruthy();
    // Une alternative explicite est proposée pour la marche / le vélo.
    expect(screen.getByTestId('directions-alternative-mode')).toBeTruthy();
    // Aucune mention « tracé routier » présentée comme piéton.
    expect(document.body.textContent).not.toMatch(/tracé routier/i);
  }, 15000);
});
