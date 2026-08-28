const crypto = require('node:crypto');
const { sendPaymentConfirmedEmail } = require('../_lib/email');
const { methodNotAllowed, readRawBody, sendError, sendJson } = require('../_lib/http');
const { getCaseForAdmin, isUuidLike, updateAdminCase } = require('../_lib/store');

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

// Verifies a Stripe-Signature header (t=...,v1=...) against the raw payload.
function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) {
    return false;
  }

  const parts = {};
  for (const pair of String(signatureHeader).split(',')) {
    const [key, value] = pair.split('=', 2);
    if (key && value) {
      (parts[key.trim()] = parts[key.trim()] || []).push(value.trim());
    }
  }

  const timestamp = Number((parts.t && parts.t[0]) || 0);
  const signatures = parts.v1 || [];

  if (!timestamp || !signatures.length) {
    return false;
  }

  if (Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  return signatures.some((signature) => {
    const candidate = Buffer.from(signature, 'utf8');
    return candidate.length === expectedBuffer.length && crypto.timingSafeEqual(candidate, expectedBuffer);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST']);
    return;
  }

  try {
    const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

    if (!secret) {
      console.error('stripe webhook received but STRIPE_WEBHOOK_SECRET is not configured');
      sendError(res, 503, 'Webhook is not configured.');
      return;
    }

    const rawBody = await readRawBody(req);

    if (!verifyStripeSignature(rawBody, req.headers['stripe-signature'], secret)) {
      sendError(res, 400, 'Invalid signature.');
      return;
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch (error) {
      sendError(res, 400, 'Invalid payload.');
      return;
    }

    if (event.type !== 'checkout.session.completed') {
      sendJson(res, 200, { ok: true, handled: false });
      return;
    }

    const session = (event.data && event.data.object) || {};
    const caseId = String(session.client_reference_id || '').trim();

    if (!isUuidLike(caseId)) {
      // A payment without a case reference (e.g. a link shared directly) still
      // succeeds in Stripe; it just needs manual reconciliation.
      console.error('stripe checkout completed without a usable client_reference_id', {
        sessionId: session.id || '',
        clientReferenceId: caseId
      });
      sendJson(res, 200, { ok: true, handled: false });
      return;
    }

    const existing = await getCaseForAdmin(caseId);

    if (!existing) {
      console.error('stripe checkout referenced an unknown case', { caseId, sessionId: session.id || '' });
      sendJson(res, 200, { ok: true, handled: false });
      return;
    }

    if (existing.paymentStatus === 'paid') {
      sendJson(res, 200, { ok: true, handled: true, alreadyPaid: true });
      return;
    }

    const updated = await updateAdminCase(caseId, {
      paymentStatus: 'paid',
      status: 'awaiting_documents',
      activityEvent: 'payment_confirmed',
      activityMetadata: {
        source: 'stripe_webhook',
        checkoutSessionId: session.id || '',
        amountTotal: session.amount_total || 0,
        currency: session.currency || ''
      }
    });

    if (updated) {
      sendPaymentConfirmedEmail(updated).catch((error) => {
        console.error('payment_confirmed_email_failed', error);
      });
    }

    sendJson(res, 200, { ok: true, handled: true });
  } catch (error) {
    console.error('stripe webhook failed', error);
    sendError(res, 500, 'Webhook processing failed.');
  }
};
