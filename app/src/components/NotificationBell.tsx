import { useAlerts } from '../context/AlertsContext';
import Sheet from './Sheet';

/**
 * Cloche de notifications in-app.
 *
 * Elle répond au besoin « voir quand on a reçu un message » : chaque message,
 * demande d'ami, rencontre proche ou rappel d'inscription y apparaît, avec un
 * compteur non lu, sans devoir ouvrir l'onglet correspondant.
 *
 * Placée dans l'en-tête des écrans principaux (`ScreenHeader`), elle est
 * masquée tant qu'aucune alerte n'existe afin de ne pas encombrer l'interface.
 */
export default function NotificationBell({ className = '' }: { className?: string }) {
  const { inbox, unread, open, setOpen, openAlert, markAllRead } = useAlerts();
  // Langue de la page (`<html lang>` est tenu à jour par LocaleProvider) : la
  // cloche reste utilisable même montée hors du fournisseur de langue.
  const lang = typeof document !== 'undefined' ? document.documentElement.lang || undefined : undefined;
  const formatWhen = (at: number) =>
    new Intl.DateTimeFormat(lang, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(at));

  const handleOpen = () => setOpen(true);

  return (
    <>
      <button
        type="button"
        className={`notification-bell ${unread > 0 ? 'notification-bell-active' : ''} ${className}`.trim()}
        onClick={handleOpen}
        aria-label={
          unread > 0
            ? `Notifications, ${unread} non lue${unread > 1 ? 's' : ''}`
            : 'Notifications'
        }
        data-testid="notification-bell"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Notifications" testId="notification-sheet">
        {inbox.length === 0 ? (
          <div className="empty-state" data-testid="notification-empty">
            <strong>Aucune notification</strong>
            <span>
              Les messages, demandes d’ami et rencontres proches apparaîtront ici. Choisissez ce que
              vous recevez dans Réglages → Notifications.
            </span>
          </div>
        ) : (
          <>
            {unread > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={markAllRead}
                data-testid="notification-mark-all"
              >
                Tout marquer comme lu
              </button>
            )}
            <ul className="notification-list" data-testid="notification-list">
              {inbox.map((alert) => (
                <li key={alert.key}>
                  <button
                    type="button"
                    className={`notification-row ${alert.read ? '' : 'notification-row-unread'}`.trim()}
                    onClick={() => openAlert(alert)}
                  >
                    <div className="notification-row-main">
                      <span className="notification-row-title">{alert.title}</span>
                      <span className="notification-row-body">{alert.body}</span>
                      <span className="notification-row-time">
                        {formatWhen(alert.createdAt)}
                      </span>
                    </div>
                    {!alert.read && <span className="notification-dot" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Sheet>
    </>
  );
}
