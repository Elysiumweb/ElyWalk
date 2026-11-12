import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup,
  signInWithCredential, GoogleAuthProvider, updateProfile, signOut,
  sendPasswordResetEmail, sendEmailVerification, updatePassword, updateEmail, deleteUser,
  EmailAuthProvider, reauthenticateWithCredential, type UserCredential,
} from 'firebase/auth';
import { auth } from './firebase';

const isNative = () => Capacitor.isNativePlatform();

export async function registerWithEmail(email: string, password: string, displayName: string): Promise<UserCredential> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  await sendEmailVerification(cred.user);
  return cred;
}
export async function loginWithEmail(email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email, password);
}
export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}
export async function resendVerification(): Promise<void> {
  if (!auth.currentUser) throw new Error('Utilisateur non connecté.');
  await sendEmailVerification(auth.currentUser);
}
export async function changePassword(currentPassword: string, nextPassword: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('Cette action est disponible pour les comptes e-mail.');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  await updatePassword(user, nextPassword);
}

export async function changeEmail(currentPassword: string, nextEmail: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('Cette action est disponible pour les comptes e-mail.');
  const isPasswordProvider = user.providerData.some((p) => p.providerId === 'password');
  if (!isPasswordProvider) throw new Error('Le changement d’e-mail n’est pas disponible pour les comptes Google.');
  const email = nextEmail.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Adresse e-mail invalide.');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  await updateEmail(user, email);
  await sendEmailVerification(user);
}
/**
 * Réauthentification avant une opération sensible (suppression de compte,
 * changement d'e-mail).
 *
 * Sans mot de passe, on rafraîchit simplement la session : les comptes Google
 * n'ont pas de mot de passe, et `deleteUser` exige une connexion récente plutôt
 * qu'un mot de passe. Un compte e-mail/mot de passe sans mot de passe fourni
 * échoue explicitement au lieu de laisser Firebase renvoyer `requires-recent-login`.
 */
export async function reauthenticateAccount(currentPassword?: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Aucune session active.');
  if (!currentPassword) {
    const isPasswordUser = user.providerData.some((p) => p.providerId === 'password');
    if (isPasswordUser) throw new Error('Saisissez votre mot de passe pour confirmer la suppression.');
    // Compte fédéré (Google) : on peut rafraîchir la session, un jeton valide
    // suffit pour `deleteUser`. Si Firebase exige une réauthentification, le
    // message d'erreur invite l'utilisateur à se reconnecter.
    await user.getIdToken(true);
    return;
  }
  if (!user.email) throw new Error('Ce compte n’a pas d’adresse e-mail associée.');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
}
export async function deleteAuthAccount(currentPassword?: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  if (currentPassword && user.email) {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  }
  await deleteUser(user);
}
/**
 * Connexion Google.
 *
 * **Bug « User cancel activity »** : sur Android, le plugin utilise la
 * *Credential Manager API* par défaut. L'appareil compose sa demande à partir de
 * `R.string.default_web_client_id`, la chaîne générée par le plugin
 * `google-services` à partir des `oauth_client` de `google-services.json`. Ce
 * fichier ne contient ici qu'un client **Android** : la chaîne reste sur sa
 * valeur de remplacement (`WILL_BE_OVERRIDDEN`), Credential Manager ne trouve
 * aucune application Google compatible et termine par « User cancel activity »,
 * c'est-à-dire un échec d'appel et non un refus de l'utilisateur.
 *
 * Correctifs :
 * 1. `useCredentialManager: false` → flux `GoogleSignIn` historique, plus
 *    tolérant, qui reste fonctionnel même sans client web correctement résolu
 *    (et qui n'affiche pas de faux « annulé ») ;
 * 2. en cas d'échec, seconde tentative via le flux complet du SDK (le plugin
 *    retente une fois avec l'ancien chemin) ;
 * 3. messages explicites : un vrai refus utilisateur n'est pas présenté comme
 *    une panne, et une erreur de configuration est nommée pour être corrigée
 *    dans la console Firebase / le fichier `google-services.json`.
 */
export async function loginWithGoogle(): Promise<UserCredential> {
  if (isNative()) {
    const result = await signInWithGoogleNative();
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error('La connexion Google n’a pas renvoyé de jeton. Réessayez.');
    return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  }
  return signInWithPopup(auth, new GoogleAuthProvider());
}

/** Tente la connexion Google native, puis le repli `GoogleSignIn` si besoin. */
async function signInWithGoogleNative() {
  const attempts: Array<() => Promise<Awaited<ReturnType<typeof FirebaseAuthentication.signInWithGoogle>>>> = [
    () => FirebaseAuthentication.signInWithGoogle({ useCredentialManager: false }),
    () => FirebaseAuthentication.signInWithGoogle(),
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (e) {
      // Un refus explicite de l'utilisateur ne doit pas être retenté.
      if (isGoogleCancellation(e)) throw new Error('Connexion Google annulée.');
      lastError = e;
    }
  }
  throw new Error(googleErrorHint(lastError));
}

/** Détecte une annulation réelle (et non un échec de configuration Android). */
function isGoogleCancellation(error: unknown): boolean {
  const message = `${(error as { message?: string })?.message || ''} ${(error as { errorMessage?: string })?.errorMessage || ''}`.toLowerCase();
  if (/user cancel activity/.test(message)) return false; // échec Credential Manager
  return /cancel|cancell?ed|12501|dismiss/.test(message);
}

/** Message actionnable pour les échecs de configuration Google Sign-In. */
function googleErrorHint(error: unknown): string {
  const message = `${(error as { message?: string })?.message || ''}`;
  if (/user cancel activity|no credentials|28444|10:|sign in failed/i.test(message)) {
    return 'La connexion Google n’a pas pu démarrer sur cet appareil. Vérifiez que l’empreinte SHA-1 de la version installée est déclarée dans la console Firebase (Paramètres du projet → Vos applications Android) et que « Google » est activé dans Authentication → Méthode de connexion.';
  }
  if (/network|timeout/i.test(message)) return 'Connexion Google impossible : vérifiez votre connexion réseau.';
  return message || 'La connexion Google a échoué. Réessayez.';
}
export async function updateAuthProfile(fields: { displayName?: string; photoURL?: string }): Promise<void> {
  if (auth.currentUser) await updateProfile(auth.currentUser, fields);
}
export async function logout(): Promise<void> {
  if (isNative()) await FirebaseAuthentication.signOut().catch(() => undefined);
  await signOut(auth);
}
export function frAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code || '';
  const map: Record<string, string> = {
    'auth/invalid-email': 'Adresse e-mail invalide.', 'auth/user-not-found': 'Aucun compte trouvé avec cet e-mail.',
    'auth/wrong-password': 'Mot de passe incorrect.', 'auth/invalid-credential': 'Identifiants incorrects.',
    'auth/email-already-in-use': 'Cet e-mail est déjà utilisé.', 'auth/weak-password': 'Mot de passe trop faible (6 caractères minimum).',
    'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard.', 'auth/requires-recent-login': 'Reconnectez-vous avant cette opération sensible.',
    'auth/network-request-failed': 'Erreur réseau. Vérifiez votre connexion.',
    'auth/operation-not-allowed': 'Méthode de connexion non activée dans Firebase.',
  };
  return map[code] || (e as Error)?.message || 'Une erreur est survenue.';
}
