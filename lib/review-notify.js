import {
  getReviewItem,
  markNotificationSent,
  markNotificationFailed,
  listPendingNotificationIds,
  dropPendingNotification,
  acquireLock,
} from './contact-guard.js';
import { sendResend } from './contact-mail.js';

export const AUTO_RETRY_MAX_ATTEMPTS = 5;
const AUTO_RETRY_INTERVAL_SECONDS = 10 * 60;
const AUTO_RETRY_BATCH = 3;

export async function notifyReviewer(item) {
  try {
    await sendResend({ ...item, reviewReasons: item.reasons, reviewId: item.id });
  } catch (error) {
    console.error('CNIP contactformulier: beoordelingsmelding mislukt', item.id, error);
    await markNotificationFailed(item, error.message).catch(e => console.error('CNIP: status bijwerken mislukt', e));
    return false;
  }
  await markNotificationSent(item).catch(e => console.error('CNIP: melding verstuurd maar status niet bijgewerkt', item.id, e));
  return true;
}

export async function retryNotification(id) {
  const item = await getReviewItem(id);
  if (!item) {
    await dropPendingNotification(id);
    return 'expired';
  }
  if (item.notification?.status === 'sent') {
    await dropPendingNotification(id);
    return 'already_sent';
  }
  return (await notifyReviewer(item)) ? 'sent' : 'failed';
}

// Automatic retries are capped per run, spaced by a shared lock and stop after a fixed number of
// attempts; anything left stays visible on the review page for a manual retry.
export async function autoRetryPendingNotifications() {
  try {
    const ids = await listPendingNotificationIds(20);
    if (!ids.length) return { ran: false };
    if (!(await acquireLock('notify-retry', AUTO_RETRY_INTERVAL_SECONDS))) return { ran: false };
    let tried = 0;
    const results = [];
    for (const id of ids) {
      if (tried >= AUTO_RETRY_BATCH) break;
      const item = await getReviewItem(id);
      if (!item) { await dropPendingNotification(id); continue; }
      if ((item.notification?.attempts || 0) >= AUTO_RETRY_MAX_ATTEMPTS) continue;
      tried++;
      results.push([id, (await notifyReviewer(item)) ? 'sent' : 'failed']);
    }
    return { ran: true, results };
  } catch (error) {
    console.error('CNIP contactformulier: automatische herhaalpoging mislukt', error);
    return { ran: false, error: error.message };
  }
}
