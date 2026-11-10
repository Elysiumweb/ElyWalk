import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Preferences } from '@capacitor/preferences';

export type Locale = 'fr' | 'en';
const dictionaries = {
  fr: {
    'nav.home': 'Accueil', 'nav.map': 'Carte', 'nav.friends': 'Amis', 'nav.leaderboard': 'Classement', 'nav.wallet': 'Coffre', 'nav.profile': 'Profil',
    'common.back': 'Retour', 'common.cancel': 'Annuler', 'common.save': 'Enregistrer', 'common.loading': 'Chargement…',
    'settings.language': 'Langue / Language', 'settings.french': 'Français', 'settings.english': 'English',
    'routes.title': 'Parcours', 'routes.subtitle': 'Préparez, retrouvez et suivez vos traces', 'routes.import': 'Importer un fichier GPX', 'routes.search': 'Rechercher un parcours ou un créateur…', 'routes.follow': 'Suivre ce parcours', 'routes.none': 'Aucun parcours', 'routes.private': 'Privé', 'routes.public': 'Public',
    'events.title': 'Rencontres', 'events.subtitle': 'Marcher ensemble · établissements partenaires', 'events.create': '+ Proposer une sortie', 'events.join': 'Rejoindre', 'events.leave': 'Se désinscrire', 'events.cancelled': 'Annulé', 'events.directions': 'Itinéraire', 'events.reminder': 'Rappel',
    'safety.blocked': 'Comptes bloqués', 'safety.none': 'Aucun compte bloqué.', 'safety.unblock': 'Débloquer',
  },
  en: {
    'nav.home': 'Home', 'nav.map': 'Map', 'nav.friends': 'Friends', 'nav.leaderboard': 'Leaderboard', 'nav.wallet': 'Wallet', 'nav.profile': 'Profile',
    'common.back': 'Back', 'common.cancel': 'Cancel', 'common.save': 'Save', 'common.loading': 'Loading…',
    'settings.language': 'Language / Langue', 'settings.french': 'Français', 'settings.english': 'English',
    'routes.title': 'Routes', 'routes.subtitle': 'Plan, find and follow your tracks', 'routes.import': 'Import a GPX file', 'routes.search': 'Search for a route or creator…', 'routes.follow': 'Follow this route', 'routes.none': 'No routes', 'routes.private': 'Private', 'routes.public': 'Public',
    'events.title': 'Meetups', 'events.subtitle': 'Walk together · partner venues', 'events.create': '+ Suggest a walk', 'events.join': 'Join', 'events.leave': 'Leave', 'events.cancelled': 'Cancelled', 'events.directions': 'Directions', 'events.reminder': 'Reminder',
    'safety.blocked': 'Blocked accounts', 'safety.none': 'No blocked accounts.', 'safety.unblock': 'Unblock',
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
  useEffect(() => { document.documentElement.lang = locale; Preferences.get({ key: 'elywalk.locale' }).then(({ value }) => { if ((value === 'fr' || value === 'en') && value !== locale) update(value); }); }, []);
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
