import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup,
  signInWithCredential, GoogleAuthProvider, updateProfile, signOut,
  sendPasswordResetEmail, sendEmailVerification, updatePassword, deleteUser,
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
export async function reauthenticateAccount(currentPassword: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) return;
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
export async function loginWithGoogle(): Promise<UserCredential> {
  if (isNative()) {
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error('Connexion Google annulée.');
    return signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
  }
  return signInWithPopup(auth, new GoogleAuthProvider());
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
