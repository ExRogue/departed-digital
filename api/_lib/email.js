const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_BASE_URL = 'https://www.departed.digital';

function normalizeEmail(value) {
  return String(value || '').trim().slice(0, 320);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function paragraphize(value) {
  return escapeHtml(value || '')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function getEmailSettings() {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = normalizeEmail(process.env.EMAIL_FROM);
  const operationsAlertEmail = normalizeEmail(process.env.OPERATIONS_ALERT_EMAIL);
  const replyTo = normalizeEmail(process.env.EMAIL_REPLY_TO);
  const baseUrl = String(process.env.PUBLIC_SITE_URL || DEFAULT_BASE_URL).trim() || DEFAULT_BASE_URL;

  return {
    provider: apiKey ? 'resend' : 'none',
    enabled: Boolean(apiKey && from),
    apiKey,
    from,
    operationsAlertEmail,
    replyTo,
    baseUrl
  };
}

function getEmailHealth() {
  const settings = getEmailSettings();

  return {
    provider: settings.provider,
    enabled: settings.enabled,
    hasFromAddress: Boolean(settings.from),
    hasOperationsAlertEmail: Boolean(settings.operationsAlertEmail),
    hasReplyTo: Boolean(settings.replyTo)
  };
}

async function sendEmail({ to, subject, html, text }) {
  const settings = getEmailSettings();

  if (!settings.enabled) {
    return {
      ok: false,
      skipped: true,
      reason: 'email_not_configured'
    };
  }

  const recipients = Array.isArray(to)
    ? to.map(normalizeEmail).filter(Boolean)
    : [normalizeEmail(to)].filter(Boolean);

  if (!recipients.length) {
    return {
      ok: false,
      skipped: true,
      reason: 'missing_recipient'
    };
  }

  const payload = {
    from: settings.from,
    to: recipients,
    subject: String(subject || '').trim().slice(0, 200),
    html: String(html || ''),
    text: String(text || '')
  };

  if (settings.replyTo) {
    payload.reply_to = settings.replyTo;
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || 'Email provider rejected the request.');
  }

  return {
    ok: true,
    id: data.id || '',
    to: recipients
  };
}

function buildShell(title, intro, bodyHtml, outro = '') {
  return [
    '<div style="background:#f9f6f0;padding:32px 16px;font-family:Inter,Arial,sans-serif;color:#2d3a4a;">',
    '<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e4ddd0;border-radius:20px;overflow:hidden;">',
    '<div style="background:#1a2744;padding:24px 28px;color:#ffffff;">',
    '<div style="font-family:Georgia,serif;font-size:28px;line-height:1.1;">Departed.Digital</div>',
    '</div>',
    '<div style="padding:28px;">',
    `<h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:32px;line-height:1.15;color:#1a2744;">${escapeHtml(title)}</h1>`,
    `<p style="margin:0 0 18px;color:#6b7a8d;font-size:16px;line-height:1.7;">${escapeHtml(intro)}</p>`,
    `<div style="font-size:16px;line-height:1.7;color:#2d3a4a;">${bodyHtml}</div>`,
    outro ? `<p style="margin:22px 0 0;color:#6b7a8d;font-size:15px;line-height:1.7;">${escapeHtml(outro)}</p>` : '',
    '</div>',
    '</div>',
    '</div>'
  ].join('');
}

function caseUrls(caseRecord) {
  const settings = getEmailSettings();

  const casePage = `${settings.baseUrl}/case?case=${encodeURIComponent(caseRecord.id)}&token=${encodeURIComponent(caseRecord.publicToken)}`;

  return {
    payment: casePage,
    documents: `${casePage}#documents`,
    status: casePage
  };
}

async function sendCaseCreatedEmails(caseRecord) {
  const settings = getEmailSettings();
  const urls = caseUrls(caseRecord);
  const deliveries = [];

  if (settings.operationsAlertEmail) {
    deliveries.push(await sendEmail({
      to: settings.operationsAlertEmail,
      subject: `New Departed Digital case ${caseRecord.reference}`,
      text: [
        `New case received: ${caseRecord.reference}`,
        `Client: ${caseRecord.clientName} <${caseRecord.clientEmail}>`,
        `Deceased: ${caseRecord.deceasedName}`,
        `Package: ${caseRecord.packageLabel}`,
        `Relationship: ${caseRecord.relationshipToDeceased || 'Not supplied'}`,
        `Known platforms: ${caseRecord.knownPlatforms || 'Not supplied'}`,
        `Payment link: ${urls.payment}`,
        `Documents link: ${urls.documents}`,
        `Status page: ${urls.status}`
      ].join('\n'),
      html: buildShell(
        'A new case has come in.',
        'A family has started a case through Departed Digital.',
        [
          `<p><strong>Reference:</strong> ${escapeHtml(caseRecord.reference)}</p>`,
          `<p><strong>Client:</strong> ${escapeHtml(caseRecord.clientName)} (${escapeHtml(caseRecord.clientEmail)})</p>`,
          `<p><strong>Deceased:</strong> ${escapeHtml(caseRecord.deceasedName)}</p>`,
          `<p><strong>Package:</strong> ${escapeHtml(caseRecord.packageLabel)}</p>`,
          `<p><strong>Relationship:</strong> ${escapeHtml(caseRecord.relationshipToDeceased || 'Not supplied')}</p>`,
          `<p><strong>Known platforms:</strong> ${escapeHtml(caseRecord.knownPlatforms || 'Not supplied')}</p>`,
          `<p><strong>Case review step:</strong> <a href="${escapeHtml(urls.payment)}">${escapeHtml(urls.payment)}</a></p>`,
          `<p><strong>Document step:</strong> <a href="${escapeHtml(urls.documents)}">${escapeHtml(urls.documents)}</a></p>`,
          `<p><strong>Status page:</strong> <a href="${escapeHtml(urls.status)}">${escapeHtml(urls.status)}</a></p>`
        ].join('')
      )
    }));
  }

  deliveries.push(await sendEmail({
    to: caseRecord.clientEmail,
    subject: `We’ve received your case ${caseRecord.reference}`,
    text: [
      `Hello ${caseRecord.clientName},`,
      '',
      `We’ve received your case for ${caseRecord.deceasedName}.`,
      `Reference: ${caseRecord.reference}`,
      '',
      'You do not need to send passwords.',
      'We only ask for supporting documents after payment is confirmed.',
      '',
      `Your private case page (save this link): ${urls.status}`,
      '',
      'Departed Digital'
    ].join('\n'),
    html: buildShell(
      'We’ve received your case.',
      `Your reference is ${caseRecord.reference}. Everything about your case lives on one private page. Save the link below.`,
      [
        `<p>Hello ${escapeHtml(caseRecord.clientName)},</p>`,
        `<p>We’ve received your case for <strong>${escapeHtml(caseRecord.deceasedName)}</strong>.</p>`,
        `<p>You do not need to send passwords. We only ask for supporting documents after payment is confirmed.</p>`,
        `<p><a href="${escapeHtml(urls.status)}" style="display:inline-block;background:#c9a84c;color:#111b35;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">Open your private case page</a></p>`,
        `<p style="color:#6b7a8d;font-size:14px;">Save this link. It works from any device.</p>`
      ].join(''),
      'If anything is unclear, just reply to this email and we’ll help.'
    )
  }));

  return deliveries;
}

async function sendDocumentsUploadedEmails(caseRecord, documentCount) {
  const settings = getEmailSettings();
  const urls = caseUrls(caseRecord);
  const deliveries = [];

  if (settings.operationsAlertEmail) {
    deliveries.push(await sendEmail({
      to: settings.operationsAlertEmail,
      subject: `Documents uploaded for ${caseRecord.reference}`,
      text: [
        `Supporting documents uploaded for ${caseRecord.reference}`,
        `Client: ${caseRecord.clientName} <${caseRecord.clientEmail}>`,
        `Document count: ${documentCount}`,
        `Authority basis: ${caseRecord.authorityBasis || 'Not supplied'}`,
        `Open documents step: ${urls.documents}`,
        `Status page: ${urls.status}`
      ].join('\n'),
      html: buildShell(
        'Supporting documents uploaded.',
        'A case has moved forward and documents are now ready for review.',
        [
          `<p><strong>Reference:</strong> ${escapeHtml(caseRecord.reference)}</p>`,
          `<p><strong>Client:</strong> ${escapeHtml(caseRecord.clientName)} (${escapeHtml(caseRecord.clientEmail)})</p>`,
          `<p><strong>Documents received:</strong> ${escapeHtml(documentCount)}</p>`,
          `<p><strong>Authority basis:</strong> ${escapeHtml(caseRecord.authorityBasis || 'Not supplied')}</p>`,
          `<p><a href="${escapeHtml(urls.documents)}">${escapeHtml(urls.documents)}</a></p>`,
          `<p><a href="${escapeHtml(urls.status)}">${escapeHtml(urls.status)}</a></p>`
        ].join('')
      )
    }));
  }

  deliveries.push(await sendEmail({
    to: caseRecord.clientEmail,
    subject: `We’ve received your supporting documents for ${caseRecord.reference}`,
    text: [
      `Hello ${caseRecord.clientName},`,
      '',
      `We’ve received your supporting documents for ${caseRecord.reference}.`,
      'We’ll review what has been supplied and confirm the next step if anything else is needed.',
      `Case status page: ${urls.status}`,
      '',
      'Departed Digital'
    ].join('\n'),
    html: buildShell(
      'Your documents have been received.',
      'Thank you. We’ve recorded the upload and will review the documents before platform submissions begin.',
      `<p>We’ll confirm the next step if anything else is needed. Otherwise, the case can move into handling.</p><p><a href="${escapeHtml(urls.status)}">Open your case status page</a></p>`
    )
  }));

  return deliveries;
}

async function sendPaymentConfirmedEmail(caseRecord) {
  const settings = getEmailSettings();
  const urls = caseUrls(caseRecord);
  const deliveries = [];

  if (settings.operationsAlertEmail) {
    deliveries.push(await sendEmail({
      to: settings.operationsAlertEmail,
      subject: `Payment received for ${caseRecord.reference}`,
      text: [
        `Payment confirmed for ${caseRecord.reference} (${caseRecord.packageLabel}).`,
        `Client: ${caseRecord.clientName} <${caseRecord.clientEmail}>`,
        `Case page: ${urls.status}`
      ].join('\n'),
      html: buildShell(
        'Payment received.',
        `Stripe confirmed payment for ${caseRecord.reference} (${caseRecord.packageLabel}). Document upload is now open for the family.`,
        [
          `<p><strong>Client:</strong> ${escapeHtml(caseRecord.clientName)} (${escapeHtml(caseRecord.clientEmail)})</p>`,
          `<p><a href="${escapeHtml(urls.status)}">${escapeHtml(urls.status)}</a></p>`
        ].join('')
      )
    }));
  }

  deliveries.push(await sendEmail({
    to: caseRecord.clientEmail,
    subject: `Payment received: your next step for ${caseRecord.reference}`,
    text: [
      `Hello ${caseRecord.clientName},`,
      '',
      `Thank you. Your payment for case ${caseRecord.reference} has been received.`,
      'The next step is yours: upload the death certificate and proof of your authority on your private case page. We take it from there.',
      '',
      `Your private case page: ${urls.status}`,
      '',
      'Departed Digital'
    ].join('\n'),
    html: buildShell(
      'Payment received. Here is your next step.',
      `Thank you. Your payment for case ${caseRecord.reference} is confirmed, and the secure document upload is now open.`,
      [
        `<p>Hello ${escapeHtml(caseRecord.clientName)},</p>`,
        `<p>The next step is yours: upload the death certificate and proof of your authority on your private case page. Photos taken on a phone are fine. After that, we handle everything.</p>`,
        `<p><a href="${escapeHtml(urls.documents)}" style="display:inline-block;background:#c9a84c;color:#111b35;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">Upload your documents</a></p>`
      ].join(''),
      'If anything is unclear, just reply to this email and we’ll help.'
    )
  }));

  return deliveries;
}

async function sendManualCaseEmail(caseRecord, options) {
  const kind = String(options.kind || 'client_update');
  const subject = String(options.subject || '').trim().slice(0, 200);
  const message = String(options.message || '').trim().slice(0, 6000);
  const settings = getEmailSettings();

  if (!subject || !message) {
    throw new Error('Email subject and message are required.');
  }

  const target = kind === 'operations_summary'
    ? settings.operationsAlertEmail
    : caseRecord.clientEmail;

  const intro = kind === 'operations_summary'
    ? `Internal update for ${caseRecord.reference}.`
    : `This is an update on the Departed Digital case for ${caseRecord.deceasedName}.`;

  return sendEmail({
    to: target,
    subject,
    text: message,
    html: buildShell(subject, intro, paragraphize(message))
  });
}

// Builds the Stripe payment URL for a case, matching what /start sends the
// browser to: the package's payment link plus the case reference and email.
function buildPaymentUrl(caseRecord) {
  const links = {
    essential: process.env.STRIPE_PAYMENT_LINK_ESSENTIAL || '',
    standard: process.env.STRIPE_PAYMENT_LINK_STANDARD || '',
    estate: process.env.STRIPE_PAYMENT_LINK_ESTATE || ''
  };
  const link = links[caseRecord.selectedPackage] || links.standard;

  if (!link) {
    return '';
  }

  try {
    const url = new URL(link);
    url.searchParams.set('client_reference_id', caseRecord.id);
    if (caseRecord.clientEmail) {
      url.searchParams.set('prefilled_email', caseRecord.clientEmail);
    }
    return url.toString();
  } catch (error) {
    return '';
  }
}

function buttonHtml(href, label) {
  return `<p style="margin:22px 0;"><a href="${escapeHtml(href)}" style="background:#c9a84c;color:#111b35;text-decoration:none;padding:13px 26px;border-radius:999px;font-weight:600;display:inline-block;">${escapeHtml(label)}</a></p>`;
}

// Gentle reminder for a saved case that has not been paid for. Deliberately a
// pure service message: no urgency, no discounts, and stage 2 is the last one.
async function sendPaymentNudgeEmail(caseRecord, stage) {
  const urls = caseUrls(caseRecord);
  const paymentUrl = buildPaymentUrl(caseRecord) || urls.payment;
  const firstName = String(caseRecord.clientName || '').trim().split(/\s+/)[0] || 'there';

  if (stage === 1) {
    const bodyHtml = [
      `<p>Your case for ${escapeHtml(caseRecord.deceasedName || 'your loved one')} is saved, and nothing has been paid or lost. Whenever you are ready, you can pick up exactly where you left off.</p>`,
      buttonHtml(paymentUrl, 'Continue your case'),
      `<p>If it is easier later, the same link works from any device at any time. And if now is not the right moment, this email needs nothing from you.</p>`,
      `<p style="color:#6b7a8d;font-size:14px;">Your private case page: <a href="${escapeHtml(urls.status)}" style="color:#1a2744;">view your case</a></p>`
    ].join('');

    return sendEmail({
      to: caseRecord.clientEmail,
      subject: `Your case for ${caseRecord.deceasedName || 'your loved one'} is saved`,
      html: buildShell(`Hello ${firstName}`, `You started a case with Departed Digital, reference ${caseRecord.reference}.`, bodyHtml),
      text: `Your case ${caseRecord.reference} is saved. Continue whenever you are ready: ${paymentUrl}`
    });
  }

  const bodyHtml = [
    `<p>A few days ago you started a case for ${escapeHtml(caseRecord.deceasedName || 'your loved one')}. It is still saved, and there is no time limit on it.</p>`,
    `<p>If you have questions before going ahead, reply to this email and a real person will answer. Some families just want to check what documents they will need, or whether we can handle a particular platform.</p>`,
    buttonHtml(paymentUrl, 'Continue your case'),
    `<p style="color:#6b7a8d;font-size:14px;">This is the last reminder we will send about this case. If you would rather not go ahead, you can simply ignore it.</p>`
  ].join('');

  return sendEmail({
    to: caseRecord.clientEmail,
    subject: 'Whenever you are ready',
    html: buildShell(`Hello ${firstName}`, `Your Departed Digital case ${caseRecord.reference} is still saved.`, bodyHtml),
    text: `Your case ${caseRecord.reference} is still saved. Continue whenever you are ready: ${paymentUrl}. This is the last reminder we will send.`
  });
}

// Reminders to send documents after payment. Three stages, then we stop.
async function sendDocumentReminderEmail(caseRecord, stage) {
  const urls = caseUrls(caseRecord);
  const firstName = String(caseRecord.clientName || '').trim().split(/\s+/)[0] || 'there';

  let subject;
  let bodyHtml;

  if (stage === 1) {
    subject = `Your next step for ${caseRecord.reference}`;
    bodyHtml = [
      `<p>Your case is paid and ready. The one thing we need before we can start contacting platforms is your documents, and most families have them to hand already:</p>`,
      '<ul style="margin:0 0 18px 20px;padding:0;">',
      '<li style="margin-bottom:8px;">The death certificate</li>',
      '<li style="margin-bottom:8px;">Proof of your authority, such as probate, letters of administration, or a document showing your relationship</li>',
      '<li style="margin-bottom:8px;">A photo of your own ID</li>',
      '</ul>',
      `<p>Clear photos taken on your phone are fine. Uploading takes about two minutes.</p>`,
      buttonHtml(urls.documents, 'Send your documents')
    ].join('');
  } else if (stage === 2) {
    subject = 'When you have ten quiet minutes';
    bodyHtml = [
      `<p>Just a gentle note that your case for ${escapeHtml(caseRecord.deceasedName || 'your loved one')} is waiting on documents before we can begin.</p>`,
      `<p>If anything on the list is proving hard to find, reply to this email and tell us what you have. There is often another document that platforms will accept, and we would rather help than have you stuck.</p>`,
      buttonHtml(urls.documents, 'Send your documents')
    ].join('');
  } else {
    subject = 'Your case is safe with us, whenever you are ready';
    bodyHtml = [
      `<p>We know the weeks after a loss rarely go to plan, so this is just reassurance: your case is open, paid, and waiting, and it stays that way until you are ready. There is no deadline on our side.</p>`,
      `<p>When you would like a hand, reply to this email or send the documents through your case page, and we will take it from there.</p>`,
      buttonHtml(urls.documents, 'Open your case page'),
      `<p style="color:#6b7a8d;font-size:14px;">We will not send any more reminders about this. Your case link always works.</p>`
    ].join('');
  }

  return sendEmail({
    to: caseRecord.clientEmail,
    subject,
    html: buildShell(`Hello ${firstName}`, `About your Departed Digital case ${caseRecord.reference}.`, bodyHtml),
    text: `About case ${caseRecord.reference}: we are waiting on your documents before we can begin. Send them here: ${urls.documents}`
  });
}

// Sent a couple of days after completion. Only fires when REVIEW_URL is set,
// and it is the one email in the flow that is marketing-adjacent, so it stays
// single-send and easy to ignore.
async function sendCompletionFollowUpEmail(caseRecord) {
  const reviewUrl = String(process.env.REVIEW_URL || '').trim();

  if (!reviewUrl) {
    return { ok: false, skipped: true, reason: 'review_url_not_configured' };
  }

  const firstName = String(caseRecord.clientName || '').trim().split(/\s+/)[0] || 'there';
  const bodyHtml = [
    `<p>We hope the written summary for ${escapeHtml(caseRecord.deceasedName || 'your loved one')} gave you one less thing to carry.</p>`,
    `<p>If you have a spare minute, a short review makes an enormous difference to a small service like ours. It is usually how other families in the same situation find help.</p>`,
    buttonHtml(reviewUrl, 'Leave a short review'),
    `<p style="color:#6b7a8d;font-size:14px;">This is the only follow-up we will send. Thank you for trusting us with something that mattered.</p>`
  ].join('');

  return sendEmail({
    to: caseRecord.clientEmail,
    subject: 'Thank you for trusting us',
    html: buildShell(`Hello ${firstName}`, `Your Departed Digital case ${caseRecord.reference} is complete.`, bodyHtml),
    text: `Your case ${caseRecord.reference} is complete. If you have a minute, a short review helps other families find us: ${reviewUrl}`
  });
}

module.exports = {
  getEmailHealth,
  getEmailSettings,
  sendCaseCreatedEmails,
  sendCompletionFollowUpEmail,
  sendDocumentReminderEmail,
  sendDocumentsUploadedEmails,
  sendManualCaseEmail,
  sendPaymentConfirmedEmail,
  sendPaymentNudgeEmail
};
