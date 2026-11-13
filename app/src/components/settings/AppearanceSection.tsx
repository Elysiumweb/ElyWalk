import { APPEARANCE_OPTIONS, useAppearance } from '../../lib/appearance';

/** Réglages → Affichage (Système / Sombre / Contraste renforcé). */
export default function AppearanceSection() {
  const { appearance, setAppearance } = useAppearance();
  return (
    <div className="card" data-testid="settings-appearance">
      <div className="card-title">Affichage</div>
      <div className="appearance-options" role="radiogroup" aria-label="Thème d’affichage">
        {APPEARANCE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={appearance === option.value}
            className={`appearance-option ${appearance === option.value ? 'appearance-option-active' : ''}`}
            onClick={() => void setAppearance(option.value)}
            data-testid={`appearance-${option.value}`}
          >
            <span className="appearance-option-label">{option.label}</span>
            <span className="appearance-option-hint">{option.hint}</span>
          </button>
        ))}
      </div>
      <small className="card-help">
        La charte noir et or est conservée ; seul le confort de lecture change. Les réglages système
        de taille de texte restent respectés.
      </small>
    </div>
  );
}
