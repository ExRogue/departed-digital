const {
  CASE_PRIORITIES,
  CASE_STATUSES,
  PACKAGE_CONFIG,
  PAYMENT_STATUSES,
  PLATFORM_STATUSES,
  REFERRAL_FEE_STATUSES
} = require('../_lib/config');
const { allowCors, methodNotAllowed, parseJsonBody, sendError, sendJson } = require('../_lib/http');
const { requireAdminAccess } = require('../_lib/security');
const { listAdminCases, updateAdminCase } = require('../_lib/store');

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

module.exports = async function handler(req, res) {
  allowCors(res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const adminCheck = requireAdminAccess(req);

  if (!adminCheck.ok) {
    sendError(res, adminCheck.statusCode, adminCheck.message);
    return;
  }

  try {
    if (req.method === 'GET') {
      const cases = await listAdminCases();
      sendJson(res, 200, { ok: true, cases });
      return;
    }

    if (req.method === 'PATCH') {
      const body = await parseJsonBody(req);
      const caseId = normalizeString(body.id, 80);

      if (!caseId) {
        sendError(res, 400, 'Case id is required.');
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
        priority: CASE_PRIORITIES.includes(body.priority) ? body.priority : '',
        dueDate: normalizeString(body.dueDate, 40),
        referralPartnerType: normalizeString(body.referralPartnerType, 80),
        referralPartnerName: normalizeString(body.referralPartnerName, 180),
        referralPartnerEmail: normalizeString(body.referralPartnerEmail, 180),
        referralPartnerPhone: normalizeString(body.referralPartnerPhone, 80),
        referralFeeStatus: REFERRAL_FEE_STATUSES.includes(body.referralFeeStatus) ? body.referralFeeStatus : '',
        referralNotes: normalizeString(body.referralNotes, 2000),
        platformTasks: normalizePlatformTasks(body.platformTasks),
        internalNotes: normalizeString(body.internalNotes, 4000),
        activityEvent: 'admin_case_updated',
        activityMetadata: {
          status: body.status || '',
          paymentStatus: body.paymentStatus || '',
          assignedTo: body.assignedTo || '',
          priority: body.priority || ''
        }
      });

      if (!updated) {
        sendError(res, 404, 'Case not found.');
        return;
      }

      sendJson(res, 200, { ok: true, case: updated });
      return;
    }

    methodNotAllowed(res, ['GET', 'PATCH', 'OPTIONS']);
  } catch (error) {
    sendError(res, 500, 'We could not load the case dashboard.');
  }
};
