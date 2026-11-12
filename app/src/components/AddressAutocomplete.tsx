import { useEffect, useId, useRef, useState } from 'react';
import { searchAddresses, type AddressSuggestion, type LatLng } from '../lib/directions';

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  /** Appelé quand l'utilisateur choisit une adresse dans la liste. */
  onSelect?: (suggestion: AddressSuggestion) => void;
  placeholder?: string;
  label?: string;
  ariaLabel?: string;
  helpText?: string;
  /** Point de référence pour classer les propositions par proximité. */
  near?: LatLng | null;
  /** Identifiant de test stable. */
  testId?: string;
  autoFocus?: boolean;
  maxLength?: number;
}

/**
 * Champ d'adresse **avec suggestions au fil de la frappe** (Photon /
 * OpenStreetMap, repli Nominatim).
 *
 * Corrige la gêne signalée dans « Rencontres → Adresse » : le champ était un
 * simple `input` sans aide, il fallait donc connaître l'adresse exacte. Ici,
 * chaque frappe (à partir de 3 caractères) interroge l'index d'adresses, les
 * résultats sont classés par proximité, et un choix renseigne le libellé **et**
 * les coordonnées (utilisées ensuite pour l'itinéraire et la carte).
 *
 * Le composant reste un champ texte : si le service ne répond pas, l'utilisateur
 * peut saisir son adresse librement, comme avant.
 */
export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  label,
  ariaLabel,
  helpText,
  near,
  testId,
  autoFocus,
  maxLength = 200,
}: AddressAutocompleteProps) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const skipNextSearch = useRef(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Recherche différée (300 ms) : évite un appel par touche.
  useEffect(() => {
    const term = value.trim();
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      return;
    }
    if (term.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void searchAddresses(term, { limit: 6, near })
        .then((items) => {
          if (cancelled) return;
          setSuggestions(items);
          setActiveIndex(-1);
          setOpen(items.length > 0);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, near?.lat, near?.lng]);

  // Ferme la liste au toucher en dehors du champ.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const choose = (suggestion: AddressSuggestion) => {
    skipNextSearch.current = true;
    onChange(suggestion.label);
    onSelect?.(suggestion);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      choose(suggestions[activeIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="field address-field" ref={containerRef}>
      {label && <label htmlFor={`${listId}-input`}>{label}</label>}
      <div className="address-input-wrap">
        <input
          id={`${listId}-input`}
          className="input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
          aria-label={ariaLabel || label || 'Adresse'}
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder || 'Ex. 12 rue de Rivoli, Paris'}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          data-testid={testId ? `${testId}-input` : 'address-input'}
        />
        {loading && (
          <span className="address-spinner" aria-hidden="true">
            <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
          </span>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul className="address-suggestions" id={listId} role="listbox" aria-label="Adresses proposées" data-testid={testId ? `${testId}-suggestions` : 'address-suggestions'}>
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={`${listId}-opt-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? 'address-suggestion address-suggestion-active' : 'address-suggestion'}
              // `onMouseDown` : le choix est enregistré avant le `blur` du champ.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(suggestion);
              }}
              onClick={() => choose(suggestion)}
              data-testid={testId ? `${testId}-option-${index}` : `address-option-${index}`}
            >
              <span aria-hidden="true">{addressIcon(suggestion.kind)}</span>
              <span className="address-suggestion-label">{suggestion.label}</span>
            </li>
          ))}
        </ul>
      )}

      {helpText && <small className="field-help">{helpText}</small>}
    </div>
  );
}

/** Icône courte selon le type OpenStreetMap renvoyé par le géocodeur. */
function addressIcon(kind?: string): string {
  switch ((kind || '').toLowerCase()) {
    case 'house':
    case 'building':
    case 'address':
      return '🏠';
    case 'street':
    case 'road':
    case 'highway':
      return '🛣️';
    case 'city':
    case 'town':
    case 'village':
    case 'locality':
      return '🏙️';
    case 'park':
    case 'garden':
      return '🌳';
    case 'station':
    case 'railway':
      return '🚉';
    default:
      return '📍';
  }
}
