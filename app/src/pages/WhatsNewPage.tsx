import { useNavigate } from 'react-router-dom';
import { APP_VERSION } from '../lib/version';

export default function WhatsNewPage() {
  const n = useNavigate();
  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Nouveautés</h1>
          <div className="screen-sub">Version {APP_VERSION}</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => n(-1)}>Retour</button>
      </div>

      <div className="card">
        <div className="card-title">Novembre 2026 — 2.1.3</div>
        <ul className="whats-new">
          <li>⌨️ Saisie fluide : pseudo, bio, recherche et formulaires de Rencontres acceptent tout le texte d’un coup, sans perdre le curseur</li>
          <li>📸 Photo de profil : compression sur l’appareil, enregistrement immédiat et aperçu « Photo prête » — fini le chargement sans fin</li>
          <li>🗺️ Carte : la recherche ne recouvre plus Parcours, Événements et Sortie, et le bouton de localisation reste visible au-dessus de la bannière</li>
          <li>🧭 Itinéraire dans l’app : adresse réelle de départ et d’arrivée, tracé et consignes à pied, à vélo, en voiture et en transports en commun, correspondances comprises</li>
          <li>🚩 Sorties : plus d’erreur « index requis » sur « Mes sorties », et l’organisateur ne se retrouve plus en liste d’attente</li>
        </ul>
      </div>

      <div className="card">
        <div className="card-title">Novembre 2026 — 2.1.0</div>
        <ul className="whats-new">
          <li>🤝 Publicités désormais servies par <strong>Unity LevelPlay</strong>, avec Meta Audience Network en in-app bidding : plus de réseaux en concurrence, donc de meilleurs revenus pour vos ElyCoins</li>
          <li>🎬 Vidéo récompensée « ElyCoin » : une pub visionnée jusqu’au bout crédite toujours 0,1 EC, bornée à une récompense par heure</li>
          <li>🔐 Consentement RGPD transmis à la médiation avant toute enchère, toujours révocable depuis votre profil</li>
          <li>🏷️ Libellés visibles sous les onglets : les six destinations se lisent d’un coup d’œil, badges de notifications compris</li>
          <li>🎯 Accueil réorganisé : le compteur et la validation restent dominants, les raccourcis passent en grille compacte repliable</li>
          <li>🌓 Réglage d’affichage : Système, Sombre ou Contraste renforcé</li>
          <li>🔠 Textes secondaires agrandis : plus rien d’utile sous 12 px, y compris dans les graphiques et les défis</li>
          <li>📅 Rencontres : date et heure affichées dans la langue de l’appareil, fuseau horaire précisé, et plus de sortie créée dans le passé</li>
          <li>🏆 La version affichée dans le profil vient du build : fini les incohérences entre le Profil et la fiche Play Store</li>
        </ul>
      </div>

      <div className="card">
        <div className="card-title">Novembre 2026 — 2.0.0</div>
        <ul className="whats-new">
          <li>🎯 Nouvelles publicités, servies par Meta Audience Network</li>
          <li>🔐 Écran de consentement clair : annonces personnalisées ou non, modifiable à tout moment depuis votre profil</li>
          <li>🛡️ Vos pas, sorties et données de santé ne sont jamais transmis à la régie</li>
          <li>📱 Bannière discrète en bas d’écran, sans jamais masquer les boutons</li>
        </ul>
      </div>

      <div className="card">
        <div className="card-title">Octobre 2026</div>
        <ul className="whats-new">
          <li>⏸ Pause et reprise d’une sortie, pauses exclues de l’allure</li>
          <li>🧭 Export GPX (Strava, Garmin) et CSV de vos sorties et de vos pas</li>
          <li>✏️ Titre, note et météo ressentie sur chaque sortie</li>
          <li>🔎 Filtres par type, période et distance + pagination de « Mes sorties »</li>
          <li>📶 Qualité du signal GPS en direct et mode économie de batterie</li>
          <li>📊 Résumés de la semaine et du mois, avec comparaison et partage</li>
          <li>🎯 Objectif de sortie avec progression en direct et notification</li>
          <li>🗺️ Cartes partagées : styles Voyager, Sombre et Satellite</li>
        </ul>
      </div>

      <div className="card">
        <div className="card-title">Août 2026</div>
        <ul className="whats-new">
          <li>🔐 Compte, e-mail et contrôles ElyCoins renforcés</li>
          <li>📊 Historique, objectifs, distance et badges</li>
          <li>🤝 Recherche, partage, réactions et profils publics</li>
          <li>🏆 Classements jour, semaine, mois et amis</li>
          <li>📍 Partenaires proches, itinéraires et offres</li>
          <li>🔔 Rappels de validation et notifications</li>
          <li>🛡️ Export et suppression de vos données</li>
        </ul>
      </div>
    </div>
  );
}
