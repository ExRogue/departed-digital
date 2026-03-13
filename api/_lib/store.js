const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { get, list, put } = require('@vercel/blob');

const {
  CASE_PRIORITIES,
  CASE_STATUSES,
  MAX_ANALYTICS_EVENTS,
  PACKAGE_CONFIG,
  PAYMENT_STATUSES,
  PLATFORM_STATUSES,
  REFERRAL_FEE_STATUSES
} = require('./config');

const DATA_ROOT = process.env.DEPARTED_DATA_ROOT
  ? path.resolve(process.env.DEPARTED_DATA_ROOT)
  : (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN
    ? '/tmp/departed-digital-data'
    : path.join(process.cwd(), 'data'));
const CASES_DIR = path.join(DATA_ROOT, 'cases');
const DOCUMENTS_DIR = path.join(DATA_ROOT, 'documents');
const INDEX_FILE = path.join(DATA_ROOT, 'meta', 'cases-index.json');
const INDEX_BLOB_PATH = 'meta/cases-index.json';
const ANALYTICS_FILE = path.join(DATA_ROOT, 'meta', 'analytics-events.json');
const ANALYTICS_BLOB_PATH = 'meta/analytics-events.json';

class StoreConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreConfigurationError';
  }
}

function getStorageMode() {
  return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'file';
}

function getStorageHealth() {
  const mode = getStorageMode();
  const persistent = mode === 'blob' || !process.env.VERCEL;

  return {
    mode,
    persistent,
    requiresConfiguration: Boolean(process.env.VERCEL && mode !== 'blob')
  };
}

function assertWritableStore() {
  if (process.env.VERCEL && getStorageMode() !== 'blob') {
    throw new StoreConfigurationError('BLOB_READ_WRITE_TOKEN is required on Vercel for durable case and document storage.');
  }
}

function slugifyFileName(fileName) {
  return String(fileName || 'upload.bin')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'upload.bin';
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function trimTo(value, maxLength = 4000) {
  return String(value || '').trim().slice(0, maxLength);
}

function toTitle(value) {
  return trimTo(value, 120)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatList(value) {
  return ensureArray(
    String(value || '')
      .split(/\n|,/)
      .map((entry) => trimTo(entry, 240))
      .filter(Boolean)
  );
}

function makeReference(id, createdAt) {
  const stamp = createdAt.slice(0, 10).replace(/-/g, '');
  return `DD-${stamp}-${id.slice(0, 6).toUpperCase()}`;
}

function slugifyKey(value) {
  return trimTo(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function inferPlatformName(value) {
  const source = trimTo(value, 240).toLowerCase();

  if (!source) {
    return '';
  }

  const platformMatchers = [
    ['Facebook', /facebook/],
    ['Instagram', /instagram/],
    ['TikTok', /tiktok/],
    ['X', /(^|[^a-z])x\.com|twitter/],
    ['LinkedIn', /linkedin/],
    ['YouTube', /youtube/],
    ['Google', /google/],
    ['Gmail', /gmail/],
    ['Apple', /apple|icloud/],
    ['Microsoft', /outlook|hotmail|live\.com|microsoft/],
    ['Snapchat', /snapchat/],
    ['Pinterest', /pinterest/],
    ['Reddit', /reddit/],
    ['PayPal', /paypal/]
  ];

  const matched = platformMatchers.find(([, pattern]) => pattern.test(source));
  return matched ? matched[0] : '';
}

function normalizePlatformTask(input, index = 0, fallbackOutcome = 'not_sure', fallbackTimestamp = new Date().toISOString()) {
  const name = trimTo(input && input.name, 120) || `Platform ${index + 1}`;
  const id = trimTo(input && input.id, 120) || `platform-${slugifyKey(name) || String(index + 1)}-${index + 1}`;

  return {
    id,
    name,
    profileOrHandle: trimTo(input && input.profileOrHandle, 500),
    status: PLATFORM_STATUSES.includes(input && input.status) ? input.status : 'not_started',
    outcomeRequested: trimTo(input && input.outcomeRequested, 60) || fallbackOutcome,
    evidenceNeeded: trimTo(input && input.evidenceNeeded, 500),
    notes: trimTo(input && input.notes, 2000),
    submissionReference: trimTo(input && input.submissionReference, 180),
    submittedAt: trimTo(input && input.submittedAt, 80),
    resolvedAt: trimTo(input && input.resolvedAt, 80),
    lastUpdatedAt: trimTo(input && input.lastUpdatedAt, 80) || fallbackTimestamp
  };
}

function syncPlatformTasks(existingTasks, knownPlatformsValue, profileUrlsValue, preferredOutcome, timestamp) {
  const knownPlatforms = formatList(knownPlatformsValue);
  const profileUrls = formatList(profileUrlsValue);
  const nextTimestamp = timestamp || new Date().toISOString();
  const byName = new Map();
  const urlsByName = new Map();

  for (const task of ensureArray(existingTasks)) {
    if (task && task.name) {
      byName.set(task.name.toLowerCase(), normalizePlatformTask(task, 0, preferredOutcome, nextTimestamp));
    }
  }

  for (const url of profileUrls) {
    const inferredName = inferPlatformName(url);
    if (!inferredName) {
      continue;
    }

    const key = inferredName.toLowerCase();
    const list = urlsByName.get(key) || [];
    list.push(url);
    urlsByName.set(key, list);
  }

  const orderedNames = [];

  for (const name of knownPlatforms) {
    const key = name.toLowerCase();
    if (!orderedNames.includes(key)) {
      orderedNames.push(key);
    }
  }

  for (const [key] of urlsByName.entries()) {
    if (!orderedNames.includes(key)) {
      orderedNames.push(key);
    }
  }

  const tasks = orderedNames.map((key, index) => {
    const existing = byName.get(key);
    const displayName = existing ? existing.name : (knownPlatforms.find((entry) => entry.toLowerCase() === key) || inferPlatformName((urlsByName.get(key) || [])[0]) || `Platform ${index + 1}`);
    const profileOrHandle = existing && existing.profileOrHandle
      ? existing.profileOrHandle
      : (urlsByName.get(key) || []).join('\n');

    return normalizePlatformTask({
      ...existing,
      id: existing && existing.id ? existing.id : `platform-${slugifyKey(displayName) || String(index + 1)}-${index + 1}`,
      name: displayName,
      profileOrHandle
    }, index, preferredOutcome, nextTimestamp);
  });

  const preservedManualTasks = ensureArray(existingTasks)
    .map((task, index) => normalizePlatformTask(task, index, preferredOutcome, nextTimestamp))
    .filter((task) => !orderedNames.includes(task.name.toLowerCase()));

  return [...tasks, ...preservedManualTasks];
}

function buildStatusTimeline(caseRecord) {
  const timeline = [
    {
      key: 'case_created',
      label: 'Case received',
      description: 'We created the case record and captured the first details.',
      completed: true,
      completedAt: caseRecord.createdAt
    },
    {
      key: 'payment',
      label: 'Payment step',
      description: 'The package and payment step is completed before sensitive document requests.',
      completed: caseRecord.paymentStatus === 'paid',
      completedAt: caseRecord.paymentStatus === 'paid' ? caseRecord.updatedAt : ''
    },
    {
      key: 'documents',
      label: 'Documents reviewed',
      description: 'We request and review the death certificate and authority documents.',
      completed: ensureArray(caseRecord.documents).length > 0,
      completedAt: ensureArray(caseRecord.documents).length ? caseRecord.updatedAt : ''
    },
    {
      key: 'submissions',
      label: 'Platform submissions',
      description: 'We begin the removal or memorialisation submissions for the listed platforms.',
      completed: ['active', 'submitted', 'completed'].includes(caseRecord.status),
      completedAt: ['active', 'submitted', 'completed'].includes(caseRecord.status) ? caseRecord.updatedAt : ''
    },
    {
      key: 'completion',
      label: 'Written completion record',
      description: 'We send the written record once the case is complete.',
      completed: caseRecord.status === 'completed',
      completedAt: caseRecord.status === 'completed' ? caseRecord.updatedAt : ''
    }
  ];

  return timeline;
}

function dateOnlyFrom(value) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function addDays(value, days) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return dateOnlyFrom(date);
}

function isPastDate(value) {
  if (!value) {
    return false;
  }

  const target = new Date(value + 'T00:00:00.000Z');
  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  return target.getTime() < todayUtc.getTime();
}

function buildWorkflowKit(caseRecord) {
  const packageConfig = PACKAGE_CONFIG[caseRecord.selectedPackage] || PACKAGE_CONFIG.standard;
  const targetDate = caseRecord.dueDate || addDays(caseRecord.createdAt, packageConfig.targetDays || 10);
  const documentCount = ensureArray(caseRecord.documents).length;
  const platformTasks = ensureArray(caseRecord.platformTasks).map((task, index) => normalizePlatformTask(task, index, caseRecord.preferredOutcome, caseRecord.updatedAt || caseRecord.createdAt));
  const blockedTasks = platformTasks.filter((task) => task.status === 'blocked');
  const pendingSubmissionTasks = platformTasks.filter((task) => task.status === 'not_started' || task.status === 'queued');
  const inFlightTasks = platformTasks.filter((task) => task.status === 'submitted' || task.status === 'waiting');
  const resolvedTasks = platformTasks.filter((task) => task.status === 'resolved');
  const isCompleted = caseRecord.status === 'completed';
  const isBlocked = caseRecord.status === 'blocked' || blockedTasks.length > 0;
  const overdue = !isCompleted && isPastDate(targetDate);
  let queueKey = 'intake_queue';
  let queueLabel = 'Intake queue';
  let waitingOn = 'operator';
  let stageKey = 'intake';
  let stageLabel = 'Intake review';
  let recommendedLane = 'intake_desk';
  let followUpDate = caseRecord.nextFollowUpAt || '';

  if (caseRecord.paymentStatus === 'pending' || caseRecord.paymentStatus === 'payment_link_sent') {
    queueKey = 'payment_follow_up';
    queueLabel = 'Payment follow-up';
    waitingOn = 'client_payment';
    stageKey = 'payment';
    stageLabel = 'Payment handoff';
    recommendedLane = caseRecord.selectedPackage === 'estate' || caseRecord.priority === 'urgent'
      ? 'founder_review'
      : 'intake_desk';
    followUpDate = followUpDate || addDays(caseRecord.updatedAt || caseRecord.createdAt, caseRecord.paymentStatus === 'payment_link_sent' ? 2 : 1);
  } else if (caseRecord.paymentStatus === 'paid' && documentCount === 0) {
    queueKey = 'document_chase';
    queueLabel = 'Document chase';
    waitingOn = 'client_documents';
    stageKey = 'document_collection';
    stageLabel = 'Collect supporting documents';
    recommendedLane = 'document_desk';
    followUpDate = followUpDate || addDays(caseRecord.updatedAt || caseRecord.createdAt, 2);
  } else if (documentCount > 0 && (caseRecord.status === 'documents_received' || caseRecord.status === 'awaiting_documents')) {
    queueKey = 'document_review';
    queueLabel = 'Document review';
    waitingOn = 'operator';
    stageKey = 'document_review';
    stageLabel = 'Review uploaded documents';
    recommendedLane = 'document_desk';
    followUpDate = followUpDate || dateOnlyFrom(new Date());
  } else if (pendingSubmissionTasks.length && ['active', 'submitted', 'paid', 'documents_received'].includes(caseRecord.status)) {
    queueKey = 'submission_queue';
    queueLabel = 'Ready for submission';
    waitingOn = 'operator';
    stageKey = 'submission';
    stageLabel = 'Prepare platform submissions';
    recommendedLane = 'platform_desk';
    followUpDate = followUpDate || dateOnlyFrom(new Date());
  } else if (inFlightTasks.length || caseRecord.status === 'submitted') {
    queueKey = 'platform_waiting';
    queueLabel = 'Platform waiting';
    waitingOn = 'platform_response';
    stageKey = 'platform_waiting';
    stageLabel = 'Waiting on platform responses';
    recommendedLane = 'platform_desk';
    followUpDate = followUpDate || addDays(caseRecord.updatedAt || caseRecord.createdAt, 2);
  } else if (isCompleted) {
    queueKey = 'completion';
    queueLabel = 'Completion';
    waitingOn = 'none';
    stageKey = 'completion';
    stageLabel = 'Completion and archive';
    recommendedLane = 'completion_desk';
    followUpDate = '';
  }

  if (isBlocked) {
    queueKey = 'blocked';
    queueLabel = 'Blocked cases';
    waitingOn = caseRecord.blockerReason ? 'resolved_blocker' : 'operator';
    stageKey = 'blocked';
    stageLabel = 'Resolve blocker';
    recommendedLane = 'founder_review';
    followUpDate = followUpDate || dateOnlyFrom(new Date());
  }

  if (caseRecord.referralPartnerType === 'funeral_director' && !isCompleted && !isBlocked && queueKey === 'completion') {
    recommendedLane = 'partner_desk';
  }

  const followUpOverdue = Boolean(followUpDate && isPastDate(followUpDate));
  const needsAttention = Boolean(
    overdue
    || isBlocked
    || !caseRecord.assignedTo
    || followUpOverdue
    || (caseRecord.paymentStatus === 'payment_link_sent')
    || (caseRecord.paymentStatus === 'paid' && documentCount === 0)
  );

  const healthStatus = isCompleted
    ? 'complete'
    : (isBlocked || overdue ? 'critical' : (needsAttention ? 'attention' : 'on_track'));

  const progressPercent = isCompleted
    ? 100
    : Math.min(95, Math.round((((resolvedTasks.length * 2) + (documentCount ? 1 : 0) + (caseRecord.paymentStatus === 'paid' ? 1 : 0)) / Math.max((platformTasks.length * 2) + 2, 4)) * 100));

  const automationTasks = [];

  if (!caseRecord.assignedTo) {
    automationTasks.push({
      key: 'assign_owner',
      label: 'Assign a case owner',
      state: 'open',
      dueDate: dateOnlyFrom(new Date()),
      ownerLane: recommendedLane,
      reason: 'Unassigned cases are harder to progress consistently.'
    });
  }

  if (!caseRecord.dueDate) {
    automationTasks.push({
      key: 'set_due_date',
      label: 'Confirm the service target date',
      state: 'open',
      dueDate: targetDate,
      ownerLane: recommendedLane,
      reason: packageConfig.turnaroundLabel + ' should be reflected in the case record.'
    });
  }

  if (caseRecord.paymentStatus === 'payment_link_sent') {
    automationTasks.push({
      key: 'payment_follow_up',
      label: 'Follow up on the payment link',
      state: 'open',
      dueDate: followUpDate,
      ownerLane: 'intake_desk',
      reason: 'The payment link has been sent and needs a follow-up check.'
    });
  }

  if (caseRecord.paymentStatus === 'paid' && documentCount === 0) {
    automationTasks.push({
      key: 'request_documents',
      label: 'Request supporting documents',
      state: 'open',
      dueDate: followUpDate,
      ownerLane: 'document_desk',
      reason: 'Payment is confirmed but the death certificate and authority proof are still missing.'
    });
  }

  if (documentCount > 0 && (caseRecord.status === 'documents_received' || caseRecord.status === 'awaiting_documents')) {
    automationTasks.push({
      key: 'review_documents',
      label: 'Review uploaded documents',
      state: 'open',
      dueDate: followUpDate || dateOnlyFrom(new Date()),
      ownerLane: 'document_desk',
      reason: 'Documents are in the file and ready for review.'
    });
  }

  if (pendingSubmissionTasks.length) {
    automationTasks.push({
      key: 'submit_next_platform',
      label: 'Submit the next platform request',
      state: 'open',
      dueDate: followUpDate || dateOnlyFrom(new Date()),
      ownerLane: 'platform_desk',
      reason: `${pendingSubmissionTasks[0].name} is ready to move from queued into submission.`
    });
  }

  if (blockedTasks.length) {
    automationTasks.push({
      key: 'clear_blocker',
      label: 'Clear the active blocker',
      state: 'open',
      dueDate: followUpDate || dateOnlyFrom(new Date()),
      ownerLane: 'founder_review',
      reason: `${blockedTasks[0].name} is blocked and needs intervention before the case can progress.`
    });
  }

  if (isCompleted && caseRecord.referralPartnerType === 'funeral_director' && ['pending', 'approved'].includes(caseRecord.referralFeeStatus)) {
    automationTasks.push({
      key: 'partner_payout',
      label: 'Review funeral director referral payout',
      state: 'open',
      dueDate: addDays(caseRecord.updatedAt || caseRecord.createdAt, 7),
      ownerLane: 'partner_desk',
      reason: 'The case is complete and the partner fee workflow should be closed out.'
    });
  }

  return {
    stageKey,
    stageLabel,
    queueKey,
    queueLabel,
    waitingOn,
    recommendedLane,
    serviceTargetDate: targetDate,
    followUpDate,
    overdue,
    followUpOverdue,
    needsAttention,
    healthStatus,
    progressPercent,
    automationTasks
  };
}

function normalizeCaseSummary(caseRecord) {
  const platformTasks = ensureArray(caseRecord.platformTasks);

  return {
    id: caseRecord.id,
    reference: caseRecord.reference,
    clientName: caseRecord.clientName,
    clientEmail: caseRecord.clientEmail,
    deceasedName: caseRecord.deceasedName,
    selectedPackage: caseRecord.selectedPackage,
    packageLabel: caseRecord.packageLabel,
    relationshipToDeceased: caseRecord.relationshipToDeceased || '',
    assignedTo: caseRecord.assignedTo || '',
    priority: caseRecord.priority || 'standard',
    dueDate: caseRecord.dueDate || '',
    referralPartnerName: caseRecord.referralPartnerName || '',
    referralFeeStatus: caseRecord.referralFeeStatus || 'not_applicable',
    status: caseRecord.status,
    paymentStatus: caseRecord.paymentStatus,
    platformCount: platformTasks.length,
    resolvedPlatformCount: platformTasks.filter((task) => task.status === 'resolved').length,
    documentCount: ensureArray(caseRecord.documents).length,
    createdAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt
  };
}

function buildPublicCase(caseRecord) {
  const operational = buildOperationalKit(caseRecord);
  const workflow = buildWorkflowKit(caseRecord);
  const platformTasks = ensureArray(caseRecord.platformTasks);

  return {
    id: caseRecord.id,
    reference: caseRecord.reference,
    clientName: caseRecord.clientName,
    clientEmail: caseRecord.clientEmail,
    deceasedName: caseRecord.deceasedName,
    preferredOutcome: caseRecord.preferredOutcome,
    caseDetails: caseRecord.caseDetails,
    relationshipToDeceased: caseRecord.relationshipToDeceased || '',
    knownPlatforms: caseRecord.knownPlatforms || '',
    profileUrls: caseRecord.profileUrls || '',
    urgency: caseRecord.urgency || 'standard',
    selectedPackage: caseRecord.selectedPackage,
    packageLabel: caseRecord.packageLabel,
    status: caseRecord.status,
    paymentStatus: caseRecord.paymentStatus,
    priority: caseRecord.priority || 'standard',
    authorityBasis: caseRecord.authorityBasis || '',
    documentNotes: caseRecord.documentNotes || '',
    platformTasks: platformTasks.map((task) => ({
      id: task.id,
      name: task.name,
      profileOrHandle: task.profileOrHandle || '',
      status: task.status,
      outcomeRequested: task.outcomeRequested || '',
      evidenceNeeded: task.evidenceNeeded || ''
    })),
    documents: ensureArray(caseRecord.documents).map((document) => ({
      id: document.id,
      fileName: document.fileName,
      documentType: document.documentType,
      size: document.size,
      uploadedAt: document.uploadedAt
    })),
    statusTimeline: buildStatusTimeline(caseRecord),
    operational,
    workflow: {
      stageLabel: workflow.stageLabel,
      queueLabel: workflow.queueLabel,
      waitingOn: workflow.waitingOn,
      serviceTargetDate: workflow.serviceTargetDate,
      progressPercent: workflow.progressPercent
    },
    createdAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt
  };
}

function buildAdminCase(caseRecord) {
  const workflow = buildWorkflowKit(caseRecord);

  return {
    ...buildPublicCase(caseRecord),
    workflow,
    publicToken: caseRecord.publicToken,
    caseLinks: {
      payment: `/payment?case=${caseRecord.id}&token=${caseRecord.publicToken}&package=${caseRecord.selectedPackage}`,
      documents: `/documents?case=${caseRecord.id}&token=${caseRecord.publicToken}`,
      status: `/case?case=${caseRecord.id}&token=${caseRecord.publicToken}`
    },
    intakeSource: caseRecord.intakeSource,
    referralSource: caseRecord.referralSource,
    assignedTo: caseRecord.assignedTo || '',
    priority: caseRecord.priority || 'standard',
    dueDate: caseRecord.dueDate || '',
    referralPartnerType: caseRecord.referralPartnerType || 'direct',
    referralPartnerName: caseRecord.referralPartnerName || '',
    referralPartnerEmail: caseRecord.referralPartnerEmail || '',
    referralPartnerPhone: caseRecord.referralPartnerPhone || '',
    referralFeeStatus: caseRecord.referralFeeStatus || 'not_applicable',
    referralNotes: caseRecord.referralNotes || '',
    operatorLane: caseRecord.operatorLane || '',
    nextFollowUpAt: caseRecord.nextFollowUpAt || '',
    blockerReason: caseRecord.blockerReason || '',
    lastClientUpdateAt: caseRecord.lastClientUpdateAt || '',
    lastOperatorActionAt: caseRecord.lastOperatorActionAt || '',
    platformTasks: ensureArray(caseRecord.platformTasks),
    internalNotes: caseRecord.internalNotes || '',
    activity: ensureArray(caseRecord.activity)
  };
}

function buildOperationalKit(caseRecord) {
  const knownPlatforms = formatList(caseRecord.knownPlatforms);
  const profileUrls = formatList(caseRecord.profileUrls);
  const platformTasks = ensureArray(caseRecord.platformTasks).map((task, index) => normalizePlatformTask(task, index, caseRecord.preferredOutcome, caseRecord.updatedAt || caseRecord.createdAt));
  const workflow = buildWorkflowKit(caseRecord);
  const documentCount = ensureArray(caseRecord.documents).length;
  const activePlatformTasks = platformTasks.filter((task) => task.status !== 'resolved');
  const blockedPlatformTasks = platformTasks.filter((task) => task.status === 'blocked');
  const resolvedPlatformTasks = platformTasks.filter((task) => task.status === 'resolved');
  const missingItems = [];

  if (!caseRecord.relationshipToDeceased) {
    missingItems.push('Relationship to the deceased is still missing.');
  }

  if (!knownPlatforms.length) {
    missingItems.push('Known platforms have not been listed yet.');
  }

  if (!profileUrls.length) {
    missingItems.push('No profile URLs or handles have been captured yet.');
  }

  if (!caseRecord.authorityBasis && documentCount === 0) {
    missingItems.push('Authority basis and documents still need to be collected.');
  }

  if (!caseRecord.assignedTo) {
    missingItems.push('No case owner has been assigned yet.');
  }

  if (!caseRecord.dueDate) {
    missingItems.push('A due date has not been set yet.');
  }

  if (!platformTasks.length) {
    missingItems.push('No platform workflow has been created yet.');
  }

  if (caseRecord.referralPartnerType === 'funeral_director' && !caseRecord.referralPartnerName) {
    missingItems.push('Funeral director referral details are still missing.');
  }

  let nextBestAction = 'Review the case and decide the next operational step.';

  if (caseRecord.status === 'awaiting_payment' || caseRecord.paymentStatus === 'pending') {
    nextBestAction = 'Send or confirm the correct payment link, then wait for payment before requesting sensitive documents.';
  } else if (caseRecord.paymentStatus === 'payment_link_sent') {
    nextBestAction = 'Follow up on payment and keep the case warm with a short reassurance note.';
  } else if (caseRecord.paymentStatus === 'paid' && documentCount === 0) {
    nextBestAction = 'Request the death certificate and proof of authority using the secure document step.';
  } else if (documentCount > 0 && (caseRecord.status === 'documents_received' || caseRecord.status === 'awaiting_documents')) {
    nextBestAction = 'Review the uploaded documents, confirm they are sufficient, and prepare the first platform submissions.';
  } else if (caseRecord.status === 'active') {
    nextBestAction = 'Submit to the listed platforms, log outcomes, and send a short progress update to the client.';
  } else if (caseRecord.status === 'submitted') {
    nextBestAction = 'Monitor platform responses, chase anything outstanding, and prepare the completion summary.';
  } else if (caseRecord.status === 'completed') {
    nextBestAction = 'Send the written completion record and close out any referral or archive tasks.';
  } else if (caseRecord.status === 'blocked') {
    nextBestAction = 'Resolve the blocker, request the missing information, and note the issue clearly for the next operator.';
  }

  if (platformTasks.length && caseRecord.paymentStatus === 'paid' && documentCount > 0) {
    const nextPendingPlatform = activePlatformTasks.find((task) => task.status === 'not_started' || task.status === 'queued');
    if (nextPendingPlatform) {
      nextBestAction = `Prepare and submit the ${nextPendingPlatform.name} request next, then log the submission reference.`;
    }
  }

  if (blockedPlatformTasks.length) {
    nextBestAction = `Resolve the blocker on ${blockedPlatformTasks[0].name}, then continue the remaining platform submissions.`;
  }

  const agentChecklist = [
    `Case reference: ${caseRecord.reference}`,
    `Selected package: ${caseRecord.packageLabel}`,
    `Preferred outcome: ${toTitle(caseRecord.preferredOutcome || 'not_sure')}`,
    `Priority: ${toTitle(caseRecord.priority || 'standard')}`,
    `Assigned to: ${caseRecord.assignedTo || 'Unassigned'}`,
    `Due date: ${caseRecord.dueDate || 'Not set'}`,
    knownPlatforms.length ? `Known platforms: ${knownPlatforms.join(', ')}` : 'Known platforms still need to be confirmed.',
    profileUrls.length ? `Known profiles/handles: ${profileUrls.join(', ')}` : 'No profile URLs or handles are recorded yet.',
    platformTasks.length
      ? `Platform workflow: ${platformTasks.map((task) => `${task.name} (${toTitle(task.status)})`).join(', ')}`
      : 'Platform workflow has not been created yet.',
    `Next best action: ${nextBestAction}`
  ];

  const agentSummary = [
    `Departed Digital case ${caseRecord.reference}.`,
    `Client: ${caseRecord.clientName} (${caseRecord.clientEmail}).`,
    `Deceased: ${caseRecord.deceasedName}.`,
    `Relationship: ${caseRecord.relationshipToDeceased || 'Not supplied yet'}.`,
    `Package: ${caseRecord.packageLabel}.`,
    `Priority: ${toTitle(caseRecord.priority || 'standard')}.`,
    `Assigned owner: ${caseRecord.assignedTo || 'Not assigned yet'}.`,
    caseRecord.dueDate ? `Due date: ${caseRecord.dueDate}.` : '',
    `Workflow queue: ${toTitle(workflow.queueLabel)}.`,
    workflow.followUpDate ? `Follow-up due: ${workflow.followUpDate}.` : '',
    `Outcome requested: ${toTitle(caseRecord.preferredOutcome || 'not_sure')}.`,
    knownPlatforms.length ? `Platforms: ${knownPlatforms.join(', ')}.` : 'Platforms: still to be confirmed.',
    profileUrls.length ? `Profiles or handles: ${profileUrls.join(', ')}.` : 'Profiles or handles: not yet supplied.',
    platformTasks.length ? `Platform statuses: ${platformTasks.map((task) => `${task.name} ${toTitle(task.status)}`).join(', ')}.` : '',
    caseRecord.caseDetails ? `Case details: ${caseRecord.caseDetails}.` : '',
    `Current status: ${toTitle(caseRecord.status)} with payment ${toTitle(caseRecord.paymentStatus)}.`,
    `Next best action: ${nextBestAction}`
  ].filter(Boolean).join(' ');

  const clientUpdateDraft = [
    `Subject: Update on case ${caseRecord.reference}`,
    '',
    `Hi ${caseRecord.clientName || 'there'},`,
    '',
    `This is a quick update on the Departed Digital case for ${caseRecord.deceasedName}.`,
    '',
    `Current status: ${toTitle(caseRecord.status)}.`,
    `Current payment status: ${toTitle(caseRecord.paymentStatus)}.`,
    platformTasks.length ? `Platforms in scope: ${platformTasks.map((task) => `${task.name} (${toTitle(task.status)})`).join(', ')}.` : '',
    '',
    nextBestAction,
    workflow.followUpDate ? `Next review date: ${workflow.followUpDate}.` : '',
    '',
    'We will keep the record updated and confirm the next step as soon as anything changes.',
    '',
    'Departed Digital'
  ].join('\n');

  const platformSubmissionBrief = [
    `Departed Digital reference: ${caseRecord.reference}`,
    `Requester name: ${caseRecord.clientName}`,
    `Requester email: ${caseRecord.clientEmail}`,
    `Relationship or authority: ${caseRecord.authorityBasis || caseRecord.relationshipToDeceased || 'To be confirmed'}`,
    `Deceased person: ${caseRecord.deceasedName}`,
    `Requested outcome: ${toTitle(caseRecord.preferredOutcome || 'not_sure')}`,
    knownPlatforms.length ? `Known platforms: ${knownPlatforms.join(', ')}` : 'Known platforms: not yet recorded',
    profileUrls.length ? `Profile URLs or handles: ${profileUrls.join(', ')}` : 'Profile URLs or handles: not yet recorded',
    platformTasks.length ? `Platform workflow: ${platformTasks.map((task) => `${task.name} | ${toTitle(task.status)} | ${task.profileOrHandle || 'No URL captured'}`).join('\n')}` : 'Platform workflow: not yet created',
    caseRecord.caseDetails ? `Case notes: ${caseRecord.caseDetails}` : 'Case notes: none recorded yet',
    `Supporting documents received: ${documentCount}`
  ].join('\n');

  return {
    nextBestAction,
    missingItems,
    knownPlatformsList: knownPlatforms,
    profileUrlsList: profileUrls,
    platformSummary: {
      total: platformTasks.length,
      active: activePlatformTasks.length,
      resolved: resolvedPlatformTasks.length,
      blocked: blockedPlatformTasks.length
    },
    workflow,
    agentChecklist,
    agentSummary,
    clientUpdateDraft,
    platformSubmissionBrief
  };
}

async function ensureLocalDirs() {
  await fs.mkdir(path.dirname(INDEX_FILE), { recursive: true });
  await fs.mkdir(CASES_DIR, { recursive: true });
  await fs.mkdir(DOCUMENTS_DIR, { recursive: true });
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }

    throw error;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

async function readBlobJson(blobPath, fallback) {
  let response;

  try {
    response = await get(blobPath, { access: 'private' });
  } catch (error) {
    const isMissingBlob = error
      && (error.status === 404
        || error.code === 'not_found'
        || error.name === 'BlobNotFoundError'
        || /not found/i.test(String(error.message || '')));

    if (isMissingBlob) {
      return fallback;
    }

    throw error;
  }

  if (!response) {
    return fallback;
  }

  const raw = await new Response(response.stream).text();
  return JSON.parse(raw);
}

async function writeBlobJson(blobPath, value) {
  await put(blobPath, JSON.stringify(value, null, 2), {
    access: 'private',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'application/json; charset=utf-8'
  });
}

async function readIndex() {
  if (getStorageMode() === 'blob') {
    return readBlobJson(INDEX_BLOB_PATH, []);
  }

  await ensureLocalDirs();
  return readJsonFile(INDEX_FILE, []);
}

async function writeIndex(index) {
  if (getStorageMode() === 'blob') {
    return writeBlobJson(INDEX_BLOB_PATH, index);
  }

  await ensureLocalDirs();
  return writeJsonFile(INDEX_FILE, index);
}

async function readAnalyticsEvents() {
  if (getStorageMode() === 'blob') {
    return readBlobJson(ANALYTICS_BLOB_PATH, []);
  }

  await ensureLocalDirs();
  return readJsonFile(ANALYTICS_FILE, []);
}

async function writeAnalyticsEvents(events) {
  const limitedEvents = events
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, MAX_ANALYTICS_EVENTS);

  if (getStorageMode() === 'blob') {
    return writeBlobJson(ANALYTICS_BLOB_PATH, limitedEvents);
  }

  await ensureLocalDirs();
  return writeJsonFile(ANALYTICS_FILE, limitedEvents);
}

function getCaseBlobPath(caseId) {
  return `cases/${caseId}.json`;
}

function getCaseFilePath(caseId) {
  return path.join(CASES_DIR, `${caseId}.json`);
}

async function readCase(caseId) {
  if (getStorageMode() === 'blob') {
    return readBlobJson(getCaseBlobPath(caseId), null);
  }

  await ensureLocalDirs();
  return readJsonFile(getCaseFilePath(caseId), null);
}

async function writeCase(caseRecord) {
  const summary = normalizeCaseSummary(caseRecord);
  const index = await readIndex();
  const existingIndex = index.findIndex((entry) => entry.id === caseRecord.id);

  if (getStorageMode() === 'blob') {
    await writeBlobJson(getCaseBlobPath(caseRecord.id), caseRecord);
  } else {
    await ensureLocalDirs();
    await writeJsonFile(getCaseFilePath(caseRecord.id), caseRecord);
  }

  if (existingIndex >= 0) {
    index[existingIndex] = summary;
  } else {
    index.unshift(summary);
  }

  index.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  await writeIndex(index);
}

function createActivityEntry(eventType, metadata = {}, actor = 'system') {
  return {
    id: crypto.randomUUID(),
    eventType,
    actor,
    metadata,
    createdAt: new Date().toISOString()
  };
}

async function createCase(input) {
  assertWritableStore();

  const createdAt = new Date().toISOString();
  const id = crypto.randomUUID();
  const selectedPackage = PACKAGE_CONFIG[input.selectedPackage] ? input.selectedPackage : 'standard';
  const packageLabel = PACKAGE_CONFIG[selectedPackage].label;
  const platformTasks = syncPlatformTasks([], input.knownPlatforms || '', input.profileUrls || '', input.preferredOutcome || 'not_sure', createdAt);

  const caseRecord = {
    id,
    reference: makeReference(id, createdAt),
    publicToken: crypto.randomBytes(24).toString('hex'),
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    deceasedName: input.deceasedName,
    preferredOutcome: input.preferredOutcome || 'not_sure',
    caseDetails: input.caseDetails || '',
    relationshipToDeceased: input.relationshipToDeceased || '',
    knownPlatforms: input.knownPlatforms || '',
    profileUrls: input.profileUrls || '',
    urgency: input.urgency || 'standard',
    selectedPackage,
    packageLabel,
    status: 'awaiting_payment',
    paymentStatus: 'pending',
    assignedTo: '',
    priority: CASE_PRIORITIES.includes(input.priority) ? input.priority : 'standard',
    dueDate: trimTo(input.dueDate, 40),
    intakeSource: input.intakeSource || 'website',
    referralSource: input.referralSource || '',
    referralPartnerType: trimTo(input.referralPartnerType, 80) || 'direct',
    referralPartnerName: trimTo(input.referralPartnerName, 180),
    referralPartnerEmail: trimTo(input.referralPartnerEmail, 180),
    referralPartnerPhone: trimTo(input.referralPartnerPhone, 80),
    referralFeeStatus: REFERRAL_FEE_STATUSES.includes(input.referralFeeStatus) ? input.referralFeeStatus : 'not_applicable',
    referralNotes: trimTo(input.referralNotes, 2000),
    operatorLane: '',
    nextFollowUpAt: '',
    blockerReason: '',
    lastClientUpdateAt: createdAt,
    lastOperatorActionAt: '',
    authorityBasis: '',
    documentNotes: '',
    platformTasks,
    documents: [],
    internalNotes: '',
    activity: [
      createActivityEntry('case_created', {
        selectedPackage,
        intakeSource: input.intakeSource || 'website',
        platformCount: platformTasks.length
      }, 'public')
    ],
    createdAt,
    updatedAt: createdAt
  };

  await writeCase(caseRecord);
  return caseRecord;
}

async function getCaseForPublic(id, publicToken) {
  const caseRecord = await readCase(id);

  if (!caseRecord || caseRecord.publicToken !== publicToken) {
    return null;
  }

  return caseRecord;
}

async function getCaseForAdmin(id) {
  return readCase(id);
}

async function listAdminCases() {
  const index = await readIndex();
  const cases = [];

  for (const entry of index) {
    const caseRecord = await readCase(entry.id);
    if (caseRecord) {
      cases.push(buildAdminCase(caseRecord));
    }
  }

  return cases.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

async function updateCase(id, updater) {
  const caseRecord = await readCase(id);

  if (!caseRecord) {
    return null;
  }

  const nextCase = await updater(caseRecord);
  nextCase.updatedAt = new Date().toISOString();
  await writeCase(nextCase);
  return nextCase;
}

async function updatePublicCase(id, publicToken, updates) {
  return updateCase(id, async (caseRecord) => {
    if (caseRecord.publicToken !== publicToken) {
      return caseRecord;
    }

    const updateStamp = new Date().toISOString();

    if (updates.selectedPackage && PACKAGE_CONFIG[updates.selectedPackage]) {
      caseRecord.selectedPackage = updates.selectedPackage;
      caseRecord.packageLabel = PACKAGE_CONFIG[updates.selectedPackage].label;
    }

    if (typeof updates.relationshipToDeceased === 'string') {
      caseRecord.relationshipToDeceased = trimTo(updates.relationshipToDeceased, 140);
    }

    if (typeof updates.referralSource === 'string') {
      caseRecord.referralSource = trimTo(updates.referralSource, 180);
    }

    if (typeof updates.knownPlatforms === 'string') {
      caseRecord.knownPlatforms = trimTo(updates.knownPlatforms, 1200);
    }

    if (typeof updates.profileUrls === 'string') {
      caseRecord.profileUrls = trimTo(updates.profileUrls, 2000);
    }

    if (typeof updates.knownPlatforms === 'string' || typeof updates.profileUrls === 'string') {
      caseRecord.platformTasks = syncPlatformTasks(
        caseRecord.platformTasks,
        caseRecord.knownPlatforms,
        caseRecord.profileUrls,
        caseRecord.preferredOutcome,
        new Date().toISOString()
      );
    }

    if (updates.paymentStatus && PAYMENT_STATUSES.includes(updates.paymentStatus)) {
      caseRecord.paymentStatus = updates.paymentStatus;
    }

    if (updates.status && CASE_STATUSES.includes(updates.status)) {
      caseRecord.status = updates.status;
    }

    if (updates.activityEvent) {
      caseRecord.activity.unshift(createActivityEntry(updates.activityEvent, updates.activityMetadata, 'public'));
    }

    caseRecord.lastClientUpdateAt = updateStamp;

    return caseRecord;
  });
}

async function updateAdminCase(id, updates) {
  return updateCase(id, async (caseRecord) => {
    const updateStamp = new Date().toISOString();

    if (updates.selectedPackage && PACKAGE_CONFIG[updates.selectedPackage]) {
      caseRecord.selectedPackage = updates.selectedPackage;
      caseRecord.packageLabel = PACKAGE_CONFIG[updates.selectedPackage].label;
    }

    if (updates.status && CASE_STATUSES.includes(updates.status)) {
      caseRecord.status = updates.status;
    }

    if (updates.paymentStatus && PAYMENT_STATUSES.includes(updates.paymentStatus)) {
      caseRecord.paymentStatus = updates.paymentStatus;
    }

    if (typeof updates.internalNotes === 'string') {
      caseRecord.internalNotes = updates.internalNotes.trim();
    }

    if (typeof updates.authorityBasis === 'string') {
      caseRecord.authorityBasis = updates.authorityBasis.trim();
    }

    if (typeof updates.relationshipToDeceased === 'string') {
      caseRecord.relationshipToDeceased = trimTo(updates.relationshipToDeceased, 140);
    }

    if (typeof updates.knownPlatforms === 'string') {
      caseRecord.knownPlatforms = trimTo(updates.knownPlatforms, 1200);
    }

    if (typeof updates.profileUrls === 'string') {
      caseRecord.profileUrls = trimTo(updates.profileUrls, 2000);
    }

    if (typeof updates.assignedTo === 'string') {
      caseRecord.assignedTo = trimTo(updates.assignedTo, 140);
    }

    if (typeof updates.operatorLane === 'string') {
      caseRecord.operatorLane = trimTo(updates.operatorLane, 80);
    }

    if (updates.priority && CASE_PRIORITIES.includes(updates.priority)) {
      caseRecord.priority = updates.priority;
    }

    if (typeof updates.dueDate === 'string') {
      caseRecord.dueDate = trimTo(updates.dueDate, 40);
    }

    if (typeof updates.nextFollowUpAt === 'string') {
      caseRecord.nextFollowUpAt = trimTo(updates.nextFollowUpAt, 40);
    }

    if (typeof updates.blockerReason === 'string') {
      caseRecord.blockerReason = trimTo(updates.blockerReason, 2000);
    }

    if (typeof updates.lastClientUpdateAt === 'string') {
      caseRecord.lastClientUpdateAt = trimTo(updates.lastClientUpdateAt, 80);
    }

    if (typeof updates.lastOperatorActionAt === 'string') {
      caseRecord.lastOperatorActionAt = trimTo(updates.lastOperatorActionAt, 80);
    }

    if (typeof updates.referralPartnerType === 'string') {
      caseRecord.referralPartnerType = trimTo(updates.referralPartnerType, 80) || caseRecord.referralPartnerType || 'direct';
    }

    if (typeof updates.referralPartnerName === 'string') {
      caseRecord.referralPartnerName = trimTo(updates.referralPartnerName, 180);
    }

    if (typeof updates.referralPartnerEmail === 'string') {
      caseRecord.referralPartnerEmail = trimTo(updates.referralPartnerEmail, 180);
    }

    if (typeof updates.referralPartnerPhone === 'string') {
      caseRecord.referralPartnerPhone = trimTo(updates.referralPartnerPhone, 80);
    }

    if (updates.referralFeeStatus && REFERRAL_FEE_STATUSES.includes(updates.referralFeeStatus)) {
      caseRecord.referralFeeStatus = updates.referralFeeStatus;
    }

    if (typeof updates.referralNotes === 'string') {
      caseRecord.referralNotes = trimTo(updates.referralNotes, 2000);
    }

    if (Array.isArray(updates.platformTasks)) {
      caseRecord.platformTasks = updates.platformTasks
        .map((task, index) => normalizePlatformTask(task, index, caseRecord.preferredOutcome, new Date().toISOString()))
        .filter((task) => task.name);
    } else if (typeof updates.knownPlatforms === 'string' || typeof updates.profileUrls === 'string') {
      caseRecord.platformTasks = syncPlatformTasks(
        caseRecord.platformTasks,
        caseRecord.knownPlatforms,
        caseRecord.profileUrls,
        caseRecord.preferredOutcome,
        new Date().toISOString()
      );
    }

    if (updates.activityEvent) {
      caseRecord.activity.unshift(createActivityEntry(updates.activityEvent, updates.activityMetadata, 'admin'));
    }

    if (!updates.lastOperatorActionAt) {
      caseRecord.lastOperatorActionAt = updateStamp;
    }

    return caseRecord;
  });
}

async function recordEvent(id, publicToken, eventType, metadata) {
  const caseRecord = await getCaseForPublic(id, publicToken);

  if (!caseRecord) {
    return null;
  }

  return updatePublicCase(id, publicToken, {
    activityEvent: eventType,
    activityMetadata: metadata
  });
}

async function recordAnalyticsEvent(event) {
  const events = await readAnalyticsEvents();
  events.unshift({
    id: crypto.randomUUID(),
    eventType: trimTo(event.eventType, 80),
    path: trimTo(event.path, 240),
    label: trimTo(event.label, 180),
    sessionId: trimTo(event.sessionId, 120),
    pageTitle: trimTo(event.pageTitle, 240),
    referrer: trimTo(event.referrer, 500),
    caseId: trimTo(event.caseId, 80),
    metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : {},
    createdAt: new Date().toISOString()
  });

  await writeAnalyticsEvents(events);
}

async function getAnalyticsSummary() {
  const events = await readAnalyticsEvents();
  const sessions = new Set();
  const pathCounts = new Map();
  const labelCounts = new Map();

  for (const event of events) {
    if (event.sessionId) {
      sessions.add(event.sessionId);
    }

    if (event.path) {
      pathCounts.set(event.path, (pathCounts.get(event.path) || 0) + 1);
    }

    if (event.label) {
      labelCounts.set(event.label, (labelCounts.get(event.label) || 0) + 1);
    }
  }

  const topPages = Array.from(pathCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([pathName, count]) => ({ path: pathName, count }));

  const topClicks = Array.from(labelCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([label, count]) => ({ label, count }));

  const pageViews = events.filter((event) => event.eventType === 'page_view').length;
  const ctaClicks = events.filter((event) => event.eventType === 'cta_click').length;
  const articleViews = events.filter((event) => event.eventType === 'article_view').length;
  const intakeStarts = events.filter((event) => event.eventType === 'intake_started').length;
  const intakeSubmits = events.filter((event) => event.eventType === 'intake_submitted').length;
  const paymentClicks = events.filter((event) => event.eventType === 'payment_cta_clicked').length;

  return {
    totalEvents: events.length,
    uniqueSessions: sessions.size,
    pageViews,
    ctaClicks,
    articleViews,
    intakeStarts,
    intakeSubmits,
    paymentClicks,
    topPages,
    topClicks,
    latestEvents: events.slice(0, 12)
  };
}

function parseBase64Payload(data) {
  const source = String(data || '');
  const match = source.match(/^data:(.*?);base64,(.*)$/);
  const base64 = match ? match[2] : source;
  return Buffer.from(base64, 'base64');
}

async function storeDocumentBuffer(caseId, fileName, contentType, buffer) {
  const documentId = crypto.randomUUID();
  const safeName = slugifyFileName(fileName);
  const pathname = `documents/${caseId}/${documentId}-${safeName}`;

  if (getStorageMode() === 'blob') {
    const blob = await put(pathname, buffer, {
      access: 'private',
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: contentType || 'application/octet-stream'
    });

    return {
      id: documentId,
      pathname: blob.pathname,
      url: blob.url,
      downloadUrl: blob.downloadUrl
    };
  }

  await ensureLocalDirs();
  const filePath = path.join(DOCUMENTS_DIR, caseId, `${documentId}-${safeName}`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);

  return {
    id: documentId,
    pathname: filePath,
    url: '',
    downloadUrl: ''
  };
}

async function uploadDocuments(id, publicToken, payload) {
  assertWritableStore();

  const caseRecord = await getCaseForPublic(id, publicToken);

  if (!caseRecord) {
    return null;
  }

  const uploadedDocuments = [];

  for (const file of ensureArray(payload.files)) {
    const buffer = parseBase64Payload(file.data);
    const stored = await storeDocumentBuffer(id, file.name, file.type, buffer);

    uploadedDocuments.push({
      id: stored.id,
      fileName: file.name,
      documentType: file.documentType || 'supporting_document',
      contentType: file.type || 'application/octet-stream',
      size: buffer.byteLength,
      storagePath: stored.pathname,
      uploadedAt: new Date().toISOString()
    });
  }

  return updateCase(id, async (existingCase) => {
    if (existingCase.publicToken !== publicToken) {
      return existingCase;
    }

    existingCase.authorityBasis = payload.authorityBasis || existingCase.authorityBasis;
    existingCase.documentNotes = payload.notes || '';
    existingCase.documents = [...uploadedDocuments, ...ensureArray(existingCase.documents)];
    existingCase.status = 'documents_received';
    existingCase.lastClientUpdateAt = new Date().toISOString();
    existingCase.activity.unshift(createActivityEntry('documents_uploaded', {
      count: uploadedDocuments.length,
      authorityBasis: payload.authorityBasis || ''
    }, 'public'));

    return existingCase;
  });
}

async function getDocumentInventory() {
  if (getStorageMode() !== 'blob') {
    return [];
  }

  const response = await list({ prefix: 'documents/' });
  return response.blobs;
}

module.exports = {
  StoreConfigurationError,
  buildAdminCase,
  buildPublicCase,
  createCase,
  getCaseForAdmin,
  getAnalyticsSummary,
  getCaseForPublic,
  getDocumentInventory,
  getStorageHealth,
  listAdminCases,
  recordAnalyticsEvent,
  recordEvent,
  updateAdminCase,
  updatePublicCase,
  uploadDocuments
};
