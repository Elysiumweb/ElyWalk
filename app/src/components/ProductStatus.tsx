import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { resendVerification } from '../lib/auth-service';
import { updateUserFields } from '../lib/db';
import Sheet from './Sheet';

export default function ProductStatus() {
  const { user, profile } = useAuth(); const [online,setOnline]=useState(navigator.onLine); const [step,setStep]=useState(0);
  useEffect(()=>{const on=()=>setOnline(true),off=()=>setOnline(false);addEventListener('online',on);addEventListener('offline',off);return()=>{removeEventListener('online',on);removeEventListener('offline',off)}},[]);
  const done=async()=>{if(profile) await updateUserFields(profile.uid,{onboardingDone:true});};
  return <>{!online&&<div className="offline-banner">Hors ligne — les données seront synchronisées au retour du réseau.</div>}
    {/*
      E-mail non confirmé : plus **aucun** blocage (2.2.5). Toutes les fonctions
      — pas, défis, amis, récompenses publicitaires, parrainage, dépenses et
      retraits — sont accessibles sans confirmation. La bannière reste une
      simple invitation, utile pour la récupération de compte.
    */}
    {user?.providerData.some(p=>p.providerId==='password')&&!user.emailVerified&&<div className="verification-banner" data-testid="verification-banner">
      E-mail non confirmé — tout fonctionne normalement, aucune fonction n’est bloquée. Confirmez-le seulement pour sécuriser la récupération de votre compte.{' '}
      <button onClick={()=>resendVerification()}>Renvoyer l’e-mail</button> · <button onClick={async()=>{await user.reload();await user.getIdToken(true);location.reload()}}>J’ai vérifié</button>
    </div>}
    <Sheet open={!!profile&&!profile.onboardingDone} onClose={done} title="Bienvenue dans ElyWalk">
      {step===0&&<><h3>Marchez et progressez</h3><p className="onboarding-copy">Autorisez l’activité physique pour compter vos pas. Votre position n’est utilisée que sur la carte, à votre demande.</p></>}
      {step===1&&<><h3>Validez chaque jour</h3><p className="onboarding-copy">Validez avant minuit — et autant de fois que vous voulez dans la journée. Les gains sont plafonnés et contrôlés.</p></>}
      {step===2&&<><h3>Gardez le contrôle</h3><p className="onboarding-copy">Personnalisez votre objectif, consultez votre historique et gérez vos données depuis votre profil.</p></>}
      {step<2?<button className="btn btn-gold" onClick={()=>setStep(step+1)}>Suivant</button>:<button className="btn btn-gold" onClick={done}>Commencer</button>}
    </Sheet></>;
}
