import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  signInWithPhoneNumber,
  linkWithPhoneNumber,
  GoogleAuthProvider,
  PhoneAuthProvider,
  RecaptchaVerifier,
  updateProfile,
  signOut,
  type ConfirmationResult,
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

// ============ Téléphone ============

export interface PhoneSession {
  confirm: (code: string) => Promise<UserCredential | void>;
}

let webRecaptcha: RecaptchaVerifier | null = null;

function getWebRecaptcha(containerId: string): RecaptchaVerifier {
  if (!webRecaptcha) {
    webRecaptcha = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
  }
  return webRecaptcha;
}

/** Connexion (ou inscription) par numéro de téléphone. */
export async function startPhoneSignIn(
  phoneNumber: string,
  recaptchaContainerId: string
): Promise<PhoneSession> {
  if (isNative()) {
    const verificationId = await nativeSendCode(() =>
      FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber })
    );
    return {
      confirm: async (code: string) => {
        // Confirme côté natif puis synchronise la session avec le SDK JS.
        await FirebaseAuthentication.confirmVerificationCode({
          verificationId,
          verificationCode: code,
        });
        const credential = PhoneAuthProvider.credential(verificationId, code);
        return signInWithCredential(auth, credential);
      },
    };
  }
  const verifier = getWebRecaptcha(recaptchaContainerId);
  const confirmation: ConfirmationResult = await signInWithPhoneNumber(auth, phoneNumber, verifier);
  return {
    confirm: (code: string) => confirmation.confirm(code),
  };
}

/** Lie un numéro de téléphone au compte connecté (vérification du téléphone). */
export async function startPhoneLink(
  phoneNumber: string,
  recaptchaContainerId: string
): Promise<PhoneSession> {
  if (isNative()) {
    const verificationId = await nativeSendCode(() =>
      FirebaseAuthentication.linkWithPhoneNumber({ phoneNumber })
    );
    return {
      confirm: async (code: string) => {
        await FirebaseAuthentication.confirmVerificationCode({
          verificationId,
          verificationCode: code,
        });
      },
    };
  }
  const user = auth.currentUser;
  if (!user) throw new Error('Non connecté.');
  const verifier = getWebRecaptcha(recaptchaContainerId);
  const confirmation = await linkWithPhoneNumber(user, phoneNumber, verifier);
  return {
    confirm: (code: string) => confirmation.confirm(code),
  };
}

/** Attend l'événement phoneCodeSent du plugin natif et renvoie le verificationId. */
async function nativeSendCode(trigger: () => Promise<void>): Promise<string> {
  return new Promise<string>(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      FirebaseAuthentication.removeAllListeners();
      reject(new Error("Délai dépassé pour l'envoi du SMS."));
    }, 60000);
    await FirebaseAuthentication.addListener('phoneCodeSent', (event) => {
      clearTimeout(timeout);
      FirebaseAuthentication.removeAllListeners();
      resolve(event.verificationId);
    });
    await FirebaseAuthentication.addListener('phoneVerificationFailed', (event) => {
      clearTimeout(timeout);
      FirebaseAuthentication.removeAllListeners();
      reject(new Error(event.message));
    });
    try {
      await trigger();
    } catch (e) {
      clearTimeout(timeout);
      FirebaseAuthentication.removeAllListeners();
      reject(e);
    }
  });
}

// ============ Déconnexion ============

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
    'auth/invalid-phone-number': 'Numéro de téléphone invalide (format +33...).',
    'auth/invalid-verification-code': 'Code de vérification incorrect.',
    'auth/credential-already-in-use': 'Ce numéro est déjà lié à un autre compte.',
    'auth/provider-already-linked': 'Un numéro est déjà lié à ce compte.',
    'auth/network-request-failed': 'Erreur réseau. Vérifiez votre connexion.',
  };
  if (map[code]) return map[code];
  const msg = (e as Error)?.message || 'Une erreur est survenue.';
  return msg;
}
