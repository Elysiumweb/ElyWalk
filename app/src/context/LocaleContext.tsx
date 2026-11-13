import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Preferences } from '@capacitor/preferences';

export type Locale = 'fr' | 'en';
export const dictionaries = {
  fr: {
    'nav.home': 'Accueil', 'nav.map': 'Carte', 'nav.friends': 'Amis', 'nav.leaderboard': 'Classement', 'nav.wallet': 'Coffre', 'nav.profile': 'Profil',
    // Libellés courts affichés sous les icônes de la barre d'onglets (mobile) :
    // les six destinations restent lisibles sans masquer le texte (audit § 2.1).
    'nav.home.short': 'Accueil', 'nav.map.short': 'Carte', 'nav.friends.short': 'Amis', 'nav.leaderboard.short': 'Rangs', 'nav.wallet.short': 'Coffre', 'nav.profile.short': 'Profil',
    'common.back': 'Retour', 'common.cancel': 'Annuler', 'common.save': 'Enregistrer', 'common.loading': 'Chargement…',
    'settings.language': 'Langue / Language', 'settings.french': 'Français', 'settings.english': 'English',
    'routes.title': 'Parcours', 'routes.subtitle': 'Préparez, retrouvez et suivez vos traces', 'routes.import': 'Importer un fichier GPX', 'routes.search': 'Rechercher un parcours ou un créateur…', 'routes.follow': 'Suivre ce parcours', 'routes.none': 'Aucun parcours', 'routes.private': 'Privé', 'routes.public': 'Public',
    'events.title': 'Rencontres', 'events.subtitle': 'Marcher ensemble · établissements partenaires', 'events.create': '+ Proposer une sortie', 'events.join': 'Rejoindre', 'events.leave': 'Se désinscrire', 'events.cancelled': 'Annulé', 'events.directions': 'Itinéraire', 'events.reminder': 'Rappel',
    'safety.blocked': 'Comptes bloqués', 'safety.none': 'Aucun compte bloqué.', 'safety.unblock': 'Débloquer',
    // D07 — les réglages et la progression sont des écrans à part entière.
    'settings.title': 'Réglages', 'settings.subtitle': 'Notifications, affichage et compte',
    'progression.title': 'Progression', 'progression.subtitle': 'Paliers, statistiques et badges',
    'profile.goto': 'Aller à', 'profile.goto.progression': 'Progression',
    'profile.goto.progression.hint': 'Statistiques, paliers et tous mes badges',
    'profile.goto.settings': 'Réglages',
    'profile.goto.settings.hint': 'Notifications, apparence, langue, paiement, compte',
    // Écran de mise à jour (détection de la version publiée sur le Play Store).
    'update.recommended.title': 'Une nouvelle version est disponible',
    'update.recommended.body': 'Une version plus récente d’ElyWalk est disponible sur le Play Store. La mettre à jour prend moins d’une minute et conserve votre profil, vos pas et vos ElyCoins.',
    'update.required.title': 'Mise à jour nécessaire',
    'update.required.body': 'Cette version d’ElyWalk n’est plus prise en charge. Installez la nouvelle version pour continuer à compter vos pas et à utiliser l’application.',
    'update.required.note': 'Votre profil, votre série et vos ElyCoins sont conservés après la mise à jour.',
    'update.installed': 'Installée',
    'update.available': 'Disponible',
    'update.whatsnew': 'Nouveautés',
    'update.action': 'Mettre à jour',
    'update.opening': 'Ouverture du Play Store…',
    'update.later': 'Plus tard',
    'update.hint': 'La mise à jour se télécharge depuis le Play Store. Pensez à activer les mises à jour automatiques pour ne plus y penser.',

  },
  en: {
    'nav.home': 'Home', 'nav.map': 'Map', 'nav.friends': 'Friends', 'nav.leaderboard': 'Leaderboard', 'nav.wallet': 'Wallet', 'nav.profile': 'Profile',
    'nav.home.short': 'Home', 'nav.map.short': 'Map', 'nav.friends.short': 'Friends', 'nav.leaderboard.short': 'Ranks', 'nav.wallet.short': 'Wallet', 'nav.profile.short': 'Profile',
    'common.back': 'Back', 'common.cancel': 'Cancel', 'common.save': 'Save', 'common.loading': 'Loading…',
    'settings.language': 'Language / Langue', 'settings.french': 'Français', 'settings.english': 'English',
    'routes.title': 'Routes', 'routes.subtitle': 'Plan, find and follow your tracks', 'routes.import': 'Import a GPX file', 'routes.search': 'Search for a route or creator…', 'routes.follow': 'Follow this route', 'routes.none': 'No routes', 'routes.private': 'Private', 'routes.public': 'Public',
    'events.title': 'Meetups', 'events.subtitle': 'Walk together · partner venues', 'events.create': '+ Suggest a walk', 'events.join': 'Join', 'events.leave': 'Leave', 'events.cancelled': 'Cancelled', 'events.directions': 'Directions', 'events.reminder': 'Reminder',
    'safety.blocked': 'Blocked accounts', 'safety.none': 'No blocked accounts.', 'safety.unblock': 'Unblock',
    'settings.title': 'Settings', 'settings.subtitle': 'Notifications, appearance and account',
    'progression.title': 'Progress', 'progression.subtitle': 'Levels, statistics and badges',
    'profile.goto': 'Go to', 'profile.goto.progression': 'Progress',
    'profile.goto.progression.hint': 'Statistics, levels and all my badges',
    'profile.goto.settings': 'Settings',
    'profile.goto.settings.hint': 'Notifications, appearance, language, payment, account',
    'update.recommended.title': 'A new version is available',
    'update.recommended.body': 'A newer version of ElyWalk is available on the Play Store. Updating takes less than a minute and keeps your profile, your steps and your ElyCoins.',
    'update.required.title': 'Update required',
    'update.required.body': 'This version of ElyWalk is no longer supported. Install the new version to keep counting your steps and using the app.',
    'update.required.note': 'Your profile, your streak and your ElyCoins are kept after the update.',
    'update.installed': 'Installed',
    'update.available': 'Available',
    'update.whatsnew': 'What’s new',
    'update.action': 'Update now',
    'update.opening': 'Opening the Play Store…',
    'update.later': 'Later',
    'update.hint': 'The update downloads from the Play Store. Turn on automatic updates so you never have to think about it.',

  },
} as const;
export type TranslationKey = keyof typeof dictionaries.fr;
type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  t: (key: TranslationKey) => string;
  formatDate: (date: Date | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};
const LocaleContext = createContext<LocaleContextValue | null>(null);
function initialLocale(): Locale {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('elywalk.locale') : null;
  if (saved === 'en' || saved === 'fr') return saved;
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('en') ? 'en' : 'fr';
}
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, update] = useState<Locale>(initialLocale);
  // `html.lang` suit la langue **à chaque changement**, pas seulement au
  // montage : sinon TalkBack et les lecteurs d'écran continuaient de prononcer
  // l'anglais avec la voix française après un changement de langue (D08).
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => { Preferences.get({ key: 'elywalk.locale' }).then(({ value }) => { if ((value === 'fr' || value === 'en') && value !== locale) update(value); }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const setLocale = async (next: Locale) => { update(next); localStorage.setItem('elywalk.locale', next); await Preferences.set({ key: 'elywalk.locale', value: next }); };
  const value = useMemo<LocaleContextValue>(() => ({
    locale, setLocale,
    t: key => dictionaries[locale][key] || dictionaries.fr[key],
    formatDate: (date, options) => new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', options).format(date),
    formatNumber: (number, options) => new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', options).format(number),
  }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
export function useI18n(): LocaleContextValue {
  const context = useContext(LocaleContext); if (!context) throw new Error('useI18n doit être utilisé dans LocaleProvider'); return context;
}
