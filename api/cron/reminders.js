const { sendCompletionFollowUpEmail, sendDocumentReminderEmail, sendPaymentNudgeEmail } = require('../_lib/email');
const { methodNotAllowed, sendError, sendJson } = require('../_lib/http');
const { getCaseForAdmin, listAdminCaseSummaries, updateAdminCase } = require('../_lib/store');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MAX_SENDS_PER_RUN = 25;

// Vercel Cron calls this endpoint once a day. Each rule below has a window so
// a case that ages past a window without a send (for example while email was
// down) is left alone rather than being nudged weeks later.
const RULES = [
  {
    key: 'unpaid_nudge_1',
    windowStart: 4 * HOUR,
    windowEnd: 3 * DAY,
    applies: (c) => c.status === 'awaiting_payment' && c.paymentStatus !== 'paid',
    anchor: (record) => record.createdAt,
    send: (record) => sendPaymentNudgeEmail(record, 1)
  },
  {
    key: 'unpaid_nudge_2',
    windowStart: 3 * DAY,
    windowEnd: 10 * DAY,
    applies: (c) => c.status === 'awaiting_payment' && c.paymentStatus !== 'paid',
    anchor: (record) => record.createdAt,
    send: (record) => sendPaymentNudgeEmail(record, 2)
  },
  {
    key: 'docs_reminder_1',
    windowStart: 20 * HOUR,
    windowEnd: 3 * DAY,
    applies: (c) => c.paymentStatus === 'paid' && c.status === 'awaiting_documents' && Number(c.documentCount) === 0,
    anchor: (record) => activityTime(record, 'payment_confirmed') || record.createdAt,
    send: (record) => sendDocumentReminderEmail(record, 1)
  },
  {
    key: 'docs_reminder_2',
    windowStart: 3 * DAY,
    windowEnd: 7 * DAY,
    applies: (c) => c.paymentStatus === 'paid' && c.status === 'awaiting_documents' && Number(c.documentCount) === 0,
    anchor: (record) => activityTime(record, 'payment_confirmed') || record.createdAt,
    send: (record) => sendDocumentReminderEmail(record, 2)
  },
  {
    key: 'docs_reminder_3',
    windowStart: 7 * DAY,
    windowEnd: 14 * DAY,
    applies: (c) => c.paymentStatus === 'paid' && c.status === 'awaiting_documents' && Number(c.documentCount) === 0,
    anchor: (record) => activityTime(record, 'payment_confirmed') || record.createdAt,
    send: (record) => sendDocumentReminderEmail(record, 3)
  },
  {
    key: 'completion_follow_up',
    windowStart: 2 * DAY,
    windowEnd: 14 * DAY,
    applies: (c) => c.status === 'completed' && Boolean(String(process.env.REVIEW_URL || '').trim()),
    anchor: (record) => activityTime(record, 'status_completed') || activityTime(record, 'case_completed') || record.updatedAt,
    send: (record) => sendCompletionFollowUpEmail(record)
  }
];

function activityTime(record, eventName) {
  const entries = Array.isArray(record.activity) ? record.activity : [];
  const match = entries.find((entry) => entry && entry.event === eventName);
  return match ? (match.at || match.createdAt || '') : '';
}

function reminderAlreadySent(record, key) {
  const entries = Array.isArray(record.activity) ? record.activity : [];
  return entries.some((entry) => entry
    && entry.event === 'reminder_email_sent'
    && entry.metadata
    && entry.metadata.key === key);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    methodNotAllowed(res, ['GET', 'POST']);
    return;
  }

  const secret = String(process.env.CRON_SECRET || '').trim();

  if (!secret) {
    sendError(res, 503, 'Reminder cron is not configured.');
    return;
  }

  if (req.headers.authorization !== `Bearer ${secret}`) {
    sendError(res, 401, 'Unauthorized.');
    return;
  }

  try {
    const summaries = await listAdminCaseSummaries();
    const now = Date.now();
    const results = { checked: summaries.length, sent: [], skipped: 0, errors: [] };

    for (const summary of summaries) {
      if (results.sent.length >= MAX_SENDS_PER_RUN) {
        break;
      }

      if (summary.archivedAt) {
        continue;
      }

      const matchingRules = RULES.filter((rule) => rule.applies(summary));

      if (!matchingRules.length) {
        continue;
      }

      // One fetch per candidate case; volumes here are small.
      const record = await getCaseForAdmin(summary.id);

      if (!record || !record.clientEmail) {
        continue;
      }

      for (const rule of matchingRules) {
        if (reminderAlreadySent(record, rule.key)) {
          results.skipped += 1;
          continue;
        }

        const anchorRaw = rule.anchor(record);
        const anchor = anchorRaw ? new Date(anchorRaw).getTime() : NaN;

        if (!Number.isFinite(anchor)) {
          continue;
        }

        const age = now - anchor;

        if (age < rule.windowStart || age >= rule.windowEnd) {
          continue;
        }

        try {
          const delivery = await rule.send(record);

          if (delivery && delivery.skipped) {
            results.skipped += 1;
            continue;
          }

          await updateAdminCase(record.id, {
            activityEvent: 'reminder_email_sent',
            activityMetadata: { key: rule.key, source: 'cron' }
          });
          results.sent.push({ reference: record.reference, key: rule.key });
        } catch (error) {
          console.error('reminder_email_failed', { caseId: record.id, key: rule.key, error: String(error && error.message) });
          results.errors.push({ reference: record.reference, key: rule.key });
        }

        // At most one reminder per case per run keeps the inbox gentle even
        // if a case is somehow eligible for two stages at once.
        break;
      }
    }

    sendJson(res, 200, { ok: true, ...results });
  } catch (error) {
    console.error('reminder cron failed', error);
    sendError(res, 500, 'Reminder run failed.');
  }
};
