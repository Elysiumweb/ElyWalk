import { useNavigate } from 'react-router-dom';

export default function WhatsNewPage() {
  const navigate = useNavigate();
  return (
    <div className="screen">
      <div className="screen-header">
        <div>
          <h1 className="screen-title">Nouveautés</h1>
          <div className="screen-sub">Version 1.3.1</div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>Retour</button>
      </div>
      <div className="card">
        <div className="card-title">Octobre 2026</div>
        <ul className="whats-new">
          <li>📣 Publicités AdMob de production : ouverture, interstitielles et récompensées</li>
          <li>🎁 Regardez une vidéo récompensée pour gagner 0,1 ElyCoin</li>
          <li>🛡️ Consentement publicitaire et enchaînement des annonces plus fiables</li>
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
