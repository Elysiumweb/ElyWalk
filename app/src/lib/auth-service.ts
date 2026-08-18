import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  updateProfile,
  signOut,
  type UserCredential,
} from 'firebase/auth';
import { auth } from './firebase';

const isNative = () => Capacitor.isNativePlatform();

// ============ Email / Mot de passe ============

export async function registerWithEmail(
  email: string,
  password: string,
  displayName: string
): Promise<UserCredential> {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });
  return cred;
}

export async function loginWithEmail(email: string, password: string): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email, password);
}

// ============ Google ============

export async function loginWithGoogle(): Promise<UserCredential> {
  if (isNative()) {
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error('Connexion Google annulée.');
    const credential = GoogleAuthProvider.credential(idToken);
    return signInWithCredential(auth, credential);
  }
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

// ============ Déconnexion ============

export async function updateAuthProfile(fields: {
  displayName?: string;
  photoURL?: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  await updateProfile(user, fields);
}

export async function logout(): Promise<void> {
  if (isNative()) {
    await FirebaseAuthentication.signOut().catch(() => undefined);
  }
  await signOut(auth);
}

/** Messages d'erreur Firebase en français. */
export function frAuthError(e: unknown): string {
  const code = (e as { code?: string })?.code || '';
  const map: Record<string, string> = {
    'auth/invalid-email': 'Adresse e-mail invalide.',
    'auth/user-not-found': 'Aucun compte trouvé avec cet e-mail.',
    'auth/wrong-password': 'Mot de passe incorrect.',
    'auth/invalid-credential': 'Identifiants incorrects.',
    'auth/email-already-in-use': 'Cet e-mail est déjà utilisé.',
    'auth/weak-password': 'Mot de passe trop faible (6 caractères minimum).',
    'auth/too-many-requests': 'Trop de tentatives. Réessayez plus tard.',
    'auth/operation-not-allowed':
      'Méthode de connexion non activée dans Firebase (Console > Authentication > Sign-in method).',
    'auth/network-request-failed': 'Erreur réseau. Vérifiez votre connexion.',
  };
  if (map[code]) return map[code];
  const msg = (e as Error)?.message || 'Une erreur est survenue.';
  return msg;
}
