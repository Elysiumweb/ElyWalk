import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useToast } from '../components/Toast';
import { watchIncomingRequests, watchRecentMessages, watchCommunityEvents, syncAlertSettings } from '../lib/db';
import { eventDate } from '../lib/eventReminders';
import { haversineM, getCurrentPosition } from '../lib/geo';
import {
  DEFAULT_ALERT_PREFERENCES,
  getAlertPreferences,
  loadInbox,
  markAlertRead,
  markAllAlertsRead,
  notifyLocally,
  pushAlert,
  saveInbox,
  setAlertPreferences,
  unreadAlertCount,
  type AlertPreferences,
  type InAppAlert,
} from '../lib/notificationCenter';
import type { CommunityEvent } from '../lib/types';

interface AlertsContextValue {
  inbox: InAppAlert[];
  unread: number;
  preferences: AlertPreferences;
  /** État du panneau (cloche). */
  open: boolean;
  setOpen: (open: boolean) => void;
  openAlert: (alert: InAppAlert) => void;
  markRead: (key: string) => void;
  markAllRead: () => void;
  updatePreferences: (patch: Partial<AlertPreferences>) => Promise<void>;
}

/**
 * Valeur par défaut : un écran monté hors du fournisseur (page publique, test
 * isolé, prévisualisation) reste utilisable — la cloche est simplement inerte
 * plutôt que de faire échouer tout l'arbre React.
 */
const FALLBACK: AlertsContextValue = {
  inbox: [],
  unread: 0,
  preferences: DEFAULT_ALERT_PREFERENCES,
  open: false,
  setOpen: () => undefined,
  openAlert: () => undefined,
  markRead: () => undefined,
  markAllRead: () => undefined,
  updatePreferences: async () => undefined,
};

const AlertsContext = createContext<AlertsContextValue>(FALLBACK);

/** Position de référence pour les rencontres « dans un rayon donné ». */
const POSITION_KEY = 'alerts.lastPosition.v1';

function readStoredPosition(): { lat: number; lng: number } | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { lat?: number; lng?: number };
    if (typeof value.lat !== 'number' || typeof value.lng !== 'number') return null;
    return { lat: value.lat, lng: value.lng };
  } catch {
    return null;
  }
}

/**
 * Fournisseur des notifications in-app.
 *
 * Il alimente une **cloche** persistante (barre supérieure) à partir des flux
 * déjà écoutés par l'application :
 *  - nouveau message reçu d'un ami ;
 *  - demande d'ami reçue ;
 *  - rencontre proposée dans le rayon choisi par l'utilisateur ;
 *  - rappel des rencontres auxquelles il est inscrit.
 *
 * Aucune de ces alertes n'existait auparavant : un message reçu app ouverte
 * n'était visible que dans l'onglet Amis, et une nouvelle rencontre proche
 * passait totalement inaperçue.
 */
export function AlertsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [inbox, setInbox] = useState<InAppAlert[]>([]);
  const [preferences, setPreferences] = useState<AlertPreferences>(DEFAULT_ALERT_PREFERENCES);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(() => readStoredPosition());
  const prefRef = useRef(preferences);
  prefRef.current = preferences;
  /** Clés déjà vues pendant cette session (évite le doublon message/notification). */
  const seenRef = useRef<Set<string>>(new Set());
  const readyRef = useRef(false);

  // Chargement initial : boîte + préférences (une seule fois).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [storedInbox, prefs] = await Promise.all([loadInbox(), getAlertPreferences()]);
      if (cancelled) return;
      setInbox(storedInbox);
      storedInbox.forEach((item) => seenRef.current.add(item.key));
      setPreferences(prefs);
      readyRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persistance de la boîte (y compris les lectures).
  useEffect(() => {
    if (!readyRef.current) return;
    void saveInbox(inbox);
  }, [inbox]);

  const addAlert = useCallback(
    (alert: Omit<InAppAlert, 'createdAt' | 'read'>, options: { toast?: boolean } = {}) => {
      if (seenRef.current.has(alert.key)) return;
      seenRef.current.add(alert.key);
      setInbox((current) => pushAlert(current, alert));
      if (options.toast) toast(`${alert.title} — ${alert.body}`, 'info');
    },
    [toast],
  );

  // Position de référence : rafraîchie à chaque ouverture de l'application.
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    void getCurrentPosition({ silent: true })
      .then((pos) => {
        if (cancelled || !pos) return;
        const next = { lat: pos.lat, lng: pos.lng };
        setPosition(next);
        try {
          localStorage.setItem(POSITION_KEY, JSON.stringify(next));
        } catch {
          /* stockage plein : la position en mémoire suffit */
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [profile?.uid]);

  /**
   * Synchronise préférences et dernière position connue sur le profil.
   *
   * Le worker (cron) en a besoin pour envoyer les alertes de rencontre quand
   * l'application est fermée : sans ces champs côté serveur, le rayon choisi
   * resterait une préférence purement locale.
   */
  useEffect(() => {
    if (!profile) return;
    void syncAlertSettings(profile.uid, preferences, position).catch(() => undefined);
  }, [profile?.uid, preferences, position?.lat, position?.lng]);

  // ---- Messages reçus -----------------------------------------------------
  /**
   * Seuil de fraîcheur : seuls les messages reçus **après** l'ouverture de
   * l'application déclenchent une alerte. Sans cela, les cinq derniers messages
   * non lus rejouaient tous leurs toasts à chaque lancement.
   */
  const mountedAtRef = useRef(Date.now());
  useEffect(() => {
    if (!profile) return;
    const uid = profile.uid;
    const since = mountedAtRef.current - 60_000;
    const unsub = watchRecentMessages(uid, (messages) => {
      if (!prefRef.current.messages) return;
      const received = messages
        .filter((m) => m.to === uid && m.from !== uid && (m.createdAt || 0) >= since)
        .slice(0, 5);
      for (const message of received) {
        // `read` est posé par le destinataire : un message déjà lu ne notifie pas.
        if (message.read) continue;
        const key = `message:${message.id}`;
        if (seenRef.current.has(key)) continue;
        addAlert(
          {
            key,
            kind: 'message',
            title: `💬 ${message.fromName}`,
            body: message.text.slice(0, 120),
            path: '/friends',
          },
          { toast: true },
        );
      }
    });
    return unsub;
  }, [profile?.uid, addAlert]);

  // ---- Demandes d'ami -----------------------------------------------------
  useEffect(() => {
    if (!profile) return;
    const uid = profile.uid;
    const unsub = watchIncomingRequests(
      uid,
      (requests) => {
        if (!prefRef.current.friendRequests) return;
        for (const request of requests) {
          if (!request.id) continue;
          const key = `friend:${request.id}`;
          if (seenRef.current.has(key)) continue;
          addAlert(
            {
              key,
              kind: 'friend_request',
              title: 'Nouvelle demande d’ami',
              body: `${request.fromName} souhaite vous ajouter.`,
              path: '/friends',
            },
            { toast: true },
          );
        }
      },
      () => undefined,
    );
    return unsub;
  }, [profile?.uid, addAlert]);

  // ---- Rencontres proches + rappel d'inscription --------------------------
  useEffect(() => {
    if (!profile) return;
    const uid = profile.uid;
    const unsub = watchCommunityEvents((events: CommunityEvent[]) => {
      const prefs = prefRef.current;
      const now = Date.now();

      // 1) Rencontre proposée dans le rayon choisi.
      if (prefs.nearbyEvents && position) {
        const radiusM = prefs.nearbyRadiusKm * 1000;
        for (const event of events) {
          if (event.status === 'cancelled') continue;
          if (event.creatorUid === uid) continue;
          if (event.lat == null || event.lng == null) continue;
          const start = eventDate(event).getTime();
          if (!Number.isFinite(start) || start < now) continue;
          const distance = haversineM(position, { lat: event.lat, lng: event.lng });
          if (distance > radiusM) continue;
          const key = `nearby:${event.id}:${event.date}`;
          if (seenRef.current.has(key)) continue;
          addAlert(
            {
              key,
              kind: 'event_nearby',
              title: 'Rencontre près de vous',
              body: `${event.title} · ${Math.round(distance / 100) / 10} km`,
              path: '/events',
            },
            { toast: true },
          );
        }
      }

      // 2) Rappel des rencontres où je suis inscrit.
      if (prefs.eventReminders) {
        for (const event of events) {
          if (event.status === 'cancelled') continue;
          const joined = event.participants?.includes(uid) || (event.waitlist || []).includes(uid);
          if (!joined) continue;
          const start = eventDate(event).getTime();
          if (!Number.isFinite(start)) continue;
          const lead = prefs.eventReminderMinutes * 60_000;
          if (start - now > lead || start < now) continue;
          const key = `reminder:${event.id}:${event.date}:${prefs.eventReminderMinutes}`;
          if (seenRef.current.has(key)) continue;
          const when = eventDate(event).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
          addAlert(
            {
              key,
              kind: 'event_reminder',
              title: 'Votre rencontre commence bientôt',
              body: `${event.title} · ${when} · ${event.location || event.establishmentName || 'Lieu dans ElyWalk'}`,
              path: '/events',
            },
            { toast: true },
          );
        }
      }
    });
    return unsub;
  }, [profile?.uid, position?.lat, position?.lng, addAlert]);

  // Notification système quand une alerte arrive (app en arrière-plan).
  const lastNotifiedRef = useRef<string | null>(null);
  useEffect(() => {
    const newest = inbox[0];
    if (!newest || newest.read) return;
    if (lastNotifiedRef.current === newest.key) return;
    lastNotifiedRef.current = newest.key;
    void notifyLocally(newest);
  }, [inbox]);

  const openAlert = useCallback(
    (alert: InAppAlert) => {
      setInbox((current) => markAlertRead(current, alert.key));
      setOpen(false);
      navigate(alert.path || '/');
    },
    [navigate],
  );

  const markRead = useCallback((key: string) => {
    setInbox((current) => markAlertRead(current, key));
  }, []);

  const markAllRead = useCallback(() => {
    setInbox((current) => markAllAlertsRead(current));
  }, []);

  const updatePreferences = useCallback(async (patch: Partial<AlertPreferences>) => {
    // La source de vérité est `Preferences` (Capacitor) : elle survit au
    // redémarrage et reste lisible par la cloche comme par les Réglages.
    const next = await setAlertPreferences({ ...prefRef.current, ...patch });
    setPreferences(next);
  }, []);

  const unread = useMemo(() => unreadAlertCount(inbox), [inbox]);

  const value = useMemo<AlertsContextValue>(
    () => ({ inbox, unread, preferences, open, setOpen, openAlert, markRead, markAllRead, updatePreferences }),
    [inbox, unread, preferences, open, openAlert, markRead, markAllRead, updatePreferences],
  );

  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts(): AlertsContextValue {
  return useContext(AlertsContext);
}
