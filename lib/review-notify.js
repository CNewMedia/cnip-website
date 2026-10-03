import {
  getReviewItem,
  markNotificationSent,
  markNotificationFailed,
  listPendingNotificationIds,
  dropPendingNotification,
  acquireLock,
} from './contact-guard.js';
import { sendResend } from './contact-mail.js';

const FAST_RETRY_ATTEMPTS = 5;
const FAST_RETRY_SPACING_MS = 10 * 60 * 1000;
const SLOW_RETRY_SPACING_MS = 6 * 60 * 60 * 1000;
const RUN_LOCK_SECONDS = 5 * 60;
const RUN_BATCH = 3;

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

// The first attempts are spaced 10 minutes apart, then every 6 hours, until the mail is delivered
// or the 30-day record expires. Nothing is ever dropped while the request itself is still stored.
export function isRetryDue(notification, now = Date.now()) {
  const attempts = notification?.attempts || 0;
  if (attempts === 0) return true;
  const last = Date.parse(notification?.lastAttemptAt || '') || 0;
  const spacing = attempts < FAST_RETRY_ATTEMPTS ? FAST_RETRY_SPACING_MS : SLOW_RETRY_SPACING_MS;
  return now - last >= spacing;
}

// Triggered in the background by form traffic (form-config and contact). A shared lock allows at
// most one run per 5 minutes across all instances, and each run retries at most 3 notifications.
export async function retryPendingNotifications() {
  try {
    const ids = await listPendingNotificationIds(50);
    if (!ids.length) return { ran: false };
    if (!(await acquireLock('notify-retry', RUN_LOCK_SECONDS))) return { ran: false };
    const results = [];
    for (const id of ids) {
      if (results.length >= RUN_BATCH) break;
      const item = await getReviewItem(id);
      if (!item) { await dropPendingNotification(id); continue; }
      if (item.notification?.status === 'sent') { await dropPendingNotification(id); continue; }
      if (!isRetryDue(item.notification)) continue;
      results.push([id, (await notifyReviewer(item)) ? 'sent' : 'failed']);
    }
    return { ran: true, results };
  } catch (error) {
    console.error('CNIP contactformulier: herhaalpoging beoordelingsmelding mislukt', error);
    return { ran: false, error: error.message };
  }
}
