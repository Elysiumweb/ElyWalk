import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import type { PluginListenerHandle } from '@capacitor/core';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithCredential,
  linkWithCredential,
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

/** Délai max d'attente du SMS (envoi du code par Firebase). */
const SMS_TIMEOUT_MS = 90_000;

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
    const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
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
let webRecaptchaContainer: string | null = null;

/**
 * reCAPTCHA invisible (web uniquement).
 * Recréé si le conteneur change ou si le précédent a été consommé/invalidé.
 */
function getWebRecaptcha(containerId: string): RecaptchaVerifier {
  if (!document.getElementById(containerId)) {
    throw new Error("Le conteneur reCAPTCHA est introuvable dans la page.");
  }
  if (webRecaptcha && webRecaptchaContainer !== containerId) {
    clearWebRecaptcha();
  }
  if (!webRecaptcha) {
    webRecaptcha = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
    webRecaptchaContainer = containerId;
  }
  return webRecaptcha;
}

function clearWebRecaptcha(): void {
  try {
    webRecaptcha?.clear();
  } catch {
    /* noop */
  }
  webRecaptcha = null;
  webRecaptchaContainer = null;
}

/**
 * Connexion (ou inscription) par numéro de téléphone.
 *
 * Natif (Android/iOS) : la vérification de l'application (Play Integrity /
 * reCAPTCHA) est faite par le SDK natif via le plugin. On récupère uniquement
 * le `verificationId`, puis on se connecte **au niveau JS** avec
 * `signInWithCredential`, car c'est le SDK JS qui porte la session utilisée
 * par Firestore. C'est pour cela que l'on passe `skipNativeAuth: true` : sans
 * ça, le code SMS serait consommé deux fois (natif + web) et Firebase
 * renverrait `auth/invalid-verification-code`.
 */
export async function startPhoneSignIn(
  phoneNumber: string,
  recaptchaContainerId: string
): Promise<PhoneSession> {
  if (isNative()) {
    const verificationId = await nativeVerifyPhoneNumber(phoneNumber);
    return {
      confirm: async (code: string) => {
        const credential = PhoneAuthProvider.credential(verificationId, code);
        return signInWithCredential(auth, credential);
      },
    };
  }
  const verifier = getWebRecaptcha(recaptchaContainerId);
  let confirmation: ConfirmationResult;
  try {
    confirmation = await signInWithPhoneNumber(auth, phoneNumber, verifier);
  } catch (e) {
    // Un reCAPTCHA déjà consommé ne peut pas être réutilisé.
    clearWebRecaptcha();
    throw e;
  }
  return {
    confirm: (code: string) => confirmation.confirm(code),
  };
}

/** Lie un numéro de téléphone au compte connecté (vérification du téléphone). */
export async function startPhoneLink(
  phoneNumber: string,
  recaptchaContainerId: string
): Promise<PhoneSession> {
  const user = auth.currentUser;
  if (!user) throw new Error('Non connecté.');

  if (isNative()) {
    // Même principe que pour la connexion : le natif ne sert qu'à obtenir le
    // verificationId, la liaison est faite sur la couche JS (celle qui détient
    // la session courante).
    const verificationId = await nativeVerifyPhoneNumber(phoneNumber);
    return {
      confirm: async (code: string) => {
        const credential = PhoneAuthProvider.credential(verificationId, code);
        await linkWithCredential(user, credential);
      },
    };
  }
  const verifier = getWebRecaptcha(recaptchaContainerId);
  let confirmation: ConfirmationResult;
  try {
    confirmation = await linkWithPhoneNumber(user, phoneNumber, verifier);
  } catch (e) {
    clearWebRecaptcha();
    throw e;
  }
  return {
    confirm: (code: string) => confirmation.confirm(code),
  };
}

/**
 * Déclenche la vérification native du numéro et attend l'événement
 * `phoneCodeSent` pour renvoyer le `verificationId`.
 *
 * `timeout: 0` désactive la récupération automatique du SMS sur Android :
 * en auto-retrieval, Firebase termine la vérification côté natif sans jamais
 * exposer de code, et la couche JS resterait bloquée (c'est ce que
 * recommande la doc du plugin lorsqu'on utilise le SDK JS).
 */
async function nativeVerifyPhoneNumber(phoneNumber: string): Promise<string> {
  const handles: PluginListenerHandle[] = [];
  const removeListeners = async () => {
    await Promise.all(handles.map((h) => h.remove().catch(() => undefined)));
    handles.length = 0;
  };

  // Localise le SMS envoyé par Firebase.
  await FirebaseAuthentication.setLanguageCode({ languageCode: 'fr' }).catch(() => undefined);

  try {
    return await new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        finish(() =>
          reject(
            new Error(
              "Délai dépassé : aucun SMS reçu. Vérifiez le numéro, puis réessayez dans quelques minutes."
            )
          )
        );
      }, SMS_TIMEOUT_MS);

      (async () => {
        try {
          handles.push(
            await FirebaseAuthentication.addListener('phoneCodeSent', (event) => {
              finish(() => resolve(event.verificationId));
            })
          );
          handles.push(
            await FirebaseAuthentication.addListener('phoneVerificationFailed', (event) => {
              finish(() => reject(new Error(event.message)));
            })
          );
          handles.push(
            await FirebaseAuthentication.addListener('phoneVerificationCompleted', () => {
              // Vérification instantanée : aucun code n'est exposé à la couche
              // JS, on demande donc à l'utilisateur de relancer l'envoi.
              finish(() =>
                reject(
                  new Error(
                    'Vérification automatique effectuée par Android. Relancez l’envoi du code pour terminer la connexion.'
                  )
                )
              );
            })
          );

          const result = (await FirebaseAuthentication.signInWithPhoneNumber({
            phoneNumber,
            // Désactive l'auto-retrieval du SMS (obligatoire avec le SDK JS).
            timeout: 0,
            // La session doit être créée par le SDK JS, pas par le natif.
            skipNativeAuth: true,
          })) as { verificationId?: string } | void;
          // Certaines versions du plugin renvoient directement le verificationId.
          if (result && result.verificationId) {
            const id = result.verificationId;
            finish(() => resolve(id));
          }
        } catch (e) {
          finish(() => reject(e));
        }
      })();
    });
  } finally {
    await removeListeners();
  }
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
  clearWebRecaptcha();
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
    'auth/missing-phone-number': 'Numéro de téléphone manquant.',
    'auth/invalid-verification-code': 'Code de vérification incorrect.',
    'auth/invalid-verification-id': 'Session de vérification invalide. Redemandez un code.',
    'auth/code-expired': 'Code expiré. Redemandez un nouveau code SMS.',
    'auth/session-expired': 'Code expiré. Redemandez un nouveau code SMS.',
    'auth/quota-exceeded': 'Quota de SMS dépassé pour ce projet. Réessayez plus tard.',
    'auth/captcha-check-failed':
      "Vérification de l'application échouée (empreinte SHA-1/SHA-256 ou clé API mal configurée).",
    'auth/missing-client-identifier':
      "Application non vérifiée : ajoutez les empreintes SHA-1 et SHA-256 de l'app dans la console Firebase.",
    'auth/app-not-authorized':
      "Application non autorisée à utiliser Firebase Authentication (empreinte SHA absente ou google-services.json obsolète).",
    'auth/credential-already-in-use': 'Ce numéro est déjà lié à un autre compte.',
    'auth/provider-already-linked': 'Un numéro est déjà lié à ce compte.',
    'auth/network-request-failed': 'Erreur réseau. Vérifiez votre connexion.',
    'auth/firebase-app-check-token-is-invalid':
      "Jeton App Check invalide. Vérifiez la configuration App Check (Play Integrity / reCAPTCHA).",
  };
  if (map[code]) return map[code];
  const msg = (e as Error)?.message || 'Une erreur est survenue.';
  return msg;
}
