import type { DirectMessage } from './types';

/**
 * Lecture de la messagerie (A8).
 *
 * Constat : le badge de l'onglet Amis affichait `messages.length`, c'est-à-dire
 * le nombre de messages **chargés**, et non les non-lus. Deux conversations
 * actives suffisaient donc à afficher « Messages · 12 » alors qu'aucun message
 * n'était à lire — et inversement, un message non lu pouvait ne produire aucun
 * badge quand la limite de chargement était atteinte.
 *
 * Ces fonctions sont pures : elles prennent la liste des messages déjà écoutés
 * et renvoient les compteurs par interlocuteur, ce qui les rend testables sans
 * Firestore.
 */

export interface ConversationSummary {
  friendUid: string;
  friendName: string;
  lastText: string;
  lastAt: number;
  /** Messages reçus non lus de cet interlocuteur. */
  unread: number;
  /** Dernier message envoyé par moi ? (pour l'aperçu « Vous : … ») */
  fromMe: boolean;
  /** J'ai envoyé un message resté sans réponse après un message lu. */
  awaitingReply: boolean;
}

/** Nombre de messages non lus, tous interlocuteurs confondus. */
export function totalUnread(messages: DirectMessage[], uid: string): number {
  return messages.reduce(
    (count, message) => (message.to === uid && message.from !== uid && !message.read ? count + 1 : count),
    0,
  );
}

/** Compteur de non-lus **par conversation**. */
export function unreadByFriend(messages: DirectMessage[], uid: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const message of messages) {
    if (message.to !== uid) continue;
    if (message.from === uid) continue;
    if (message.read) continue;
    counts[message.from] = (counts[message.from] || 0) + 1;
  }
  return counts;
}

/** Résumé d'une conversation avec chaque interlocuteur, du plus récent au plus ancien. */
export function conversationSummaries(messages: DirectMessage[], uid: string): ConversationSummary[] {
  const byFriend = new Map<string, ConversationSummary>();
  for (const message of messages) {
    const fromMe = message.from === uid;
    const friendUid = fromMe ? message.to : message.from;
    if (!friendUid) continue;
    const friendName = fromMe ? message.toName : message.fromName;
    const current = byFriend.get(friendUid);
    const unread = !fromMe && !message.read ? 1 : 0;
    if (!current) {
      byFriend.set(friendUid, {
        friendUid,
        friendName: friendName || friendUid,
        lastText: message.text,
        lastAt: message.createdAt || 0,
        unread,
        fromMe,
        awaitingReply: fromMe,
      });
      continue;
    }
    current.unread += unread;
    if ((message.createdAt || 0) >= current.lastAt) {
      current.lastAt = message.createdAt || 0;
      current.lastText = message.text;
      current.fromMe = fromMe;
      current.friendName = friendName || current.friendName;
    }
    // Une réponse de l'ami clôt l'attente.
    if (!fromMe) current.awaitingReply = false;
  }
  return [...byFriend.values()].sort((a, b) => b.lastAt - a.lastAt);
}

/** Identifiants des messages reçus restant à marquer comme lus. */
export function messageIdsToMarkRead(messages: DirectMessage[], uid: string, friendUid?: string): string[] {
  return messages
    .filter((message) => message.id && message.to === uid && message.from !== uid && !message.read)
    .filter((message) => (friendUid ? message.from === friendUid : true))
    .map((message) => message.id!);
}

/** Aperçu court d'un message (une ligne, 60 caractères). */
export function previewText(text: string, max = 60): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
