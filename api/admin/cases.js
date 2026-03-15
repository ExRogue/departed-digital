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
const {
  archiveAdminCase,
  deleteCase,
  getAdminCaseById,
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
      const sections = normalizeString(requestUrl.searchParams.get('sections'), 120)
        .split(',')
        .map((value) => normalizeString(value, 40).toLowerCase())
        .filter(Boolean);

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
