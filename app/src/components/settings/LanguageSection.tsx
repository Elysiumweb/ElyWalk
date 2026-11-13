import { useI18n, type Locale } from '../../context/LocaleContext';

/** Réglages → Langue (appliquée immédiatement, sans redémarrage). */
export default function LanguageSection() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="card" data-testid="settings-language">
      <div className="field">
        <label htmlFor="language-select">{t('settings.language')}</label>
        <select
          id="language-select"
          className="input"
          aria-label={t('settings.language')}
          value={locale}
          onChange={(e) => void setLocale(e.target.value as Locale)}
          data-testid="language-select"
        >
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
        <small className="card-help">Les libellés traduits, dates et nombres utilisent cette langue.</small>
      </div>
    </div>
  );
}
