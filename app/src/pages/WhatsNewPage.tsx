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
        <div className="card-title">Novembre 2026 — 2.2.3</div>
        <ul className="whats-new">
          <li>🧭 <strong>Itinéraires qui marchent vraiment</strong> : à pied, à vélo, en voiture et en transports, le tracé s’affiche sur la carte ElyWalk — plus d’écran « indisponible dans ce mode », et plus de renvoi vers une application externe</li>
          <li>📍 <strong>Votre position bouge en direct</strong> : la carte vous suit pendant la marche au lieu de rester figée sur l’endroit où vous avez ouvert l’application</li>
          <li>🔔 <strong>Notifications utiles</strong> : message reçu, demande d’ami, rencontre proposée près de chez vous (rayon de 10 km par défaut, réglable) et rappel des sorties où vous êtes inscrit</li>
          <li>⚙️ <strong>Profil réorganisé</strong> : « Progression » (paliers, statistiques, badges) et « Réglages » (notifications, apparence, langue, compte, paiement) ont chacun leur écran, sans perdre aucun réglage</li>
          <li>✍️ <strong>Confirmations claires</strong> : les actions sensibles (déconnexion, suppression d’un compte, d’une sortie ou d’un parcours, blocage) expliquent leurs conséquences avant d’agir, et conservent ce que vous avez saisi en cas d’erreur</li>
          <li>🎨 Lisibilité et accessibilité : contraste renforcé, cibles tactiles plus grandes, zoom réactivé</li>
          <li>📢 Une publicité s’affiche au départ et à l’arrivée d’une sortie GPS, y compris depuis « Rencontres »</li>
          <li>⬆️ <strong>Nouvel écran de mise à jour au lancement</strong> : quand une version plus récente est publiée sur le Play Store, ElyWalk vous prévient dès l’ouverture — avec un bouton « Mettre à jour » qui ouvre directement la fiche, et un simple « Plus tard » si la mise à jour est facultative</li>
        </ul>
      </div>

      <div className="card">
        <div className="card-title">Novembre 2026 — 2.2.2</div>
        <ul className="whats-new">
          <li>👥 <strong>Vos amis s’affichent enfin</strong> : la liste ne reste plus bloquée sur « Chargement… », même avec beaucoup d’amis — une règle de sécurité trop coûteuse faisait refuser la lecture</li>
          <li>🔁 Messages, demandes d’ami et encouragements se chargent de nouveau, avec un message clair si le réseau refuse et un bouton <strong>Réessayer</strong> qui relance vraiment</li>
          <li>🔗 <strong>Lien de parrainage corrigé</strong> : le partage envoie bien <em>elywalk-2f7ba.web.app/?ref=…</em> et non plus une adresse <em>localhost</em> inutilisable pour votre destinataire</li>
          <li>📤 Le partage propose le lien séparément du texte : il n’est plus tronqué par les applications de messagerie</li>
        </ul>
      </div>

      <div className="card">
        <div className="card-title">Novembre 2026 — 2.2.1</div>
        <ul className="whats-new">
          <li>🏆 <strong>Classement à nouveau complet</strong> : les autres marcheurs s’affichent réellement (podium, top 100) au lieu de votre seule ligne — une règle de sécurité trop coûteuse faisait refuser toute la requête</li>
          <li>📊 Colonnes « 7 jours » et « 30 jours » : elles affichent de nouveau des valeurs pour les autres profils</li>
          <li>⚡ Moins de requêtes à l’ouverture du classement : l’historique n’est plus chargé inutilement pour les onglets Solde et Pas cumulés</li>
          <li>🔒 Le blocage reste actif : un profil bloqué n’apparaît plus dans votre fil, ses sorties restent fermées et aucune interaction n’est possible</li>
        </ul>
      </div>

      <div className="card">
        <div className="card-title">Novembre 2026 — 2.2.0</div>
        <ul className="whats-new">
          <li>📶 <strong>Sorties hors connexion</strong> : une sortie vécue sans réseau est conservée sur votre téléphone puis envoyée automatiquement au retour du réseau, avec un bandeau « synchronisation en attente » et un bouton Réessayer</li>
          <li>🔒 <strong>Note personnelle vraiment privée</strong> : votre note de sortie n’est plus jamais jointe au tracé partagé ; le texte visible par vos amis est un commentaire séparé</li>
          <li>🗑️ <strong>Suppression de compte fiable</strong> : elle va jusqu’au bout même après avoir validé des pas, efface messages, badges et parcours, et vérifie qu’il ne reste rien</li>
          <li>📦 <strong>Export complet de vos données</strong> : tout votre historique (sorties et tracés GPS, pas, transactions, messages, amis, parcours, défis, retraits) dans un seul fichier, sans limite de profondeur</li>
          <li>🔗 <strong>Partage maîtrisé</strong> : un lien de partage se révoque à tout moment, et une sortie « amis » n’est réellement lisible que par vos amis</li>
          <li>🩺 <strong>Diagnostic intégré</strong> : version, réseau, notifications et journal des erreurs dans un rapport que vous choisissez d’envoyer (aucune donnée personnelle)</li>
          <li>🏅 Classement : chaque onglet classe selon la métrique affichée (jour, cumul, 7 / 30 jours), avec vos amis même hors du top 50</li>
          <li>⚡ Fluidité : moins de re-rendus pendant une sortie GPS et un classement qui ne recharge plus tout à chaque onglet</li>
          <li>🧩 Plus d’écrans bloqués en « Chargement… » : un message clair et un bouton Réessayer en cas de réseau coupé</li>
        </ul>
      </div>

      <div className="card">
        <div className="card-title">Novembre 2026 — 2.1.4</div>
        <ul className="whats-new">
          <li>🛡️ Transparence publicitaire : l’écran de consentement et la politique de confidentialité expliquent désormais la consultation de la <strong>liste des applications installées</strong> (§ 4.1), exigée par le formulaire Sécurité des données de Google Play</li>
          <li>🚶‍♂️ Itinéraires plus justes : la marche, le vélo et la voiture sont calculés par <strong>Valhalla</strong> (OpenStreetMap), qui respecte réellement le mode choisi — fini le trajet « à vélo » qui suivait les grands axes</li>
          <li>🔐 Confidentialité publicitaire renforcée : refus de la vente/partage transmis au SDK (setCCPA) et application déclarée non destinée aux enfants (setCOPPA)</li>
        </ul>
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
