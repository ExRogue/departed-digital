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

  return {
    payment: `${settings.baseUrl}/review?case=${encodeURIComponent(caseRecord.id)}&token=${encodeURIComponent(caseRecord.publicToken)}&package=${encodeURIComponent(caseRecord.selectedPackage)}`,
    documents: `${settings.baseUrl}/documents?case=${encodeURIComponent(caseRecord.id)}&token=${encodeURIComponent(caseRecord.publicToken)}`,
    status: `${settings.baseUrl}/case?case=${encodeURIComponent(caseRecord.id)}&token=${encodeURIComponent(caseRecord.publicToken)}`
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
      'Supporting documents are only requested after the checkout handoff has been confirmed.',
      '',
      `Your next step: ${urls.payment}`,
      `Your status page: ${urls.status}`,
      '',
      'Departed Digital'
    ].join('\n'),
    html: buildShell(
      'We’ve received your case.',
      `Your reference is ${caseRecord.reference}. We’ve created the record and the next step is the private case review page.`,
      [
        `<p>Hello ${escapeHtml(caseRecord.clientName)},</p>`,
        `<p>We’ve received your case for <strong>${escapeHtml(caseRecord.deceasedName)}</strong>.</p>`,
        `<p>You do not need to send passwords. Supporting documents are only requested after the checkout handoff has been confirmed.</p>`,
        `<p><a href="${escapeHtml(urls.payment)}" style="display:inline-block;background:#c9a84c;color:#111b35;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700;">Open your private case review</a></p>`,
        `<p><a href="${escapeHtml(urls.status)}">Open your case status page</a></p>`
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

module.exports = {
  getEmailHealth,
  getEmailSettings,
  sendCaseCreatedEmails,
  sendDocumentsUploadedEmails,
  sendManualCaseEmail
};
