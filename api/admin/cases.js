const {
  CASE_PRIORITIES,
  CASE_STATUSES,
  REMINDER_SEVERITIES,
  REMINDER_STATUSES,
  PACKAGE_CONFIG,
  PAYMENT_STATUSES,
  PLATFORM_STATUSES,
  REFERRAL_FEE_STATUSES
} = require('../_lib/config');
const { allowCors, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('../_lib/http');
const { requireAdminAccess } = require('../_lib/security');
const JSZip = require('jszip');
const {
  archiveAdminCase,
  deleteCase,
  getAdminCaseById,
  getAdminCaseDocumentAsset,
  listAdminCaseSummaries,
  restoreAdminCase,
  updateAdminCase
} = require('../_lib/store');

function normalizeString(value, maxLength = 4000) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizePlatformTasks(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((task) => ({
    id: normalizeString(task && task.id, 120),
    name: normalizeString(task && task.name, 120),
    profileOrHandle: normalizeString(task && task.profileOrHandle, 500),
    status: PLATFORM_STATUSES.includes(task && task.status) ? task.status : 'not_started',
    outcomeRequested: normalizeString(task && task.outcomeRequested, 60),
    evidenceNeeded: normalizeString(task && task.evidenceNeeded, 500),
    notes: normalizeString(task && task.notes, 2000),
    submissionReference: normalizeString(task && task.submissionReference, 180),
    submittedAt: normalizeString(task && task.submittedAt, 80),
    resolvedAt: normalizeString(task && task.resolvedAt, 80)
  })).filter((task) => task.name);
}

function normalizeReminders(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((reminder) => ({
    id: normalizeString(reminder && reminder.id, 120),
    title: normalizeString(reminder && reminder.title, 180),
    status: REMINDER_STATUSES.includes(reminder && reminder.status) ? reminder.status : 'open',
    severity: REMINDER_SEVERITIES.includes(reminder && reminder.severity) ? reminder.severity : 'normal',
    assignedTo: normalizeString(reminder && reminder.assignedTo, 140),
    ownerLane: normalizeString(reminder && reminder.ownerLane, 80),
    dueDate: normalizeString(reminder && reminder.dueDate, 40),
    escalateAt: normalizeString(reminder && reminder.escalateAt, 40),
    notes: normalizeString(reminder && reminder.notes, 1200),
    completedAt: normalizeString(reminder && reminder.completedAt, 80),
    createdAt: normalizeString(reminder && reminder.createdAt, 80),
    updatedAt: normalizeString(reminder && reminder.updatedAt, 80)
  })).filter((reminder) => reminder.title);
}

function getBaseUrl(req) {
  const protocol = normalizeString(req.headers['x-forwarded-proto'], 20) || 'https';
  const host = normalizeString(req.headers['x-forwarded-host'] || req.headers.host, 240);
  return host ? `${protocol}://${host}` : 'https://www.departed.digital';
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);

  if (!value) {
    return '0 B';
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function buildCaseExportPayload(caseRecord, req) {
  const baseUrl = getBaseUrl(req);
  const workflow = caseRecord.workflow || {};
  const operational = caseRecord.operational || {};
  const documents = Array.isArray(caseRecord.documents) ? caseRecord.documents : [];
  const platformTasks = Array.isArray(caseRecord.platformTasks) ? caseRecord.platformTasks : [];

  return {
    reference: caseRecord.reference,
    caseId: caseRecord.id,
    package: caseRecord.packageLabel,
    status: caseRecord.status,
    paymentStatus: caseRecord.paymentStatus,
    client: {
      name: caseRecord.clientName,
      email: caseRecord.clientEmail,
      relationship: caseRecord.relationshipToDeceased || '',
      authorityBasis: caseRecord.authorityBasis || ''
    },
    deceased: {
      name: caseRecord.deceasedName,
      requestedOutcome: caseRecord.preferredOutcome || '',
      knownPlatforms: caseRecord.knownPlatforms || '',
      profileUrls: caseRecord.profileUrls || ''
    },
    workflow: {
      queue: workflow.queueLabel || '',
      waitingOn: workflow.waitingOn || '',
      nextAction: operational.nextBestAction || '',
      serviceTargetDate: workflow.serviceTargetDate || '',
      followUpDate: workflow.followUpDate || '',
      health: workflow.healthStatus || ''
    },
    platformTasks: platformTasks.map((task) => ({
      name: task.name,
      status: task.status,
      outcomeRequested: task.outcomeRequested || '',
      profileOrHandle: task.profileOrHandle || '',
      evidenceNeeded: task.evidenceNeeded || '',
      submissionReference: task.submissionReference || '',
      notes: task.notes || ''
    })),
    documents: documents.map((document) => ({
      id: document.id,
      fileName: document.fileName,
      documentType: document.documentType,
      contentType: document.contentType,
      sizeBytes: Number(document.size || 0),
      uploadedAt: document.uploadedAt || '',
      downloadUrl: `${baseUrl}/api/admin/cases?id=${encodeURIComponent(caseRecord.id)}&download=${encodeURIComponent(document.id)}`
    })),
    operatorBrief: operational.agentSummary || '',
    platformSubmissionBrief: operational.platformSubmissionBrief || '',
    customerLinks: {
      review: `${baseUrl}${(caseRecord.caseLinks && caseRecord.caseLinks.payment) || ''}`,
      documents: `${baseUrl}${(caseRecord.caseLinks && caseRecord.caseLinks.documents) || ''}`,
      status: `${baseUrl}${(caseRecord.caseLinks && caseRecord.caseLinks.status) || ''}`
    },
    internalNotes: caseRecord.internalNotes || ''
  };
}

function buildCaseExportMarkdown(caseRecord, req) {
  const payload = buildCaseExportPayload(caseRecord, req);
  const platformLines = payload.platformTasks.length
    ? payload.platformTasks.map((task) => `- ${task.name}: ${task.status}${task.profileOrHandle ? ` | ${task.profileOrHandle}` : ''}${task.outcomeRequested ? ` | outcome ${task.outcomeRequested}` : ''}`).join('\n')
    : '- No platform tasks recorded';
  const documentLines = payload.documents.length
    ? payload.documents.map((document) => `- ${document.documentType}: ${document.fileName} (${formatBytes(document.sizeBytes)})\n  Download: ${document.downloadUrl}`).join('\n')
    : '- No supporting documents uploaded';
  const missingLines = Array.isArray(caseRecord.operational && caseRecord.operational.missingItems) && caseRecord.operational.missingItems.length
    ? caseRecord.operational.missingItems.map((item) => `- ${item}`).join('\n')
    : '- No obvious missing items';

  return [
    `# Departed Digital case pack: ${payload.reference}`,
    '',
    '## Case summary',
    `- Package: ${payload.package}`,
    `- Status: ${payload.status}`,
    `- Payment status: ${payload.paymentStatus}`,
    `- Queue: ${payload.workflow.queue}`,
    `- Waiting on: ${payload.workflow.waitingOn}`,
    `- Next action: ${payload.workflow.nextAction}`,
    '',
    '## Client and authority',
    `- Client: ${payload.client.name}`,
    `- Email: ${payload.client.email}`,
    `- Relationship: ${payload.client.relationship || 'Not supplied'}`,
    `- Authority basis: ${payload.client.authorityBasis || 'Not set'}`,
    '',
    '## Deceased and requested outcome',
    `- Deceased: ${payload.deceased.name}`,
    `- Requested outcome: ${payload.deceased.requestedOutcome || 'Not set'}`,
    `- Known platforms: ${payload.deceased.knownPlatforms || 'Not supplied'}`,
    `- Profile URLs: ${payload.deceased.profileUrls || 'Not supplied'}`,
    '',
    '## Platform workflow',
    platformLines,
    '',
    '## Supporting documents',
    documentLines,
    '',
    '## Missing items',
    missingLines,
    '',
    '## Platform submission brief',
    payload.platformSubmissionBrief || 'No platform submission brief available',
    '',
    '## Operator brief',
    payload.operatorBrief || 'No operator brief available'
  ].join('\n');
}

async function buildCaseExportBundle(caseRecord, req) {
  const payload = buildCaseExportPayload(caseRecord, req);
  const zip = new JSZip();
  const root = caseRecord.reference || caseRecord.id || 'case-pack';

  zip.file(`${root}/${root}-case-pack.md`, buildCaseExportMarkdown(caseRecord, req));
  zip.file(`${root}/${root}-case-pack.json`, JSON.stringify(payload, null, 2));

  for (const document of payload.documents) {
    const asset = await getAdminCaseDocumentAsset(caseRecord.id, document.id);

    if (!asset || !asset.buffer) {
      continue;
    }

    zip.file(`${root}/documents/${asset.fileName}`, asset.buffer);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = async function handler(req, res) {
  allowCors(res, req);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    if (req.method === 'GET') {
      const adminCheck = await requireAdminAccess(req, 'dashboard.view');

      if (!adminCheck.ok) {
        sendError(res, adminCheck.statusCode, adminCheck.message);
        return;
      }

      const requestUrl = new URL(req.url, 'http://localhost');
      const caseId = normalizeString(requestUrl.searchParams.get('id'), 80);
      const downloadId = normalizeString(requestUrl.searchParams.get('download'), 120);
      const exportFormat = normalizeString(requestUrl.searchParams.get('export'), 20).toLowerCase();
      const sections = normalizeString(requestUrl.searchParams.get('sections'), 120)
        .split(',')
        .map((value) => normalizeString(value, 40).toLowerCase())
        .filter(Boolean);

      if (caseId && downloadId) {
        const asset = await getAdminCaseDocumentAsset(caseId, downloadId);

        if (!asset) {
          sendError(res, 404, 'Document not found.');
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', asset.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${String(asset.fileName || 'document.bin').replace(/"/g, '')}"`);
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.end(asset.buffer);
        return;
      }

      if (caseId && (exportFormat === 'json' || exportFormat === 'markdown' || exportFormat === 'bundle')) {
        const caseRecord = await getAdminCaseById(caseId, { sections: ['core', 'workflow', 'comms'] });

        if (!caseRecord) {
          sendError(res, 404, 'Case not found.');
          return;
        }

        if (exportFormat === 'bundle') {
          const bundle = await buildCaseExportBundle(caseRecord, req);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', `attachment; filename="${caseRecord.reference}-submission-bundle.zip"`);
          res.setHeader('Cache-Control', 'no-store, max-age=0');
          res.end(bundle);
          return;
        }

        if (exportFormat === 'json') {
          const payload = buildCaseExportPayload(caseRecord, req);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="${caseRecord.reference}-case-pack.json"`);
          res.setHeader('Cache-Control', 'no-store, max-age=0');
          res.end(JSON.stringify(payload, null, 2));
          return;
        }

        const markdown = buildCaseExportMarkdown(caseRecord, req);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${caseRecord.reference}-case-pack.md"`);
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.end(markdown);
        return;
      }

      if (caseId) {
        const caseRecord = await getAdminCaseById(caseId, { sections });

        if (!caseRecord) {
          sendError(res, 404, 'Case not found.');
          return;
        }

        sendJson(res, 200, { ok: true, case: caseRecord });
        return;
      }

      const cases = await listAdminCaseSummaries();
      sendJson(res, 200, { ok: true, cases });
      return;
    }

    if (req.method === 'PATCH') {
      const body = await parseJsonBody(req);
      const action = normalizeString(body.action, 40);
      const caseId = normalizeString(body.id, 80);

      if (!caseId) {
        sendError(res, 400, 'Case id is required.');
        return;
      }

      if (action === 'archive') {
        const adminCheck = await requireAdminAccess(req, 'cases.archive');

        if (!adminCheck.ok) {
          sendError(res, adminCheck.statusCode, adminCheck.message);
          return;
        }

        const archived = await archiveAdminCase(caseId, adminCheck.session.name || adminCheck.session.username, normalizeString(body.archiveReason, 2000));

        if (!archived) {
          sendError(res, 404, 'Case not found.');
          return;
        }

        archived._loadedSections = ['core', 'workflow', 'comms'];
        sendJson(res, 200, { ok: true, case: archived });
        return;
      }

      if (action === 'restore') {
        const adminCheck = await requireAdminAccess(req, 'cases.archive');

        if (!adminCheck.ok) {
          sendError(res, adminCheck.statusCode, adminCheck.message);
          return;
        }

        const restored = await restoreAdminCase(caseId, adminCheck.session.name || adminCheck.session.username);

        if (!restored) {
          sendError(res, 404, 'Case not found.');
          return;
        }

        restored._loadedSections = ['core', 'workflow', 'comms'];
        sendJson(res, 200, { ok: true, case: restored });
        return;
      }

      const adminCheck = await requireAdminAccess(req, 'cases.write');

      if (!adminCheck.ok) {
        sendError(res, adminCheck.statusCode, adminCheck.message);
        return;
      }

      const updated = await updateAdminCase(caseId, {
        selectedPackage: PACKAGE_CONFIG[body.selectedPackage] ? body.selectedPackage : '',
        status: CASE_STATUSES.includes(body.status) ? body.status : '',
        paymentStatus: PAYMENT_STATUSES.includes(body.paymentStatus) ? body.paymentStatus : '',
        authorityBasis: normalizeString(body.authorityBasis, 180),
        relationshipToDeceased: normalizeString(body.relationshipToDeceased, 140),
        referralSource: normalizeString(body.referralSource, 180),
        knownPlatforms: normalizeString(body.knownPlatforms, 1200),
        profileUrls: normalizeString(body.profileUrls, 2000),
        assignedTo: normalizeString(body.assignedTo, 140),
        operatorLane: normalizeString(body.operatorLane, 80),
        priority: CASE_PRIORITIES.includes(body.priority) ? body.priority : '',
        dueDate: normalizeString(body.dueDate, 40),
        nextFollowUpAt: normalizeString(body.nextFollowUpAt, 40),
        blockerReason: normalizeString(body.blockerReason, 2000),
        lastClientUpdateAt: normalizeString(body.lastClientUpdateAt, 80),
        lastOperatorActionAt: normalizeString(body.lastOperatorActionAt, 80),
        referralPartnerType: normalizeString(body.referralPartnerType, 80),
        referralPartnerName: normalizeString(body.referralPartnerName, 180),
        referralPartnerEmail: normalizeString(body.referralPartnerEmail, 180),
        referralPartnerPhone: normalizeString(body.referralPartnerPhone, 80),
        referralFeeStatus: REFERRAL_FEE_STATUSES.includes(body.referralFeeStatus) ? body.referralFeeStatus : '',
        referralNotes: normalizeString(body.referralNotes, 2000),
        ...(Object.prototype.hasOwnProperty.call(body, 'platformTasks')
          ? { platformTasks: normalizePlatformTasks(body.platformTasks) }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(body, 'reminders')
          ? { reminders: normalizeReminders(body.reminders) }
          : {}),
        internalNotes: normalizeString(body.internalNotes, 4000),
        activityEvent: 'admin_case_updated',
        activityMetadata: {
          status: body.status || '',
          paymentStatus: body.paymentStatus || '',
          assignedTo: body.assignedTo || '',
          priority: body.priority || '',
          operatorLane: body.operatorLane || '',
          nextFollowUpAt: body.nextFollowUpAt || ''
        }
      });

      if (!updated) {
        sendError(res, 404, 'Case not found.');
        return;
      }

      updated._loadedSections = ['core', 'workflow', 'comms'];
      sendJson(res, 200, { ok: true, case: updated });
      return;
    }

    if (req.method === 'DELETE') {
      const adminCheck = await requireAdminAccess(req, 'cases.delete');

      if (!adminCheck.ok) {
        sendError(res, adminCheck.statusCode, adminCheck.message);
        return;
      }

      const body = await parseJsonBody(req);
      const caseId = normalizeString(body.id, 80);

      if (!caseId) {
        sendError(res, 400, 'Case id is required.');
        return;
      }

      const deleted = await deleteCase(caseId, adminCheck.session.name || adminCheck.session.username);

      if (!deleted) {
        sendError(res, 404, 'Case not found.');
        return;
      }

      sendJson(res, 200, {
        ok: true,
        deletedCase: deleted
      });
      return;
    }

    methodNotAllowed(res, ['GET', 'PATCH', 'DELETE', 'OPTIONS']);
  } catch (error) {
    sendError(res, 500, 'We could not load the case dashboard.');
  }
};
