import { useEffect, useState } from 'react';
import { useToast } from '../Toast';
import { useAuth } from '../../context/AuthContext';
import { useAlerts } from '../../context/AlertsContext';
import {
  getNotificationSettings,
  setPushEnabled,
  setReminderEnabled,
  setReminderSchedule,
  type NotificationSettings,
  type ReminderSchedule,
} from '../../lib/notifications';

/**
 * Réglages → Notifications (D07 + exigence produit #4).
 *
 * Trois groupes distincts, organisés par objectif et non par implémentation :
 *  1. **Rappels de marche** — heure, jours, plage silencieuse ;
 *  2. **Alertes** — messages, demandes d'ami, rencontre proposée dans un rayon
 *     ajustable (10 km par défaut) et rappel d'une rencontre où l'on est
 *     inscrit ;
 *  3. **Notifications push** — autorisation système.
 *
 * Les alertes du groupe 2 alimentent la cloche in-app et la notification
 * système ; leurs valeurs sont aussi synchronisées sur le profil pour que le
 * serveur puisse alerter quand l'application est fermée.
 */
export default function NotificationsSection() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { preferences: alertPrefs, updatePreferences: updateAlertPrefs } = useAlerts();
  const [notifSettings, setNotifSettings] = useState<NotificationSettings | null>(null);

  useEffect(() => {
    getNotificationSettings().then(setNotifSettings).catch(() => undefined);
  }, []);

  const onToggleReminder = async (value: boolean) => {
    try {
      await setReminderEnabled(value);
      setNotifSettings((s) => (s ? { ...s, reminder: value } : s));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const onTogglePush = async (value: boolean) => {
    if (!profile) return;
    try {
      await setPushEnabled(profile.uid, value);
      setNotifSettings((s) => (s ? { ...s, push: value } : s));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const onScheduleChange = async (patch: Partial<ReminderSchedule>) => {
    if (!notifSettings) return;
    const schedule = { ...notifSettings.schedule, ...patch };
    setNotifSettings({ ...notifSettings, schedule, reminder: schedule.enabled });
    try {
      await setReminderSchedule(schedule);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <>
      <div className="card" data-testid="settings-notifications">
        <div className="card-title">Rappels de marche</div>
        {notifSettings && (
          <>
            <div className="list-row">
              <div className="row-main">
                <div className="row-title" style={{ fontSize: 14 }}>Rappel quotidien</div>
                <div className="row-sub">
                  {notifSettings.schedule.time} · {notifSettings.schedule.days.length} jour(s) par semaine
                </div>
              </div>
              <button
                type="button"
                aria-pressed={notifSettings.reminder}
                className={`btn btn-sm ${notifSettings.reminder ? 'btn-gold' : 'btn-ghost'}`}
                onClick={() => void onToggleReminder(!notifSettings.reminder)}
                data-testid="toggle-reminder-button"
              >
                {notifSettings.reminder ? 'Activé' : 'Désactivé'}
              </button>
            </div>
            {notifSettings.reminder && (
              <div className="reminder-settings">
                <div className="chip-row" role="group" aria-label="Jours de rappel">
                  {['D', 'L', 'M', 'M', 'J', 'V', 'S'].map((label, day) => (
                    <button
                      key={day}
                      type="button"
                      className={`chip ${notifSettings.schedule.days.includes(day) ? 'chip-active' : ''}`}
                      aria-pressed={notifSettings.schedule.days.includes(day)}
                      aria-label={`Rappel le ${['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'][day]}`}
                      onClick={() =>
                        void onScheduleChange({
                          days: notifSettings.schedule.days.includes(day)
                            ? notifSettings.schedule.days.filter((d) => d !== day)
                            : [...notifSettings.schedule.days, day].sort(),
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="field">
                  <label htmlFor="reminder-time">Heure du rappel</label>
                  <input
                    id="reminder-time"
                    className="input"
                    type="time"
                    aria-label="Heure du rappel"
                    value={notifSettings.schedule.time}
                    onChange={(e) => void onScheduleChange({ time: e.target.value })}
                  />
                </div>
                <div className="two-col">
                  <div className="field">
                    <label htmlFor="quiet-start">Silence à partir de</label>
                    <input
                      id="quiet-start"
                      className="input"
                      type="time"
                      aria-label="Début de la plage silencieuse"
                      value={notifSettings.schedule.quietStart}
                      onChange={(e) => void onScheduleChange({ quietStart: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="quiet-end">Jusqu’à</label>
                    <input
                      id="quiet-end"
                      className="input"
                      type="time"
                      aria-label="Fin de la plage silencieuse"
                      value={notifSettings.schedule.quietEnd}
                      onChange={(e) => void onScheduleChange({ quietEnd: e.target.value })}
                    />
                  </div>
                </div>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={notifSettings.schedule.goalAware}
                    onChange={(e) => void onScheduleChange({ goalAware: e.target.checked })}
                  />
                  Adapter le message à mon objectif quotidien
                </label>
              </div>
            )}
          </>
        )}
      </div>

      <div className="card" data-testid="settings-alerts">
        <div className="card-title">Alertes</div>
        <p className="card-help">
          Ces alertes apparaissent dans la cloche de l’application et, si vous l’autorisez, en
          notification sur votre téléphone.
        </p>
        <label className="check-row">
          <input
            type="checkbox"
            checked={alertPrefs.messages}
            onChange={(e) => void updateAlertPrefs({ messages: e.target.checked })}
            data-testid="alert-messages"
          />
          Messages de mes amis
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={alertPrefs.friendRequests}
            onChange={(e) => void updateAlertPrefs({ friendRequests: e.target.checked })}
            data-testid="alert-friend-requests"
          />
          Demandes d’ami
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={alertPrefs.nearbyEvents}
            onChange={(e) => void updateAlertPrefs({ nearbyEvents: e.target.checked })}
            data-testid="alert-nearby-events"
          />
          Rencontre proposée près de moi
        </label>
        <div className="field">
          <label htmlFor="alert-radius">Rayon des rencontres proches</label>
          <div className="radius-row">
            <input
              id="alert-radius"
              className="input"
              type="range"
              min={1}
              max={50}
              step={1}
              value={alertPrefs.nearbyRadiusKm}
              onChange={(e) => void updateAlertPrefs({ nearbyRadiusKm: Number(e.target.value) })}
              disabled={!alertPrefs.nearbyEvents}
              data-testid="alert-radius"
            />
            <strong aria-live="polite">{alertPrefs.nearbyRadiusKm} km</strong>
          </div>
          <small className="field-help">
            Une alerte quand une sortie est proposée dans ce rayon autour de vous.
          </small>
        </div>
        <label className="check-row">
          <input
            type="checkbox"
            checked={alertPrefs.eventReminders}
            onChange={(e) => void updateAlertPrefs({ eventReminders: e.target.checked })}
            data-testid="alert-event-reminders"
          />
          Rappel d’une rencontre où je suis inscrit
        </label>
        <div className="field">
          <label htmlFor="alert-reminder-lead">Me prévenir avant le départ</label>
          <select
            id="alert-reminder-lead"
            className="input"
            value={alertPrefs.eventReminderMinutes}
            onChange={(e) => void updateAlertPrefs({ eventReminderMinutes: Number(e.target.value) })}
            disabled={!alertPrefs.eventReminders}
            data-testid="alert-reminder-lead"
          >
            <option value={15}>15 minutes avant</option>
            <option value={30}>30 minutes avant</option>
            <option value={60}>1 heure avant</option>
            <option value={120}>2 heures avant</option>
            <option value={1440}>La veille</option>
          </select>
        </div>
      </div>

      <div className="card" data-testid="settings-push">
        <div className="card-title">Notifications push</div>
        {notifSettings && (
          <div className="list-row">
            <div className="row-main">
              <div className="row-title" style={{ fontSize: 14 }}>Autoriser les notifications</div>
              <div className="row-sub">Demandes d’amis, messages, rencontres et retraits</div>
            </div>
            <button
              type="button"
              aria-pressed={notifSettings.push}
              className={`btn btn-sm ${notifSettings.push ? 'btn-gold' : 'btn-ghost'}`}
              onClick={() => void onTogglePush(!notifSettings.push)}
              data-testid="toggle-push-button"
            >
              {notifSettings.push ? 'Activé' : 'Désactivé'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
