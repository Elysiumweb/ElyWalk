import { useNavigate, useParams } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * Documents légaux ElyWalk.
 * À maintenir à jour (version datée en bas de chaque document) et à mettre
 * en cohérence avec la fiche « Sécurité des données » du Play Store.
 */

const CONTACT_EMAIL = 'contact@elysium-esport.fr';
const EDITOR = 'l’association Elysium, association loi 1901, RNA W772011943, 22 Avenue Lamartine, 77380 Combs-la-Ville, France';
const HOST = 'Google Firebase (Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irlande)';

interface LegalDoc {
  title: string;
  updated: string;
  body: ReactNode;
}

const content: Record<string, LegalDoc> = {
  terms: {
    title: 'Conditions générales d’utilisation',
    updated: '20 août 2026',
    body: (
      <>
        <h2>1. Éditeur</h2>
        <p>
          L’application ElyWalk est éditée par {EDITOR}. Elle est exploitée par l’équipe
          esport française Elysium. Contact :{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <h2>2. Objet et acceptation</h2>
        <p>
          ElyWalk récompense l’activité physique déclarée par l’appareil de l’utilisateur
          sous forme d’« ElyCoins ». En créant un compte ou en utilisant l’application,
          vous acceptez les présentes conditions. Si vous ne les acceptez pas, vous ne
          devez pas utiliser le service.
        </p>

        <h2>3. Compte et âge minimum</h2>
        <p>
          L’accès au service requiert d’avoir au moins <strong>15 ans</strong>, ou de
          disposer de l’autorisation de son représentant légal. Vous vous engagez à
          fournir des informations exactes et à ne pas usurper l’identité d’un tiers.
        </p>

        <h2>4. Nature des ElyCoins</h2>
        <p>
          Les ElyCoins sont des unités de fidélité internes au service. Ils{' '}
          <strong>ne constituent ni une monnaie, ni un instrument de paiement, ni un
          placement</strong>, et n’ont aucune valeur en dehors d’ElyWalk. Ils ne sont ni
          remboursables ni cessibles, sauf dispositions expresses de l’éditeur.
        </p>

        <h2>5. Utilisation loyale et lutte contre la fraude</h2>
        <p>
          Tout usage frauduleux, automatisé, ou contournant les contrôles (comptes
          multiples, manipulation du capteur, émulation, fausses publicités, parrainage
          frauduleux, etc.) peut entraîner la suspension du compte et l’annulation des
          gains. Les conversions (retraits) restent soumises à validation de l’éditeur.
        </p>

        <h2>6. Responsabilités</h2>
        <p>
          ElyWalk est fourni « en l’état ». L’éditeur ne garantit ni l’exactitude du
          comptage de pas (dépendant du capteur de l’appareil), ni la disponibilité
          continue du service. Les offres partenaires sont proposées par des tiers et
          relèvent de leur seule responsabilité.
        </p>

        <h2>7. Modifications, résiliation</h2>
        <p>
          Les présentes conditions, les taux de conversion et les offres peuvent évoluer
          après information des utilisateurs. Vous pouvez supprimer votre compte à tout
          moment depuis l’application (Profil → Supprimer définitivement mon compte).
        </p>

        <h2>8. Droit applicable</h2>
        <p>
          Les présentes conditions sont soumises au droit français. En cas de litige, une
          solution amiable sera recherchée avant toute action judiciaire.
        </p>
      </>
    ),
  },
  privacy: {
    title: 'Politique de confidentialité',
    updated: '20 août 2026',
    body: (
      <>
        <h2>1. Responsable du traitement</h2>
        <p>
          Le responsable du traitement est {EDITOR}. Pour toute question relative à vos
          données : <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>

        <h2>2. Données collectées</h2>
        <ul>
          <li><strong>Identité de compte</strong> : adresse e-mail, pseudo, photo de profil, identifiant Firebase.</li>
          <li><strong>Activité physique</strong> : nombre de pas, distance, calories estimées, objectifs, historique de validation, poids, taille et âge (données susceptibles de révéler votre état de santé).</li>
          <li><strong>Localisation</strong> : uniquement lorsque vous utilisez la carte interactive ou démarrez une sortie GPS, avec votre autorisation. Les points de parcours sont privés et supprimables.</li>
          <li><strong>Identifiants techniques anti-fraude</strong> : adresse IP, identifiant d’appareil, identifiant publicitaire (soumis à consentement).</li>
          <li><strong>Relations sociales</strong> : demandes d’amis, réactions, profil public.</li>
          <li><strong>Opérations</strong> : transactions ElyCoins, demandes de retrait, adresse PayPal le cas échéant.</li>
        </ul>

        <h2>3. Finalités et bases légales</h2>
        <ul>
          <li>Fourniture et fonctionnement du service (exécution du contrat).</li>
          <li>Sécurité et lutte contre la fraude (intérêt légitime).</li>
          <li>Récompenses et programme de fidélité (exécution du contrat).</li>
          <li>Publicité personnalisée ou non personnalisée (consentement, via le module de
            consentement Google).</li>
        </ul>

        <h2>4. Publicité (AdMob) et consentement</h2>
        <p>
          Les annonces sont servies par Google AdMob. Dans l’Espace économique européen
          et au Royaume-Uni, un formulaire de consentement (Google UMP / Funding Choices)
          est affiché avant toute publicité ; vous pouvez le modifier à tout moment depuis
          Profil → « Confidentialité des annonces ». Sans consentement, aucune annonce
          personnalisée n’est diffusée.
        </p>

        <h2>5. Destinataires</h2>
        <p>
          Google Firebase (hébergement, base de données, authentification, notifications)
          et Google AdMob (publicité) agissent en qualité de sous-traitants. Aucune donnée
          de santé n’est vendue ni cédée à des tiers à des fins commerciales.
        </p>

        <h2>6. Durées de conservation</h2>
        <p>
          Les données sont conservées tant que le compte est actif, puis supprimées dans un
          délai raisonnable après suppression du compte. Certaines données comptables ou
          liées à la sécurité peuvent être conservées plus longtemps lorsque la loi l’exige.
        </p>

        <h2>7. Transferts hors Union européenne</h2>
        <p>
          Les données sont susceptibles d’être transférées vers des serveurs de Google situés
          hors de l’Union européenne, dans le cadre des garanties appropriées (clauses
          contractuelles types).
        </p>

        <h2>8. Sécurité</h2>
        <p>
          L’accès aux données est protégé par des règles de sécurité, l’authentification
          Firebase et des contrôles d’intégrité. Aucun système n’étant infaillible, nous
          mettons en œuvre des mesures proportionnées aux risques.
        </p>
      </>
    ),
  },
  notices: {
    title: 'Mentions légales',
    updated: '20 août 2026',
    body: (
      <>
        <h2>Éditeur</h2>
        <p>
          {EDITOR}. L’équipe esport Elysium est éditée par l’association Elysium,
          association régie par la loi du 1ᵉʳ juillet 1901. Numéro RNA : W772011943.
        </p>

        <h2>Directeur de la publication</h2>
        <p>Nathan Martins, Président de l’association Elysium.</p>

        <h2>Hébergement et services techniques</h2>
        <p>{HOST}.</p>

        <h2>Contact</h2>
        <p>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> ou le{' '}
          <a href="https://discord.gg/RH3ZZkMJsw" target="_blank" rel="noreferrer">
            serveur Discord officiel
          </a>.
        </p>

        <h2>Propriété intellectuelle</h2>
        <p>
          La marque et les éléments graphiques ElyWalk / Elysium sont la propriété de
          l’éditeur. Toute reproduction sans autorisation est interdite.
        </p>
      </>
    ),
  },
};

export default function LegalPage() {
  const navigate = useNavigate();
  const { doc = 'terms' } = useParams();
  const item = content[doc as keyof typeof content] || content.terms;
  return (
    <div className="screen legal-page">
      <div className="screen-header">
        <h1 className="screen-title">{item.title}</h1>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>Retour</button>
      </div>
      <div className="card">
        {item.body}
        <h2>Vos droits</h2>
        <p>
          Conformément au RGPD, vous disposez des droits d’accès, de rectification,
          d’effacement, de limitation, de portabilité et d’opposition. Vous pouvez exporter
          ou supprimer vos données directement depuis l’application (Profil). Vous pouvez
          également contacter {EDITOR} à{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Une réclamation peut
          être déposée auprès de la CNIL (www.cnil.fr).
        </p>
        <p className="legal-version">
          Version du {item.updated}.
        </p>
      </div>
    </div>
  );
}
