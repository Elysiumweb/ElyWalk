import { useNavigate, useParams } from 'react-router-dom';

const content = {
  terms: { title: 'Conditions générales d’utilisation', body: <>ElyWalk récompense l’activité déclarée par l’appareil. Les ElyCoins ne sont ni une monnaie ni un placement. Tout usage frauduleux, automatisé ou contournant les contrôles peut entraîner la suspension du compte et l’annulation des gains. Les offres, taux de conversion et conditions peuvent évoluer après information des utilisateurs. L’utilisateur doit être âgé d’au moins 15 ans ou disposer de l’autorisation de son représentant légal.</> },
  privacy: { title: 'Politique de confidentialité', body: <>ElyWalk traite votre identité de compte, pseudo, activité physique, statistiques de marche, localisation uniquement lorsque vous utilisez la carte, identifiants techniques anti-fraude, relations sociales et opérations ElyCoins. Ces données servent au fonctionnement, à la sécurité et aux récompenses. Firebase et Google AdMob agissent comme prestataires. Vous pouvez exporter ou supprimer vos données depuis Profil. Les données de santé ne sont jamais revendues. Contact DPO : privacy@elysium-france.org.</> },
  notices: { title: 'Mentions légales', body: <>Éditeur : Association Elysium, France. Directeur de publication : le Président de l’association. Hébergement et services techniques : Google Firebase. Contact : contact@elysium-france.org. Version juridique du 18 août 2026.</> },
};
export default function LegalPage() {
  const navigate = useNavigate();
  const { doc = 'terms' } = useParams();
  const item = content[doc as keyof typeof content] || content.terms;
  return <div className="screen legal-page"><div className="screen-header"><h1 className="screen-title">{item.title}</h1><button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>Retour</button></div><div className="card"><p>{item.body}</p><h2>Vos droits</h2><p>Vous disposez des droits d’accès, rectification, effacement, limitation, portabilité et opposition. Une réclamation peut être déposée auprès de la CNIL.</p></div></div>;
}
