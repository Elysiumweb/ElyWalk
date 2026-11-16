import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import {
  EVENT_PHOTO_SLOTS,
  deleteEventPhoto,
  saveEventPhoto,
  watchEventPhotos,
  type EventPhoto,
} from '../lib/eventPhotos';

/**
 * Galerie d'une rencontre (A10) — trois photos maximum, visibles par les
 * participants. C'est le contenu qui donne envie de revenir sur l'onglet
 * Rencontres après la sortie.
 *
 * Règles d'usage :
 *  - tout participant (ou l'organisateur) peut ajouter une photo ;
 *  - chaque emplacement est unique : reprendre une photo la **remplace** ;
 *  - une photo peut être retirée par son auteur (ou par l'organisateur, règle
 *    serveur).
 */
export default function EventPhotos({
  eventId,
  canEdit,
}: {
  eventId: string;
  canEdit: boolean;
}) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [zoom, setZoom] = useState<EventPhoto | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!eventId) return;
    setError(null);
    return watchEventPhotos(eventId, setPhotos, (e) => {
      setError((e as Error)?.message || 'Galerie indisponible.');
    });
  }, [eventId]);

  const onPick = async (slot: number, file: File | null | undefined) => {
    if (!file || !profile) return;
    setBusySlot(slot);
    try {
      await saveEventPhoto(eventId, slot, profile, file);
      toast('Photo ajoutée à la rencontre.', 'success');
    } catch (e) {
      toast((e as Error).message || 'Envoi de la photo impossible.', 'error');
    } finally {
      setBusySlot(null);
      const input = inputsRef.current[slot];
      if (input) input.value = '';
    }
  };

  const remove = async (photo: EventPhoto) => {
    try {
      await deleteEventPhoto(photo.eventId, photo.slot);
      toast('Photo retirée.', 'info');
    } catch (e) {
      toast((e as Error).message || 'Suppression impossible.', 'error');
    }
  };

  const slots = Array.from({ length: EVENT_PHOTO_SLOTS }, (_, slot) =>
    photos.find((photo) => photo.slot === slot) || null,
  );

  return (
    <div className="event-photos" data-testid="event-photos">
      <div className="event-photos-grid">
        {slots.map((photo, slot) => (
          <div className={`event-photo-slot ${photo ? 'event-photo-filled' : ''}`} key={slot}>
            {photo ? (
              <>
                <button
                  type="button"
                  className="event-photo-open"
                  onClick={() => setZoom(photo)}
                  aria-label={`Agrandir la photo ${slot + 1} de la rencontre`}
                >
                  <img src={photo.dataUrl} alt={`Rencontre · photo ${slot + 1}`} loading="lazy" />
                </button>
                {(canEdit || photo.uid === profile?.uid) && (
                  <button
                    type="button"
                    className="event-photo-remove"
                    onClick={() => void remove(photo)}
                    aria-label={`Retirer la photo ${slot + 1}`}
                    data-testid={`event-photo-remove-${slot}`}
                  >
                    ✕
                  </button>
                )}
              </>
            ) : canEdit ? (
              <>
                <button
                  type="button"
                  className="event-photo-add"
                  onClick={() => inputsRef.current[slot]?.click()}
                  disabled={busySlot === slot}
                  aria-label={`Ajouter la photo ${slot + 1}`}
                  data-testid={`event-photo-add-${slot}`}
                >
                  {busySlot === slot ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : '＋'}
                </button>
                <input
                  ref={(element) => { inputsRef.current[slot] = element; }}
                  type="file"
                  accept="image/*"
                  hidden
                  capture="environment"
                  onChange={(event) => void onPick(slot, event.target.files?.[0])}
                />
              </>
            ) : (
              <span className="event-photo-empty" aria-hidden="true">📷</span>
            )}
          </div>
        ))}
      </div>
      {error && <p className="muted-xs" role="status">Photos momentanément indisponibles.</p>}
      {!photos.length && (
        <p className="muted-xs">Ajoutez jusqu’à trois photos pour garder un souvenir de la sortie.</p>
      )}
      {zoom && (
        <div
          className="event-photo-zoom"
          role="dialog"
          aria-modal="true"
          aria-label="Photo de la rencontre"
          onClick={() => setZoom(null)}
        >
          <img src={zoom.dataUrl} alt="Photo de la rencontre en grand" />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setZoom(null)}>
            Fermer
          </button>
        </div>
      )}
    </div>
  );
}
