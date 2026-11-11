import { useNavigate } from 'react-router-dom';
import { APP_VERSION, BUILD_STAMP } from '../lib/version';

// ============================================================================
// Nouveautés — la version affichée vient de `package.json` (via `lib/version`),
// jamais d'une chaîne saisie à la main : elle ne peut plus être oubliée.
// ============================================================================

type Release = { label: string; items: string[] };

const RELEASES: Release[] = [
  {
    label: 'Novembre 2026',
    items: [
      '🎯 Régie publicitaire migrée vers Chartboost Mediation (annonces servies par Meta Audience Network)',
      '🔐 Consentement publicitaire clair : annonces personnalisées ou non, modifiable à tout moment depuis le profil',
      '🛡️ Vos pas, sorties et données de santé ne sont jamais transmis à la régie',
      '🎨 Nouveau réglage Affichage : Système, Sombre ou Contraste renforcé',
      '🔤 Textes secondaires agrandis et libellés d’onglets toujours visibles',
      '➖ Accueil réorganisé : le compteur de pas et « Valider mes pas » en premier',
      '🗓️ Rencontres : dates et heures affichées dans la langue et le fuseau de l’appareil, création d’une rencontre passée bloquée',
    ],
  },
  {
    label: 'Octobre 2026',
    items: [
      '⏸ Pause et reprise d’une sortie, pauses exclues de l’allure',
      '🧭 Export GPX (Strava, Garmin) et CSV de vos sorties et de vos pas',
      '✏️ Titre, note et météo ressentie sur chaque sortie',
      '🔎 Filtres par type, période et distance + pagination de « Mes sorties »',
      '📶 Qualité du signal GPS en direct et mode économie de batterie',
      '📊 Résumés de la semaine et du mois, avec comparaison et partage',
      '🎯 Objectif de sortie avec progression en direct et notification',
      '🗺️ Cartes partagées : styles Voyager, Sombre et Satellite',
    ],
  },
  {
    label: 'Août 2026',
    items: [
      '🔐 Compte, e-mail et contrôles ElyCoins renforcés',
      '📊 Historique, objectifs, distance et badges',
      '🤝 Recherche, partage, réactions et profils publics',
      '🏆 Classements jour, semaine, mois et amis',
      '📍 Partenaires proches, itinéraires et offres',
      '🔔 Rappels de validation et notifications',
      '🛡️ Export et suppression de vos données',
    ],
  },
];

export default function WhatsNewPage() {
  const navigate = useNavigate();
  return (
    <div className="screen" data-testid="whats-new-screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Nouveautés</h1>
          <div className="screen-sub" data-testid="whats-new-version">
            Version {APP_VERSION}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>Retour</button>
      </div>

      {RELEASES.map((release) => (
        <div className="card" key={release.label}>
          <div className="card-title">{release.label}</div>
          <ul className="whats-new">
            {release.items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ))}

      <p className="text-muted-sm text-center">Build {BUILD_STAMP}</p>
    </div>
  );
}
