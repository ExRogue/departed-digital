const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { del, get, list, put } = require('@vercel/blob');
const { hasDatabaseConnection, query, withTransaction } = require('./db');

const {
  CASE_PRIORITIES,
  CASE_STATUSES,
  MAX_ANALYTICS_EVENTS,
  PACKAGE_CONFIG,
  PAYMENT_STATUSES,
  PLATFORM_STATUSES,
  REMINDER_SEVERITIES,
  REMINDER_STATUSES,
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
const ANALYTICS_EVENTS_PREFIX = 'analytics-events/';
const ADMIN_READ_MODEL_VERSION = 2;

class StoreConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreConfigurationError';
  }
}

class PaymentRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PaymentRequiredError';
  }
}

function getStorageMode() {
  return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'file';
}

function getStorageHealth() {
  const mode = getStorageMode();
  const persistent = hasDatabaseConnection() || mode === 'blob' || !process.env.VERCEL;

  return {
    mode: hasDatabaseConnection() ? 'postgres' : mode,
    backingStore: mode,
    persistent,
    requiresConfiguration: Boolean(process.env.VERCEL && !hasDatabaseConnection() && mode !== 'blob')
  };
}

function assertWritableStore() {
  if (hasDatabaseConnection()) {
    return;
  }

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

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
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

function normalizeReminder(input, index = 0, fallbackTimestamp = new Date().toISOString()) {
  const title = trimTo(input && input.title, 180) || `Reminder ${index + 1}`;
  const id = trimTo(input && input.id, 120) || `reminder-${slugifyKey(title) || String(index + 1)}-${index + 1}`;
  const status = REMINDER_STATUSES.includes(input && input.status) ? input.status : 'open';
  const severity = REMINDER_SEVERITIES.includes(input && input.severity) ? input.severity : 'normal';
  const dueDate = trimTo(input && input.dueDate, 40);
  const escalateAt = trimTo(input && input.escalateAt, 40) || (dueDate ? addDays(dueDate, severity === 'urgent' ? 0 : 1) : '');

  return {
    id,
    title,
    status,
    severity,
    assignedTo: trimTo(input && input.assignedTo, 140),
    ownerLane: trimTo(input && input.ownerLane, 80),
    dueDate,
    escalateAt,
    notes: trimTo(input && input.notes, 1200),
    completedAt: trimTo(input && input.completedAt, 80),
    createdAt: trimTo(input && input.createdAt, 80) || fallbackTimestamp,
    updatedAt: trimTo(input && input.updatedAt, 80) || fallbackTimestamp
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
      label: 'Case review',
      description: 'The private case review and checkout handoff are completed before sensitive document requests.',
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
  const platformTasks = ensureArray(caseRecord.platformTasks).map((task, index) => normalizePlatformTask(task, index, caseRecord.preferredOutcome, caseRecord.updatedAt || caseRecord.createdAt));
  const documents = ensureArray(caseRecord.documents);
  const documentCount = documents.length
    ? documents.length
    : (Number.isFinite(caseRecord.documentCount) ? Number(caseRecord.documentCount || 0) : 0);
  const reminders = ensureArray(caseRecord.reminders).map((reminder, index) => normalizeReminder(reminder, index, caseRecord.updatedAt || caseRecord.createdAt));
  const platformCount = platformTasks.length
    ? platformTasks.length
    : (Number.isFinite(caseRecord.platformCount) ? Number(caseRecord.platformCount || 0) : 0);
  const blockedTaskCount = platformTasks.length
    ? platformTasks.filter((task) => task.status === 'blocked').length
    : (Number.isFinite(caseRecord.blockedPlatformCount) ? Number(caseRecord.blockedPlatformCount || 0) : 0);
  const pendingSubmissionCount = platformTasks.length
    ? platformTasks.filter((task) => task.status === 'not_started' || task.status === 'queued').length
    : (Number.isFinite(caseRecord.pendingSubmissionCount) ? Number(caseRecord.pendingSubmissionCount || 0) : 0);
  const inFlightCount = platformTasks.length
    ? platformTasks.filter((task) => task.status === 'submitted' || task.status === 'waiting').length
    : (Number.isFinite(caseRecord.inFlightPlatformCount) ? Number(caseRecord.inFlightPlatformCount || 0) : 0);
  const resolvedTaskCount = platformTasks.length
    ? platformTasks.filter((task) => task.status === 'resolved').length
    : (Number.isFinite(caseRecord.resolvedPlatformCount) ? Number(caseRecord.resolvedPlatformCount || 0) : 0);
  const openReminderCount = reminders.length
    ? reminders.filter((reminder) => reminder.status === 'open').length
    : (Number.isFinite(caseRecord.openReminderCount) ? Number(caseRecord.openReminderCount || 0) : 0);
  const overdueReminderCount = reminders.length
    ? reminders.filter((reminder) => reminder.status === 'open' && reminder.dueDate && isPastDate(reminder.dueDate)).length
    : (Number.isFinite(caseRecord.overdueReminderCount) ? Number(caseRecord.overdueReminderCount || 0) : 0);
  const escalatedReminderCount = reminders.length
    ? reminders.filter((reminder) => reminder.status === 'open' && reminder.escalateAt && isPastDate(reminder.escalateAt)).length
    : (Number.isFinite(caseRecord.escalatedReminderCount) ? Number(caseRecord.escalatedReminderCount || 0) : 0);
  const isCompleted = caseRecord.status === 'completed';
  const isBlocked = caseRecord.status === 'blocked' || blockedTaskCount > 0;
  const isArchived = Boolean(caseRecord.archivedAt);
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
  } else if (pendingSubmissionCount && ['active', 'submitted', 'paid', 'documents_received'].includes(caseRecord.status)) {
    queueKey = 'submission_queue';
    queueLabel = 'Ready for submission';
    waitingOn = 'operator';
    stageKey = 'submission';
    stageLabel = 'Prepare platform submissions';
    recommendedLane = 'platform_desk';
    followUpDate = followUpDate || dateOnlyFrom(new Date());
  } else if (inFlightCount || caseRecord.status === 'submitted') {
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
  // For a solo-founder + agent workflow, "waiting on the client" should not
  // look like an operational problem unless it is overdue, unassigned, or escalated.
  let needsAttention = Boolean(
    overdue
    || isBlocked
    || !caseRecord.assignedTo
    || followUpOverdue
    || overdueReminderCount
    || escalatedReminderCount
  );

  if (isArchived) {
    queueKey = 'archived';
    queueLabel = 'Archived';
    waitingOn = 'none';
    stageKey = 'archived';
    stageLabel = 'Archived record';
    recommendedLane = 'archive_desk';
    followUpDate = '';
    needsAttention = false;
  }

  const healthStatus = isArchived || isCompleted
    ? 'complete'
    : (isBlocked || overdue ? 'critical' : (needsAttention ? 'attention' : 'on_track'));

  const progressPercent = isCompleted
    ? 100
    : Math.min(95, Math.round((((resolvedTaskCount * 2) + (documentCount ? 1 : 0) + (caseRecord.paymentStatus === 'paid' ? 1 : 0)) / Math.max((platformCount * 2) + 2, 4)) * 100));

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
      label: 'Follow up on the checkout handoff',
      state: 'open',
      dueDate: followUpDate,
      ownerLane: 'intake_desk',
      reason: 'The checkout handoff has been sent and needs a follow-up check.'
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

  if (pendingSubmissionCount) {
    const nextTaskLabel = platformTasks.length ? platformTasks.find((task) => task.status === 'not_started' || task.status === 'queued') : null;
    automationTasks.push({
      key: 'submit_next_platform',
      label: 'Submit the next platform request',
      state: 'open',
      dueDate: followUpDate || dateOnlyFrom(new Date()),
      ownerLane: 'platform_desk',
      reason: `${(nextTaskLabel && nextTaskLabel.name) || 'A platform task'} is ready to move from queued into submission.`
    });
  }

  if (blockedTaskCount) {
    const blockedTask = platformTasks.find((task) => task.status === 'blocked');
    automationTasks.push({
      key: 'clear_blocker',
      label: 'Clear the active blocker',
      state: 'open',
      dueDate: followUpDate || dateOnlyFrom(new Date()),
      ownerLane: 'founder_review',
      reason: `${(blockedTask && blockedTask.name) || 'A platform task'} is blocked and needs intervention before the case can progress.`
    });
  }

  for (const reminder of reminders.filter((entry) => entry.status === 'open' && entry.dueDate && isPastDate(entry.dueDate))) {
    automationTasks.push({
      key: `reminder_due_${reminder.id}`,
      label: reminder.title,
      state: 'open',
      dueDate: reminder.dueDate || dateOnlyFrom(new Date()),
      ownerLane: reminder.ownerLane || recommendedLane,
      reason: 'A manual reminder is overdue and needs attention.'
    });
  }

  for (const reminder of reminders.filter((entry) => entry.status === 'open' && entry.escalateAt && isPastDate(entry.escalateAt))) {
    automationTasks.push({
      key: `reminder_escalated_${reminder.id}`,
      label: `${reminder.title} (escalated)`,
      state: 'open',
      dueDate: reminder.escalateAt || reminder.dueDate || dateOnlyFrom(new Date()),
      ownerLane: reminder.ownerLane || 'founder_review',
      reason: 'This reminder has reached its escalation threshold.'
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
    reminderCount: reminders.length,
    openReminderCount,
    overdueReminderCount,
    escalatedReminderCount,
    automationTasks
  };
}

function toRunAtTimestamp(dateValue) {
  if (!dateValue) {
    return '';
  }

  const normalized = String(dateValue).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return `${normalized}T09:00:00.000Z`;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  return parsed.toISOString();
}

async function syncDatabaseCaseJobs(client, caseRecord) {
  const workflow = buildWorkflowKit(caseRecord);

  await client.query(`
    delete from ops_jobs
    where case_id = $1::uuid
      and status in ('queued', 'processing', 'failed')
  `, [caseRecord.id]);

  if (caseRecord.archivedAt || caseRecord.status === 'completed') {
    return;
  }

  const jobs = [];
  const workflowRunAt = toRunAtTimestamp(workflow.followUpDate || workflow.serviceTargetDate || caseRecord.updatedAt);

  if (workflowRunAt) {
    jobs.push({
      queueKey: workflow.queueKey || 'workflow',
      jobType: 'workflow_follow_up',
      dedupeKey: `${caseRecord.id}:workflow_follow_up:${workflowRunAt}`,
      runAt: workflowRunAt,
      payload: {
        caseId: caseRecord.id,
        caseReference: caseRecord.reference,
        queueKey: workflow.queueKey,
        queueLabel: workflow.queueLabel,
        stageLabel: workflow.stageLabel,
        nextBestAction: buildOperationalKit(caseRecord).nextBestAction
      }
    });
  }

  for (const task of workflow.automationTasks) {
    const runAt = toRunAtTimestamp(task.dueDate || workflow.followUpDate || caseRecord.updatedAt);

    if (!runAt) {
      continue;
    }

    jobs.push({
      queueKey: task.ownerLane || workflow.queueKey || 'workflow',
      jobType: 'case_automation_task',
      dedupeKey: `${caseRecord.id}:${task.key}:${runAt}`,
      runAt,
      payload: {
        caseId: caseRecord.id,
        caseReference: caseRecord.reference,
        taskKey: task.key,
        taskLabel: task.label,
        ownerLane: task.ownerLane || '',
        reason: task.reason || '',
        dueDate: task.dueDate || '',
        stageLabel: workflow.stageLabel || ''
      }
    });
  }

  for (const [index, job] of jobs.entries()) {
    await client.query(`
      insert into ops_jobs (
        case_id,
        queue_key,
        job_type,
        dedupe_key,
        run_at,
        payload,
        created_at,
        updated_at
      ) values (
        $1::uuid, $2, $3, $4, $5::timestamptz, $6::jsonb,
        now() + (($7::int * interval '1 millisecond')),
        now() + (($7::int * interval '1 millisecond'))
      )
      on conflict (dedupe_key) do update set
        queue_key = excluded.queue_key,
        job_type = excluded.job_type,
        run_at = excluded.run_at,
        payload = excluded.payload,
        status = 'queued',
        attempts = 0,
        last_error = '',
        locked_at = null,
        locked_by = '',
        completed_at = null,
        updated_at = excluded.updated_at
    `, [
      caseRecord.id,
      job.queueKey,
      job.jobType,
      job.dedupeKey,
      job.runAt,
      JSON.stringify(job.payload || {}),
      index
    ]);
  }
}

function normalizeCaseSummary(caseRecord) {
  const platformTasks = ensureArray(caseRecord.platformTasks);
  const documents = ensureArray(caseRecord.documents);
  const reminders = ensureArray(caseRecord.reminders);
  const platformCount = platformTasks.length
    ? platformTasks.length
    : (Number.isFinite(caseRecord.platformCount) ? Number(caseRecord.platformCount || 0) : 0);
  const resolvedPlatformCount = platformTasks.length
    ? platformTasks.filter((task) => task.status === 'resolved').length
    : (Number.isFinite(caseRecord.resolvedPlatformCount) ? Number(caseRecord.resolvedPlatformCount || 0) : 0);
  const documentCount = documents.length
    ? documents.length
    : (Number.isFinite(caseRecord.documentCount) ? Number(caseRecord.documentCount || 0) : 0);
  const reminderCount = reminders.length
    ? reminders.filter((entry) => entry.status !== 'done' && entry.status !== 'dismissed').length
    : (Number.isFinite(caseRecord.openReminderCount) ? Number(caseRecord.openReminderCount || 0) : 0);

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
    platformCount,
    resolvedPlatformCount,
    documentCount,
    reminderCount,
    archivedAt: caseRecord.archivedAt || '',
    createdAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt
  };
}

function buildAdminCaseSummary(caseRecord) {
  const workflow = buildWorkflowKit(caseRecord);

  return {
    ...normalizeCaseSummary(caseRecord),
    workflow: {
      stageLabel: workflow.stageLabel,
      queueLabel: workflow.queueLabel,
      queueKey: workflow.queueKey,
      waitingOn: workflow.waitingOn,
      serviceTargetDate: workflow.serviceTargetDate,
      followUpDate: workflow.followUpDate,
      healthStatus: workflow.healthStatus,
      progressPercent: workflow.progressPercent,
      needsAttention: workflow.needsAttention,
      overdue: workflow.overdue,
      openReminderCount: workflow.openReminderCount,
      escalatedReminderCount: workflow.escalatedReminderCount,
      recommendedLane: workflow.recommendedLane
    }
  };
}

async function syncAdminCaseReadModel(client, caseRecord) {
  const summary = buildAdminCaseSummary(caseRecord);
  const workflow = summary.workflow || {};
  const platformTasks = ensureArray(caseRecord.platformTasks);
  const reminders = ensureArray(caseRecord.reminders);
  const blockedPlatformCount = platformTasks.length
    ? platformTasks.filter((task) => task.status === 'blocked').length
    : Number(caseRecord.blockedPlatformCount || 0);
  const pendingSubmissionCount = platformTasks.length
    ? platformTasks.filter((task) => task.status === 'not_started' || task.status === 'queued').length
    : Number(caseRecord.pendingSubmissionCount || 0);
  const inFlightPlatformCount = platformTasks.length
    ? platformTasks.filter((task) => task.status === 'submitted' || task.status === 'waiting').length
    : Number(caseRecord.inFlightPlatformCount || 0);
  const overdueReminderCount = reminders.length
    ? reminders.filter((reminder) => reminder.status === 'open' && reminder.dueDate && isPastDate(reminder.dueDate)).length
    : Number(caseRecord.overdueReminderCount || 0);
  const escalatedReminderCount = reminders.length
    ? reminders.filter((reminder) => reminder.status === 'open' && reminder.escalateAt && isPastDate(reminder.escalateAt)).length
    : Number(caseRecord.escalatedReminderCount || 0);

  await client.query(`
    insert into admin_case_read_model (
      case_id,
      reference,
      client_name,
      client_email,
      deceased_name,
      selected_package,
      package_label,
      relationship_to_deceased,
      assigned_to,
      priority,
      due_date,
      referral_partner_name,
      referral_fee_status,
      status,
      payment_status,
      platform_count,
      resolved_platform_count,
      blocked_platform_count,
      pending_submission_count,
      in_flight_platform_count,
      document_count,
      open_reminder_count,
      overdue_reminder_count,
      escalated_reminder_count,
      archived_at,
      created_at,
      updated_at,
      workflow_stage_label,
      workflow_queue_label,
      workflow_queue_key,
      workflow_waiting_on,
      workflow_service_target_date,
      workflow_follow_up_date,
      workflow_health_status,
      workflow_progress_percent,
      workflow_needs_attention,
      workflow_overdue,
      workflow_open_reminder_count,
      workflow_escalated_reminder_count,
      workflow_recommended_lane,
      workflow_model_version
    ) values (
      $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      nullif($11, '')::date,
      $12, $13, $14, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24,
      nullif($25, '')::timestamptz,
      $26::timestamptz, $27::timestamptz,
      $28, $29, $30, $31,
      nullif($32, '')::date,
      nullif($33, '')::date,
      $34, $35, $36, $37, $38, $39, $40, $41
    )
    on conflict (case_id) do update set
      reference = excluded.reference,
      client_name = excluded.client_name,
      client_email = excluded.client_email,
      deceased_name = excluded.deceased_name,
      selected_package = excluded.selected_package,
      package_label = excluded.package_label,
      relationship_to_deceased = excluded.relationship_to_deceased,
      assigned_to = excluded.assigned_to,
      priority = excluded.priority,
      due_date = excluded.due_date,
      referral_partner_name = excluded.referral_partner_name,
      referral_fee_status = excluded.referral_fee_status,
      status = excluded.status,
      payment_status = excluded.payment_status,
      platform_count = excluded.platform_count,
      resolved_platform_count = excluded.resolved_platform_count,
      blocked_platform_count = excluded.blocked_platform_count,
      pending_submission_count = excluded.pending_submission_count,
      in_flight_platform_count = excluded.in_flight_platform_count,
      document_count = excluded.document_count,
      open_reminder_count = excluded.open_reminder_count,
      overdue_reminder_count = excluded.overdue_reminder_count,
      escalated_reminder_count = excluded.escalated_reminder_count,
      archived_at = excluded.archived_at,
      updated_at = excluded.updated_at,
      workflow_stage_label = excluded.workflow_stage_label,
      workflow_queue_label = excluded.workflow_queue_label,
      workflow_queue_key = excluded.workflow_queue_key,
      workflow_waiting_on = excluded.workflow_waiting_on,
      workflow_service_target_date = excluded.workflow_service_target_date,
      workflow_follow_up_date = excluded.workflow_follow_up_date,
      workflow_health_status = excluded.workflow_health_status,
      workflow_progress_percent = excluded.workflow_progress_percent,
      workflow_needs_attention = excluded.workflow_needs_attention,
      workflow_overdue = excluded.workflow_overdue,
      workflow_open_reminder_count = excluded.workflow_open_reminder_count,
      workflow_escalated_reminder_count = excluded.workflow_escalated_reminder_count,
      workflow_recommended_lane = excluded.workflow_recommended_lane,
      workflow_model_version = excluded.workflow_model_version
  `, [
    summary.id,
    summary.reference,
    summary.clientName || '',
    summary.clientEmail || '',
    summary.deceasedName || '',
    summary.selectedPackage || '',
    summary.packageLabel || '',
    summary.relationshipToDeceased || '',
    summary.assignedTo || '',
    summary.priority || 'standard',
    summary.dueDate || '',
    summary.referralPartnerName || '',
    summary.referralFeeStatus || 'not_applicable',
    summary.status || '',
    summary.paymentStatus || '',
    Number(summary.platformCount || 0),
    Number(summary.resolvedPlatformCount || 0),
    Number(blockedPlatformCount || 0),
    Number(pendingSubmissionCount || 0),
    Number(inFlightPlatformCount || 0),
    Number(summary.documentCount || 0),
    Number(summary.reminderCount || 0),
    Number(overdueReminderCount || 0),
    Number(escalatedReminderCount || 0),
    summary.archivedAt || '',
    summary.createdAt,
    summary.updatedAt,
    workflow.stageLabel || '',
    workflow.queueLabel || '',
    workflow.queueKey || '',
    workflow.waitingOn || '',
    workflow.serviceTargetDate || '',
    workflow.followUpDate || '',
    workflow.healthStatus || '',
    Number(workflow.progressPercent || 0),
    Boolean(workflow.needsAttention),
    Boolean(workflow.overdue),
    Number(workflow.openReminderCount || 0),
    Number(workflow.escalatedReminderCount || 0),
    workflow.recommendedLane || '',
    ADMIN_READ_MODEL_VERSION
  ]);
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
    reminders: ensureArray(caseRecord.reminders).map((reminder, index) => normalizeReminder(reminder, index, caseRecord.updatedAt || caseRecord.createdAt)),
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
      payment: `/review?case=${caseRecord.id}&token=${caseRecord.publicToken}&package=${caseRecord.selectedPackage}`,
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
    archivedAt: caseRecord.archivedAt || '',
    archivedBy: caseRecord.archivedBy || '',
    archiveReason: caseRecord.archiveReason || '',
    operatorLane: caseRecord.operatorLane || '',
    nextFollowUpAt: caseRecord.nextFollowUpAt || '',
    blockerReason: caseRecord.blockerReason || '',
    lastClientUpdateAt: caseRecord.lastClientUpdateAt || '',
    lastOperatorActionAt: caseRecord.lastOperatorActionAt || '',
    platformTasks: ensureArray(caseRecord.platformTasks),
    reminders: ensureArray(caseRecord.reminders).map((reminder, index) => normalizeReminder(reminder, index, caseRecord.updatedAt || caseRecord.createdAt)),
    internalNotes: caseRecord.internalNotes || '',
    activity: ensureArray(caseRecord.activity)
  };
}

function buildOperationalKit(caseRecord) {
  const knownPlatforms = formatList(caseRecord.knownPlatforms);
  const profileUrls = formatList(caseRecord.profileUrls);
  const platformTasks = ensureArray(caseRecord.platformTasks).map((task, index) => normalizePlatformTask(task, index, caseRecord.preferredOutcome, caseRecord.updatedAt || caseRecord.createdAt));
  const documents = ensureArray(caseRecord.documents);
  const reminders = ensureArray(caseRecord.reminders).map((reminder, index) => normalizeReminder(reminder, index, caseRecord.updatedAt || caseRecord.createdAt));
  const workflow = buildWorkflowKit(caseRecord);
  const documentCount = documents.length
    ? documents.length
    : (Number.isFinite(caseRecord.documentCount) ? Number(caseRecord.documentCount || 0) : 0);
  const platformCount = platformTasks.length
    ? platformTasks.length
    : (Number.isFinite(caseRecord.platformCount) ? Number(caseRecord.platformCount || 0) : 0);
  const blockedPlatformCount = platformTasks.length
    ? platformTasks.filter((task) => task.status === 'blocked').length
    : (Number.isFinite(caseRecord.blockedPlatformCount) ? Number(caseRecord.blockedPlatformCount || 0) : 0);
  const resolvedPlatformCount = platformTasks.length
    ? platformTasks.filter((task) => task.status === 'resolved').length
    : (Number.isFinite(caseRecord.resolvedPlatformCount) ? Number(caseRecord.resolvedPlatformCount || 0) : 0);
  const pendingSubmissionCount = platformTasks.length
    ? platformTasks.filter((task) => task.status === 'not_started' || task.status === 'queued').length
    : (Number.isFinite(caseRecord.pendingSubmissionCount) ? Number(caseRecord.pendingSubmissionCount || 0) : 0);
  const inFlightPlatformCount = platformTasks.length
    ? platformTasks.filter((task) => task.status === 'submitted' || task.status === 'waiting').length
    : (Number.isFinite(caseRecord.inFlightPlatformCount) ? Number(caseRecord.inFlightPlatformCount || 0) : 0);
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

  if (!reminders.length && !caseRecord.archivedAt && caseRecord.status !== 'completed') {
    missingItems.push('No manual reminder has been set yet for the next operator check-in.');
  }

  if (!platformCount) {
    missingItems.push('No platform workflow has been created yet.');
  }

  if (caseRecord.referralPartnerType === 'funeral_director' && !caseRecord.referralPartnerName) {
    missingItems.push('Funeral director referral details are still missing.');
  }

  let nextBestAction = 'Review the case and decide the next operational step.';

  if (caseRecord.status === 'awaiting_payment' || caseRecord.paymentStatus === 'pending') {
    nextBestAction = 'Send or confirm the correct checkout handoff, then wait for payment before requesting sensitive documents.';
  } else if (caseRecord.paymentStatus === 'payment_link_sent') {
    nextBestAction = 'Follow up on the checkout handoff and keep the case warm with a short reassurance note.';
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

  if (workflow.overdueReminderCount) {
    nextBestAction = 'Clear the overdue reminder queue first, then continue the case handoff or submission work.';
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
      total: platformCount,
      active: platformTasks.length ? activePlatformTasks.length : Math.max(platformCount - resolvedPlatformCount, 0),
      resolved: resolvedPlatformCount,
      blocked: blockedPlatformCount,
      pending: pendingSubmissionCount,
      inFlight: inFlightPlatformCount
    },
    workflow,
    reminders,
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

async function listAllBlobs(prefix) {
  const blobs = [];
  let cursor;

  do {
    const response = await list(cursor ? { prefix, cursor } : { prefix });
    blobs.push(...ensureArray(response && response.blobs));
    cursor = response && response.hasMore ? response.cursor : undefined;
  } while (cursor);

  return blobs;
}

let adminReadModelSchemaPromise = null;

async function ensureAdminReadModelSchema() {
  if (!hasDatabaseConnection()) {
    return;
  }

  if (!adminReadModelSchemaPromise) {
    adminReadModelSchemaPromise = query(`
      create table if not exists admin_case_read_model (
        case_id uuid primary key references cases(id) on delete cascade,
        reference text not null,
        client_name text not null default '',
        client_email text not null default '',
        deceased_name text not null default '',
        selected_package text not null default '',
        package_label text not null default '',
        relationship_to_deceased text not null default '',
        assigned_to text not null default '',
        priority text not null default 'standard',
        due_date date,
        referral_partner_name text not null default '',
        referral_fee_status text not null default 'not_applicable',
        status text not null default '',
        payment_status text not null default '',
        platform_count integer not null default 0,
        resolved_platform_count integer not null default 0,
        blocked_platform_count integer not null default 0,
        pending_submission_count integer not null default 0,
        in_flight_platform_count integer not null default 0,
        document_count integer not null default 0,
        open_reminder_count integer not null default 0,
        overdue_reminder_count integer not null default 0,
        escalated_reminder_count integer not null default 0,
        archived_at timestamptz,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        workflow_stage_label text not null default '',
        workflow_queue_label text not null default '',
        workflow_queue_key text not null default '',
        workflow_waiting_on text not null default '',
        workflow_service_target_date date,
        workflow_follow_up_date date,
        workflow_health_status text not null default '',
        workflow_progress_percent integer not null default 0,
        workflow_needs_attention boolean not null default false,
        workflow_overdue boolean not null default false,
        workflow_open_reminder_count integer not null default 0,
        workflow_escalated_reminder_count integer not null default 0,
        workflow_recommended_lane text not null default '',
        workflow_model_version integer not null default 1
      );
      alter table admin_case_read_model add column if not exists workflow_model_version integer not null default 1;
      create index if not exists idx_admin_case_read_model_updated_at on admin_case_read_model(updated_at desc);
      create index if not exists idx_admin_case_read_model_status on admin_case_read_model(status);
      create index if not exists idx_admin_case_read_model_payment_status on admin_case_read_model(payment_status);
      create index if not exists idx_admin_case_read_model_archived_at on admin_case_read_model(archived_at);
      create index if not exists idx_admin_case_read_model_queue on admin_case_read_model(workflow_queue_key);
    `).catch((error) => {
      adminReadModelSchemaPromise = null;
      throw error;
    });
  }

  await adminReadModelSchemaPromise;
}

async function readIndex() {
  if (getStorageMode() === 'blob') {
    const caseBlobs = await listAllBlobs('cases/');

    if (caseBlobs.length) {
      return caseBlobs
        .map((entry) => ({
          id: path.basename(entry.pathname || '', '.json'),
          updatedAt: entry.uploadedAt || entry.pathname || ''
        }))
        .filter((entry) => entry.id)
        .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
    }

    return readBlobJson(INDEX_BLOB_PATH, []);
  }

  await ensureLocalDirs();
  return readJsonFile(INDEX_FILE, []);
}

async function writeIndex(index) {
  if (getStorageMode() === 'blob') {
    return;
  }

  await ensureLocalDirs();
  return writeJsonFile(INDEX_FILE, index);
}

async function readAnalyticsEvents() {
  if (hasDatabaseConnection()) {
    const result = await query(`
      select
        id,
        event_type,
        path,
        label,
        session_id,
        page_title,
        referrer,
        case_id::text as case_id,
        metadata,
        created_at::text as created_at
      from analytics_events
      order by created_at desc
      limit $1
    `, [MAX_ANALYTICS_EVENTS]);

    return result.rows.map((row) => ({
      id: trimTo(row.id, 120),
      eventType: trimTo(row.event_type, 80),
      path: trimTo(row.path, 240),
      label: trimTo(row.label, 180),
      sessionId: trimTo(row.session_id, 120),
      pageTitle: trimTo(row.page_title, 240),
      referrer: trimTo(row.referrer, 500),
      caseId: trimTo(row.case_id, 80),
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
      createdAt: trimTo(row.created_at, 80)
    }));
  }

  if (getStorageMode() === 'blob') {
    const eventBlobs = await listAllBlobs(ANALYTICS_EVENTS_PREFIX);
    const legacyEvents = await readBlobJson(ANALYTICS_BLOB_PATH, []);

    if (eventBlobs.length || legacyEvents.length) {
      const events = [];

      for (const entry of eventBlobs) {
        const eventRecord = await readBlobJson(entry.pathname, null);
        if (eventRecord) {
          events.push(eventRecord);
        }
      }

      for (const eventRecord of legacyEvents) {
        if (eventRecord) {
          events.push(eventRecord);
        }
      }

      return Array.from(new Map(events.map((eventRecord) => [eventRecord.id, eventRecord])).values())
        .sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
        .slice(0, MAX_ANALYTICS_EVENTS);
    }
  }

  await ensureLocalDirs();
  return readJsonFile(ANALYTICS_FILE, []);
}

async function writeAnalyticsEvents(events) {
  const limitedEvents = events
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, MAX_ANALYTICS_EVENTS);

  if (hasDatabaseConnection() || getStorageMode() === 'blob') {
    return;
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

function mapDatabaseCase(row) {
  if (!row) {
    return null;
  }

  const payload = row.legacy_payload && typeof row.legacy_payload === 'object'
    ? { ...row.legacy_payload }
    : {};

  const documents = ensureArray(payload.documents);
  const platformTasks = ensureArray(payload.platformTasks);
  const reminders = ensureArray(payload.reminders);

  return {
    ...payload,
    id: trimTo(row.id, 120) || payload.id || '',
    reference: trimTo(row.reference, 120) || payload.reference || '',
    publicToken: payload.publicToken || '',
    deceasedName: trimTo(row.deceased_name, 240) || payload.deceasedName || '',
    preferredOutcome: trimTo(row.preferred_outcome, 80) || payload.preferredOutcome || 'not_sure',
    caseDetails: row.case_details || payload.caseDetails || '',
    relationshipToDeceased: row.relationship_to_deceased || payload.relationshipToDeceased || '',
    urgency: trimTo(row.urgency, 40) || payload.urgency || 'standard',
    selectedPackage: trimTo(row.selected_package, 40) || payload.selectedPackage || 'standard',
    packageLabel: row.package_label || payload.packageLabel || '',
    status: trimTo(row.status, 60) || payload.status || 'awaiting_payment',
    paymentStatus: trimTo(row.payment_status, 60) || payload.paymentStatus || 'pending',
    priority: trimTo(row.priority, 40) || payload.priority || 'standard',
    intakeSource: row.intake_source || payload.intakeSource || 'website',
    referralSource: row.referral_source || payload.referralSource || '',
    referralPartnerType: row.referral_partner_type || payload.referralPartnerType || 'direct',
    referralPartnerName: row.referral_partner_name || payload.referralPartnerName || '',
    referralPartnerEmail: row.referral_partner_email || payload.referralPartnerEmail || '',
    referralPartnerPhone: row.referral_partner_phone || payload.referralPartnerPhone || '',
    referralFeeStatus: row.referral_fee_status || payload.referralFeeStatus || 'not_applicable',
    referralNotes: row.referral_notes || payload.referralNotes || '',
    assignedTo: row.assigned_to_name_snapshot || payload.assignedTo || '',
    dueDate: row.due_date || payload.dueDate || '',
    nextFollowUpAt: row.next_follow_up_at || payload.nextFollowUpAt || '',
    operatorLane: row.operator_lane || payload.operatorLane || '',
    blockerReason: row.blocker_reason || payload.blockerReason || '',
    authorityBasis: row.authority_basis || payload.authorityBasis || '',
    documentNotes: row.document_notes || payload.documentNotes || '',
    internalNotes: row.internal_notes || payload.internalNotes || '',
    archivedAt: row.archived_at || payload.archivedAt || '',
    archivedBy: row.archived_by_name_snapshot || payload.archivedBy || '',
    archiveReason: row.archive_reason || payload.archiveReason || '',
    lastClientUpdateAt: row.last_client_update_at || payload.lastClientUpdateAt || '',
    lastOperatorActionAt: row.last_operator_action_at || payload.lastOperatorActionAt || '',
    documents,
    platformTasks,
    reminders,
    activity: ensureArray(payload.activity),
    platformCount: platformTasks.length || Number(row.platform_count || payload.platformCount || 0),
    resolvedPlatformCount: platformTasks.length
      ? platformTasks.filter((task) => task.status === 'resolved').length
      : Number(row.resolved_platform_count || payload.resolvedPlatformCount || 0),
    blockedPlatformCount: platformTasks.length
      ? platformTasks.filter((task) => task.status === 'blocked').length
      : Number(row.blocked_platform_count || payload.blockedPlatformCount || 0),
    pendingSubmissionCount: platformTasks.length
      ? platformTasks.filter((task) => task.status === 'not_started' || task.status === 'queued').length
      : Number(row.pending_submission_count || payload.pendingSubmissionCount || 0),
    inFlightPlatformCount: platformTasks.length
      ? platformTasks.filter((task) => task.status === 'submitted' || task.status === 'waiting').length
      : Number(row.in_flight_platform_count || payload.inFlightPlatformCount || 0),
    documentCount: documents.length || Number(row.document_count || payload.documentCount || 0),
    openReminderCount: reminders.filter((entry) => entry.status === 'open').length || Number(row.open_reminder_count || payload.openReminderCount || 0),
    overdueReminderCount: Number(row.overdue_reminder_count || payload.overdueReminderCount || 0),
    escalatedReminderCount: Number(row.escalated_reminder_count || payload.escalatedReminderCount || 0),
    createdAt: row.created_at || payload.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || payload.updatedAt || new Date().toISOString()
  };
}

function mapDatabasePlatformTask(row, index = 0, preferredOutcome = 'not_sure', fallbackTimestamp = new Date().toISOString()) {
  return normalizePlatformTask({
    id: trimTo(row.external_key || row.id, 120),
    name: trimTo(row.platform_name, 120),
    profileOrHandle: row.profile_or_handle || '',
    status: trimTo(row.status, 40) || 'not_started',
    outcomeRequested: row.outcome_requested || preferredOutcome,
    evidenceNeeded: row.evidence_needed || '',
    notes: row.notes || '',
    submissionReference: row.submission_reference || '',
    submittedAt: trimTo(row.submitted_at, 80),
    resolvedAt: trimTo(row.resolved_at, 80),
    lastUpdatedAt: trimTo(row.last_updated_at, 80)
  }, index, preferredOutcome, fallbackTimestamp);
}

function mapDatabaseDocument(row) {
  return {
    id: trimTo(row.id, 120),
    fileName: row.file_name || '',
    documentType: row.document_type || 'supporting_document',
    contentType: row.content_type || 'application/octet-stream',
    size: Number(row.size_bytes || 0),
    storagePath: row.storage_path || '',
    uploadedAt: trimTo(row.uploaded_at, 80),
    verifiedAt: trimTo(row.verified_at, 80),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  };
}

function mapDatabaseReminder(row, index = 0, fallbackTimestamp = new Date().toISOString()) {
  return normalizeReminder({
    id: trimTo(row.id, 120),
    title: row.title || '',
    status: trimTo(row.status, 40) || 'open',
    severity: trimTo(row.severity, 40) || 'normal',
    assignedTo: row.assigned_to || '',
    ownerLane: row.owner_lane || '',
    dueDate: trimTo(row.due_date, 40),
    escalateAt: trimTo(row.escalate_at, 40),
    notes: row.notes || '',
    completedAt: trimTo(row.completed_at, 80),
    createdAt: trimTo(row.created_at, 80),
    updatedAt: trimTo(row.updated_at, 80)
  }, index, fallbackTimestamp);
}

function mapDatabaseActivity(row) {
  return {
    id: trimTo(row.id, 120),
    eventType: row.event_type || '',
    actor: row.actor_type || 'system',
    actorLabel: row.actor_label || '',
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    createdAt: trimTo(row.created_at, 80)
  };
}

async function hydrateDatabaseCases(rows, client = { query }) {
  if (!Array.isArray(rows) || !rows.length) {
    return [];
  }

  const caseIds = rows.map((row) => row.id);
  const [
    platformTaskResult,
    documentResult,
    reminderResult,
    activityResult
  ] = await Promise.all([
    client.query(`
      select
        case_id::text as case_id,
        id::text as id,
        external_key,
        platform_name,
        profile_or_handle,
        status,
        outcome_requested,
        evidence_needed,
        notes,
        submission_reference,
        submitted_at::text as submitted_at,
        resolved_at::text as resolved_at,
        last_updated_at::text as last_updated_at,
        sort_order
      from platform_tasks
      where case_id = any($1::uuid[])
      order by case_id, sort_order asc, created_at asc
    `, [caseIds]),
    client.query(`
      select
        case_id::text as case_id,
        id::text as id,
        file_name,
        document_type,
        content_type,
        size_bytes,
        storage_path,
        uploaded_at::text as uploaded_at,
        verified_at::text as verified_at,
        metadata
      from case_documents
      where case_id = any($1::uuid[])
      order by uploaded_at desc
    `, [caseIds]),
    client.query(`
      select
        case_id::text as case_id,
        id::text as id,
        title,
        status,
        severity,
        assigned_to,
        owner_lane,
        due_date::text as due_date,
        escalate_at::text as escalate_at,
        notes,
        completed_at::text as completed_at,
        created_at::text as created_at,
        updated_at::text as updated_at
      from case_reminders
      where case_id = any($1::uuid[])
      order by created_at desc
    `, [caseIds]),
    client.query(`
      select
        case_id::text as case_id,
        id::text as id,
        actor_type,
        actor_label,
        event_type,
        metadata,
        created_at::text as created_at
      from case_activity
      where case_id = any($1::uuid[])
      order by created_at desc
    `, [caseIds])
  ]);

  const platformTasksByCase = new Map();
  const documentsByCase = new Map();
  const remindersByCase = new Map();
  const activityByCase = new Map();

  for (const row of platformTaskResult.rows) {
    const list = platformTasksByCase.get(row.case_id) || [];
    list.push(row);
    platformTasksByCase.set(row.case_id, list);
  }

  for (const row of documentResult.rows) {
    const list = documentsByCase.get(row.case_id) || [];
    list.push(row);
    documentsByCase.set(row.case_id, list);
  }

  for (const row of reminderResult.rows) {
    const list = remindersByCase.get(row.case_id) || [];
    list.push(row);
    remindersByCase.set(row.case_id, list);
  }

  for (const row of activityResult.rows) {
    const list = activityByCase.get(row.case_id) || [];
    list.push(row);
    activityByCase.set(row.case_id, list);
  }

  return rows.map((row) => {
    const base = mapDatabaseCase(row);
    const preferredOutcome = base.preferredOutcome || 'not_sure';
    const fallbackTimestamp = base.updatedAt || base.createdAt || new Date().toISOString();

    return {
      ...base,
      clientName: row.client_name || base.clientName || '',
      clientEmail: row.client_email || base.clientEmail || '',
      clientPhone: row.client_phone || base.clientPhone || '',
      relationshipToDeceased: row.customer_relationship_to_deceased || base.relationshipToDeceased || '',
      platformTasks: (platformTasksByCase.get(base.id) || []).map((entry, index) => (
        mapDatabasePlatformTask(entry, index, preferredOutcome, fallbackTimestamp)
      )),
      documents: (documentsByCase.get(base.id) || []).map(mapDatabaseDocument),
      reminders: (remindersByCase.get(base.id) || []).map((entry, index) => (
        mapDatabaseReminder(entry, index, fallbackTimestamp)
      )),
      activity: (activityByCase.get(base.id) || []).map(mapDatabaseActivity)
    };
  });
}

async function syncDatabaseCaseChildren(client, caseRecord) {
  await client.query('delete from platform_tasks where case_id = $1::uuid', [caseRecord.id]);
  await client.query('delete from case_documents where case_id = $1::uuid', [caseRecord.id]);
  await client.query('delete from case_reminders where case_id = $1::uuid', [caseRecord.id]);
  await client.query('delete from case_activity where case_id = $1::uuid', [caseRecord.id]);

  const preferredOutcome = caseRecord.preferredOutcome || 'not_sure';
  const timestamp = caseRecord.updatedAt || caseRecord.createdAt || new Date().toISOString();
  const storageProvider = getStorageMode() === 'blob' ? 'blob' : 'file';

  for (const [index, task] of ensureArray(caseRecord.platformTasks).entries()) {
    const normalized = normalizePlatformTask(task, index, preferredOutcome, timestamp);

    await client.query(`
      insert into platform_tasks (
        case_id,
        external_key,
        platform_name,
        profile_or_handle,
        status,
        outcome_requested,
        evidence_needed,
        notes,
        submission_reference,
        submitted_at,
        resolved_at,
        last_updated_at,
        sort_order
      ) values (
        $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9,
        nullif($10, '')::timestamptz,
        nullif($11, '')::timestamptz,
        nullif($12, '')::timestamptz,
        $13
      )
    `, [
      caseRecord.id,
      normalized.id,
      normalized.name,
      normalized.profileOrHandle || '',
      normalized.status,
      normalized.outcomeRequested || '',
      normalized.evidenceNeeded || '',
      normalized.notes || '',
      normalized.submissionReference || '',
      normalized.submittedAt || '',
      normalized.resolvedAt || '',
      normalized.lastUpdatedAt || timestamp,
      index
    ]);
  }

  for (const document of ensureArray(caseRecord.documents)) {
    await client.query(`
      insert into case_documents (
        id,
        case_id,
        file_name,
        document_type,
        content_type,
        size_bytes,
        storage_provider,
        storage_path,
        uploaded_by_actor,
        uploaded_at,
        verified_at,
        metadata
      ) values (
        $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9,
        $10::timestamptz,
        nullif($11, '')::timestamptz,
        $12::jsonb
      )
      on conflict (id) do update set
        file_name = excluded.file_name,
        document_type = excluded.document_type,
        content_type = excluded.content_type,
        size_bytes = excluded.size_bytes,
        storage_path = excluded.storage_path,
        uploaded_by_actor = excluded.uploaded_by_actor,
        uploaded_at = excluded.uploaded_at,
        verified_at = excluded.verified_at,
        metadata = excluded.metadata
    `, [
      document.id || crypto.randomUUID(),
      caseRecord.id,
      document.fileName || 'upload.bin',
      document.documentType || 'supporting_document',
      document.contentType || 'application/octet-stream',
      Number(document.size || 0),
      storageProvider,
      document.storagePath || '',
      document.uploadedByActor || 'public',
      document.uploadedAt || timestamp,
      document.verifiedAt || '',
      JSON.stringify(document.metadata || {})
    ]);
  }

  for (const [index, reminder] of ensureArray(caseRecord.reminders).entries()) {
    const normalized = normalizeReminder(reminder, index, timestamp);
    const reminderId = isUuidLike(normalized.id) ? normalized.id : crypto.randomUUID();

    await client.query(`
      insert into case_reminders (
        id,
        case_id,
        title,
        status,
        severity,
        assigned_to,
        owner_lane,
        due_date,
        escalate_at,
        notes,
        completed_at,
        created_at,
        updated_at
      ) values (
        $1::uuid, $2::uuid, $3, $4, $5, $6, $7,
        nullif($8, '')::date,
        nullif($9, '')::date,
        $10,
        nullif($11, '')::timestamptz,
        $12::timestamptz,
        $13::timestamptz
      )
      on conflict (id) do update set
        title = excluded.title,
        status = excluded.status,
        severity = excluded.severity,
        assigned_to = excluded.assigned_to,
        owner_lane = excluded.owner_lane,
        due_date = excluded.due_date,
        escalate_at = excluded.escalate_at,
        notes = excluded.notes,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at
    `, [
      reminderId,
      caseRecord.id,
      normalized.title,
      normalized.status,
      normalized.severity,
      normalized.assignedTo || '',
      normalized.ownerLane || '',
      normalized.dueDate || '',
      normalized.escalateAt || '',
      normalized.notes || '',
      normalized.completedAt || '',
      normalized.createdAt || timestamp,
      normalized.updatedAt || timestamp
    ]);
  }

  for (const activityEntry of ensureArray(caseRecord.activity)) {
    await client.query(`
      insert into case_activity (
        id,
        case_id,
        actor_type,
        actor_label,
        event_type,
        metadata,
        created_at
      ) values ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7::timestamptz)
      on conflict (id) do update set
        actor_type = excluded.actor_type,
        actor_label = excluded.actor_label,
        event_type = excluded.event_type,
        metadata = excluded.metadata,
        created_at = excluded.created_at
    `, [
      activityEntry.id || crypto.randomUUID(),
      caseRecord.id,
      trimTo(activityEntry.actor, 80) || 'system',
      trimTo(activityEntry.actorLabel, 160),
      trimTo(activityEntry.eventType, 120) || 'case_updated',
      JSON.stringify(activityEntry.metadata || {}),
      activityEntry.createdAt || timestamp
    ]);
  }
}

async function readCase(caseId) {
  if (hasDatabaseConnection()) {
    const result = await query(`
      select
        c.id::text as id,
        c.reference,
        c.deceased_name,
        c.preferred_outcome,
        c.case_details,
        c.relationship_to_deceased,
        c.urgency,
        c.selected_package,
        c.package_label,
        c.status,
        c.payment_status,
        c.priority,
        c.intake_source,
        c.referral_source,
        c.referral_partner_type,
        c.referral_partner_name,
        c.referral_partner_email,
        c.referral_partner_phone,
        c.referral_fee_status,
        c.referral_notes,
        c.assigned_to_name_snapshot,
        c.due_date::text as due_date,
        c.next_follow_up_at::text as next_follow_up_at,
        c.operator_lane,
        c.blocker_reason,
        c.authority_basis,
        c.document_notes,
        c.internal_notes,
        c.archived_at::text as archived_at,
        c.archived_by_name_snapshot,
        c.archive_reason,
        c.last_client_update_at::text as last_client_update_at,
        c.last_operator_action_at::text as last_operator_action_at,
        c.created_at::text as created_at,
        c.updated_at::text as updated_at,
        c.legacy_payload,
        customer.full_name as client_name,
        customer.email as client_email,
        customer.phone as client_phone,
        customer.relationship_to_deceased as customer_relationship_to_deceased
      from cases c
      inner join customers customer on customer.id = c.customer_id
      where c.id = $1::uuid
      limit 1
    `, [caseId]);

    const hydrated = await hydrateDatabaseCases(result.rows);
    return hydrated[0] || null;
  }

  if (getStorageMode() === 'blob') {
    return readBlobJson(getCaseBlobPath(caseId), null);
  }

  await ensureLocalDirs();
  return readJsonFile(getCaseFilePath(caseId), null);
}

function normalizeAdminDetailSections(input) {
  const sections = new Set(['core']);

  for (const section of ensureArray(input)) {
    const normalized = trimTo(section, 40).toLowerCase();
    if (normalized === 'workflow' || normalized === 'comms' || normalized === 'all') {
      sections.add(normalized);
    }
  }

  return Array.from(sections);
}

async function readDatabaseCaseBase(caseId) {
  const result = await query(`
    select
      c.id::text as id,
      c.reference,
      c.deceased_name,
      c.preferred_outcome,
      c.case_details,
      c.relationship_to_deceased,
      c.urgency,
      c.selected_package,
      c.package_label,
      c.status,
      c.payment_status,
      c.priority,
      c.intake_source,
      c.referral_source,
      c.referral_partner_type,
      c.referral_partner_name,
      c.referral_partner_email,
      c.referral_partner_phone,
      c.referral_fee_status,
      c.referral_notes,
      c.assigned_to_name_snapshot,
      c.due_date::text as due_date,
      c.next_follow_up_at::text as next_follow_up_at,
      c.operator_lane,
      c.blocker_reason,
      c.authority_basis,
      c.document_notes,
      c.internal_notes,
      c.archived_at::text as archived_at,
      c.archived_by_name_snapshot,
      c.archive_reason,
      c.last_client_update_at::text as last_client_update_at,
      c.last_operator_action_at::text as last_operator_action_at,
      c.created_at::text as created_at,
      c.updated_at::text as updated_at,
      c.legacy_payload,
      customer.full_name as client_name,
      customer.email as client_email,
      customer.phone as client_phone,
      customer.relationship_to_deceased as customer_relationship_to_deceased,
      read_model.platform_count,
      read_model.resolved_platform_count,
      read_model.blocked_platform_count,
      read_model.pending_submission_count,
      read_model.in_flight_platform_count,
      read_model.document_count,
      read_model.open_reminder_count,
      read_model.overdue_reminder_count,
      read_model.escalated_reminder_count
    from cases c
    inner join customers customer on customer.id = c.customer_id
    left join admin_case_read_model read_model on read_model.case_id = c.id
    where c.id = $1::uuid
    limit 1
  `, [caseId]);

  return mapDatabaseCase(result.rows[0]);
}

async function hydrateDatabaseCaseSections(caseRecord, sections, client = { query }) {
  const requested = new Set(normalizeAdminDetailSections(sections));
  const wantsWorkflow = requested.has('all') || requested.has('workflow');
  const wantsComms = requested.has('all') || requested.has('comms');

  if (!caseRecord || (!wantsWorkflow && !wantsComms)) {
    return caseRecord;
  }

  const caseIds = [caseRecord.id];
  const [platformTaskResult, reminderResult, documentResult, activityResult] = await Promise.all([
    wantsWorkflow
      ? client.query(`
        select
          case_id::text as case_id,
          id::text as id,
          external_key,
          platform_name,
          profile_or_handle,
          status,
          outcome_requested,
          evidence_needed,
          notes,
          submission_reference,
          submitted_at::text as submitted_at,
          resolved_at::text as resolved_at,
          last_updated_at::text as last_updated_at,
          sort_order
        from platform_tasks
        where case_id = any($1::uuid[])
        order by case_id, sort_order asc, created_at asc
      `, [caseIds])
      : Promise.resolve({ rows: [] }),
    wantsWorkflow
      ? client.query(`
        select
          case_id::text as case_id,
          id::text as id,
          title,
          status,
          severity,
          assigned_to,
          owner_lane,
          due_date::text as due_date,
          escalate_at::text as escalate_at,
          notes,
          completed_at::text as completed_at,
          created_at::text as created_at,
          updated_at::text as updated_at
        from case_reminders
        where case_id = any($1::uuid[])
        order by created_at desc
      `, [caseIds])
      : Promise.resolve({ rows: [] }),
    wantsComms
      ? client.query(`
        select
          case_id::text as case_id,
          id::text as id,
          file_name,
          document_type,
          content_type,
          size_bytes,
          storage_path,
          uploaded_at::text as uploaded_at,
          verified_at::text as verified_at,
          metadata
        from case_documents
        where case_id = any($1::uuid[])
        order by uploaded_at desc
      `, [caseIds])
      : Promise.resolve({ rows: [] }),
    wantsComms
      ? client.query(`
        select
          case_id::text as case_id,
          id::text as id,
          actor_type,
          actor_label,
          event_type,
          metadata,
          created_at::text as created_at
        from case_activity
        where case_id = any($1::uuid[])
        order by created_at desc
      `, [caseIds])
      : Promise.resolve({ rows: [] })
  ]);

  if (wantsWorkflow) {
    caseRecord.platformTasks = platformTaskResult.rows.map((entry, index) => (
      mapDatabasePlatformTask(entry, index, caseRecord.preferredOutcome, caseRecord.updatedAt || caseRecord.createdAt)
    ));
    caseRecord.reminders = reminderResult.rows.map((entry, index) => (
      mapDatabaseReminder(entry, index, caseRecord.updatedAt || caseRecord.createdAt)
    ));
  }

  if (wantsComms) {
    caseRecord.documents = documentResult.rows.map(mapDatabaseDocument);
    caseRecord.activity = activityResult.rows.map(mapDatabaseActivity);
  }

  return caseRecord;
}

async function writeCase(caseRecord) {
  const summary = normalizeCaseSummary(caseRecord);

  if (hasDatabaseConnection()) {
    await ensureAdminReadModelSchema();
    const packageConfig = PACKAGE_CONFIG[caseRecord.selectedPackage] || PACKAGE_CONFIG.standard;
    const publicTokenHash = crypto.createHash('sha256').update(String(caseRecord.publicToken || ''), 'utf8').digest('hex');
    const publicTokenHint = String(caseRecord.publicToken || '').slice(-6);

    await withTransaction(async (client) => {
      const customerResult = await client.query(`
        insert into customers (id, full_name, email, phone, relationship_to_deceased, created_at, updated_at)
        values (
          coalesce((select id from customers where email = $2 order by created_at asc limit 1), gen_random_uuid()),
          $1, $2, $3, $4, $5::timestamptz, $6::timestamptz
        )
        on conflict (email) do update set
          full_name = excluded.full_name,
          phone = excluded.phone,
          relationship_to_deceased = excluded.relationship_to_deceased,
          updated_at = excluded.updated_at
        returning id::text as id
      `, [
        caseRecord.clientName || '',
        caseRecord.clientEmail || '',
        caseRecord.clientPhone || '',
        caseRecord.relationshipToDeceased || '',
        caseRecord.createdAt,
        caseRecord.updatedAt
      ]);

      const customerId = customerResult.rows[0] && customerResult.rows[0].id;

      await client.query(`
        insert into cases (
          id,
          reference,
          public_token_hash,
          public_token_hint,
          customer_id,
          intake_source,
          referral_source,
          deceased_name,
          preferred_outcome,
          case_details,
          relationship_to_deceased,
          urgency,
          selected_package,
          package_label,
          package_price_gbp,
          package_target_days,
          status,
          payment_status,
          priority,
          assigned_to_name_snapshot,
          due_date,
          next_follow_up_at,
          operator_lane,
          blocker_reason,
          authority_basis,
          document_notes,
          internal_notes,
          referral_partner_type,
          referral_partner_name,
          referral_partner_email,
          referral_partner_phone,
          referral_fee_status,
          referral_notes,
          archived_at,
          archived_by_name_snapshot,
          archive_reason,
          last_client_update_at,
          last_operator_action_at,
          created_at,
          updated_at,
          legacy_payload
        )
        values (
          $1::uuid, $2, $3, $4, $5::uuid,
          $6, $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18, $19, $20,
          nullif($21, '')::date,
          nullif($22, '')::date,
          $23, $24, $25, $26, $27,
          $28, $29, $30, $31, $32, $33,
          nullif($34, '')::timestamptz,
          $35, $36,
          nullif($37, '')::timestamptz,
          nullif($38, '')::timestamptz,
          $39::timestamptz, $40::timestamptz, $41::jsonb
        )
        on conflict (id) do update set
          reference = excluded.reference,
          public_token_hash = excluded.public_token_hash,
          public_token_hint = excluded.public_token_hint,
          customer_id = excluded.customer_id,
          intake_source = excluded.intake_source,
          referral_source = excluded.referral_source,
          deceased_name = excluded.deceased_name,
          preferred_outcome = excluded.preferred_outcome,
          case_details = excluded.case_details,
          relationship_to_deceased = excluded.relationship_to_deceased,
          urgency = excluded.urgency,
          selected_package = excluded.selected_package,
          package_label = excluded.package_label,
          package_price_gbp = excluded.package_price_gbp,
          package_target_days = excluded.package_target_days,
          status = excluded.status,
          payment_status = excluded.payment_status,
          priority = excluded.priority,
          assigned_to_name_snapshot = excluded.assigned_to_name_snapshot,
          due_date = excluded.due_date,
          next_follow_up_at = excluded.next_follow_up_at,
          operator_lane = excluded.operator_lane,
          blocker_reason = excluded.blocker_reason,
          authority_basis = excluded.authority_basis,
          document_notes = excluded.document_notes,
          internal_notes = excluded.internal_notes,
          referral_partner_type = excluded.referral_partner_type,
          referral_partner_name = excluded.referral_partner_name,
          referral_partner_email = excluded.referral_partner_email,
          referral_partner_phone = excluded.referral_partner_phone,
          referral_fee_status = excluded.referral_fee_status,
          referral_notes = excluded.referral_notes,
          archived_at = excluded.archived_at,
          archived_by_name_snapshot = excluded.archived_by_name_snapshot,
          archive_reason = excluded.archive_reason,
          last_client_update_at = excluded.last_client_update_at,
          last_operator_action_at = excluded.last_operator_action_at,
          updated_at = excluded.updated_at,
          legacy_payload = excluded.legacy_payload
      `, [
        caseRecord.id,
        caseRecord.reference,
        publicTokenHash,
        publicTokenHint,
        customerId,
        caseRecord.intakeSource || 'website',
        caseRecord.referralSource || '',
        caseRecord.deceasedName || '',
        caseRecord.preferredOutcome || 'not_sure',
        caseRecord.caseDetails || '',
        caseRecord.relationshipToDeceased || '',
        caseRecord.urgency || 'standard',
        caseRecord.selectedPackage || 'standard',
        caseRecord.packageLabel || packageConfig.label,
        packageConfig.price,
        packageConfig.targetDays || 10,
        caseRecord.status || 'awaiting_payment',
        caseRecord.paymentStatus || 'pending',
        caseRecord.priority || 'standard',
        caseRecord.assignedTo || '',
        caseRecord.dueDate || '',
        caseRecord.nextFollowUpAt || '',
        caseRecord.operatorLane || '',
        caseRecord.blockerReason || '',
        caseRecord.authorityBasis || '',
        caseRecord.documentNotes || '',
        caseRecord.internalNotes || '',
        caseRecord.referralPartnerType || 'direct',
        caseRecord.referralPartnerName || '',
        caseRecord.referralPartnerEmail || '',
        caseRecord.referralPartnerPhone || '',
        caseRecord.referralFeeStatus || 'not_applicable',
        caseRecord.referralNotes || '',
        caseRecord.archivedAt || '',
        caseRecord.archivedBy || '',
        caseRecord.archiveReason || '',
        caseRecord.lastClientUpdateAt || '',
        caseRecord.lastOperatorActionAt || '',
        caseRecord.createdAt,
        caseRecord.updatedAt,
        JSON.stringify(caseRecord)
      ]);

      await syncDatabaseCaseChildren(client, caseRecord);
      await syncDatabaseCaseJobs(client, caseRecord);
      await syncAdminCaseReadModel(client, caseRecord);
    });

    return;
  }

  if (getStorageMode() === 'blob') {
    await writeBlobJson(getCaseBlobPath(caseRecord.id), caseRecord);
    return;
  }

  const index = await readIndex();
  const existingIndex = index.findIndex((entry) => entry.id === caseRecord.id);

  await ensureLocalDirs();
  await writeJsonFile(getCaseFilePath(caseRecord.id), caseRecord);

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

function buildAdminUpdateDiff(previousRecord, nextRecord) {
  const fields = [
    ['status', 'Status'],
    ['paymentStatus', 'Payment status'],
    ['assignedTo', 'Case owner'],
    ['priority', 'Priority'],
    ['dueDate', 'Due date'],
    ['nextFollowUpAt', 'Next follow-up'],
    ['operatorLane', 'Operator lane'],
    ['authorityBasis', 'Authority basis'],
    ['relationshipToDeceased', 'Relationship'],
    ['referralSource', 'Referral source'],
    ['referralPartnerName', 'Partner name'],
    ['blockerReason', 'Blocker reason']
  ];

  const diff = fields.reduce((items, [field, label]) => {
    const before = trimTo(previousRecord[field], 240);
    const after = trimTo(nextRecord[field], 240);

    if (before !== after) {
      items.push({ field, label, before, after });
    }

    return items;
  }, []);

  const platformBefore = ensureArray(previousRecord.platformTasks).length;
  const platformAfter = ensureArray(nextRecord.platformTasks).length;
  if (platformBefore !== platformAfter) {
    diff.push({ field: 'platformTasks', label: 'Platform tasks', before: String(platformBefore), after: String(platformAfter) });
  }

  const remindersBefore = ensureArray(previousRecord.reminders).length;
  const remindersAfter = ensureArray(nextRecord.reminders).length;
  if (remindersBefore !== remindersAfter) {
    diff.push({ field: 'reminders', label: 'Reminders', before: String(remindersBefore), after: String(remindersAfter) });
  }

  return diff;
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
    archivedAt: '',
    archivedBy: '',
    archiveReason: '',
    operatorLane: '',
    nextFollowUpAt: '',
    blockerReason: '',
    lastClientUpdateAt: createdAt,
    lastOperatorActionAt: '',
    authorityBasis: '',
    documentNotes: '',
    platformTasks,
    reminders: [],
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

async function getAdminCaseById(id, options = {}) {
  if (!id) {
    return null;
  }

  const sections = normalizeAdminDetailSections(options.sections);
  let caseRecord = null;

  if (hasDatabaseConnection()) {
    caseRecord = await readDatabaseCaseBase(id);

    if (caseRecord && (sections.includes('workflow') || sections.includes('comms') || sections.includes('all'))) {
      caseRecord = await hydrateDatabaseCaseSections(caseRecord, sections);
    }
  } else {
    caseRecord = await getCaseForAdmin(id);
  }

  if (!caseRecord) {
    return null;
  }

  const adminCase = buildAdminCase(caseRecord);
  adminCase._loadedSections = hasDatabaseConnection()
    ? sections
    : ['core', 'workflow', 'comms'];

  if (hasDatabaseConnection()) {
    if (!sections.includes('workflow') && !sections.includes('all')) {
      adminCase.platformTasks = [];
      adminCase.reminders = [];
    }

    if (!sections.includes('comms') && !sections.includes('all')) {
      adminCase.documents = [];
      adminCase.activity = [];
    }
  }

  return adminCase;
}

async function listAdminCaseSummaries() {
  if (hasDatabaseConnection()) {
    await ensureAdminReadModelSchema();
    let result = await query(`
      select
        case_id::text as id,
        reference,
        client_name,
        client_email,
        deceased_name,
        selected_package,
        package_label,
        relationship_to_deceased,
        assigned_to,
        priority,
        due_date::text as due_date,
        referral_partner_name,
        referral_fee_status,
        status,
        payment_status,
        platform_count,
        resolved_platform_count,
        blocked_platform_count,
        pending_submission_count,
        in_flight_platform_count,
        document_count,
        open_reminder_count,
        overdue_reminder_count,
        escalated_reminder_count,
        archived_at::text as archived_at,
        created_at::text as created_at,
        updated_at::text as updated_at,
        workflow_stage_label,
        workflow_queue_label,
        workflow_queue_key,
        workflow_waiting_on,
        workflow_service_target_date::text as workflow_service_target_date,
        workflow_follow_up_date::text as workflow_follow_up_date,
        workflow_health_status,
        workflow_progress_percent,
        workflow_needs_attention,
        workflow_overdue,
        workflow_open_reminder_count,
        workflow_escalated_reminder_count,
        workflow_recommended_lane,
        workflow_model_version
      from admin_case_read_model
      order by updated_at desc
    `);

    const needsReadModelRefresh = !result.rows.length || result.rows.some((row) => Number(row.workflow_model_version || 0) !== ADMIN_READ_MODEL_VERSION);

    if (needsReadModelRefresh) {
      const fullResult = await query(`
        select
          c.id::text as id,
          c.reference,
          c.deceased_name,
          c.preferred_outcome,
          c.case_details,
          c.relationship_to_deceased,
          c.urgency,
          c.selected_package,
          c.package_label,
          c.status,
          c.payment_status,
          c.priority,
          c.intake_source,
          c.referral_source,
          c.referral_partner_type,
          c.referral_partner_name,
          c.referral_partner_email,
          c.referral_partner_phone,
          c.referral_fee_status,
          c.referral_notes,
          c.assigned_to_name_snapshot,
          c.due_date::text as due_date,
          c.next_follow_up_at::text as next_follow_up_at,
          c.operator_lane,
          c.blocker_reason,
          c.authority_basis,
          c.document_notes,
          c.internal_notes,
          c.archived_at::text as archived_at,
          c.archived_by_name_snapshot,
          c.archive_reason,
          c.last_client_update_at::text as last_client_update_at,
          c.last_operator_action_at::text as last_operator_action_at,
          c.created_at::text as created_at,
          c.updated_at::text as updated_at,
          c.legacy_payload,
          customer.full_name as client_name,
          customer.email as client_email,
          customer.phone as client_phone,
          customer.relationship_to_deceased as customer_relationship_to_deceased
        from cases c
        inner join customers customer on customer.id = c.customer_id
        order by c.updated_at desc
      `);
      const hydrated = await hydrateDatabaseCases(fullResult.rows);

      if (hydrated.length) {
        await withTransaction(async (client) => {
          for (const caseRecord of hydrated) {
            await syncAdminCaseReadModel(client, caseRecord);
          }
        });
        result = await query(`
          select
            case_id::text as id,
            reference,
            client_name,
            client_email,
            deceased_name,
            selected_package,
            package_label,
            relationship_to_deceased,
            assigned_to,
            priority,
            due_date::text as due_date,
            referral_partner_name,
            referral_fee_status,
            status,
            payment_status,
            platform_count,
            resolved_platform_count,
            blocked_platform_count,
            pending_submission_count,
            in_flight_platform_count,
            document_count,
            open_reminder_count,
            overdue_reminder_count,
            escalated_reminder_count,
            archived_at::text as archived_at,
            created_at::text as created_at,
            updated_at::text as updated_at,
            workflow_stage_label,
            workflow_queue_label,
            workflow_queue_key,
            workflow_waiting_on,
            workflow_service_target_date::text as workflow_service_target_date,
            workflow_follow_up_date::text as workflow_follow_up_date,
            workflow_health_status,
            workflow_progress_percent,
            workflow_needs_attention,
            workflow_overdue,
            workflow_open_reminder_count,
            workflow_escalated_reminder_count,
            workflow_recommended_lane,
            workflow_model_version
          from admin_case_read_model
          order by updated_at desc
        `);
      }
    }

    return result.rows.map((row) => ({
      id: trimTo(row.id, 120),
      reference: row.reference || '',
      clientName: row.client_name || '',
      clientEmail: row.client_email || '',
      deceasedName: row.deceased_name || '',
      selectedPackage: row.selected_package || '',
      packageLabel: row.package_label || '',
      relationshipToDeceased: row.relationship_to_deceased || '',
      assignedTo: row.assigned_to || '',
      priority: row.priority || 'standard',
      dueDate: trimTo(row.due_date, 40),
      referralPartnerName: row.referral_partner_name || '',
      referralFeeStatus: row.referral_fee_status || 'not_applicable',
      status: row.status || '',
      paymentStatus: row.payment_status || '',
      platformCount: Number(row.platform_count || 0),
      resolvedPlatformCount: Number(row.resolved_platform_count || 0),
      documentCount: Number(row.document_count || 0),
      reminderCount: Number(row.open_reminder_count || 0),
      archivedAt: trimTo(row.archived_at, 80),
      createdAt: trimTo(row.created_at, 80),
      updatedAt: trimTo(row.updated_at, 80),
      workflow: {
        stageLabel: row.workflow_stage_label || '',
        queueLabel: row.workflow_queue_label || '',
        queueKey: row.workflow_queue_key || '',
        waitingOn: row.workflow_waiting_on || '',
        serviceTargetDate: trimTo(row.workflow_service_target_date, 40),
        followUpDate: trimTo(row.workflow_follow_up_date, 40),
        healthStatus: row.workflow_health_status || 'on_track',
        progressPercent: Number(row.workflow_progress_percent || 0),
        needsAttention: Boolean(row.workflow_needs_attention),
        overdue: Boolean(row.workflow_overdue),
        openReminderCount: Number(row.workflow_open_reminder_count || 0),
        escalatedReminderCount: Number(row.workflow_escalated_reminder_count || 0),
        recommendedLane: row.workflow_recommended_lane || ''
      }
    }));
  }

  const index = await readIndex();
  const cases = [];

  for (const entry of index) {
    const caseRecord = await readCase(entry.id);
    if (caseRecord) {
      cases.push(buildAdminCaseSummary(caseRecord));
    }
  }

  return cases.sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

async function listAdminCases() {
  if (hasDatabaseConnection()) {
    const result = await query(`
      select
        c.id::text as id,
        c.reference,
        c.deceased_name,
        c.preferred_outcome,
        c.case_details,
        c.relationship_to_deceased,
        c.urgency,
        c.selected_package,
        c.package_label,
        c.status,
        c.payment_status,
        c.priority,
        c.intake_source,
        c.referral_source,
        c.referral_partner_type,
        c.referral_partner_name,
        c.referral_partner_email,
        c.referral_partner_phone,
        c.referral_fee_status,
        c.referral_notes,
        c.assigned_to_name_snapshot,
        c.due_date::text as due_date,
        c.next_follow_up_at::text as next_follow_up_at,
        c.operator_lane,
        c.blocker_reason,
        c.authority_basis,
        c.document_notes,
        c.internal_notes,
        c.archived_at::text as archived_at,
        c.archived_by_name_snapshot,
        c.archive_reason,
        c.last_client_update_at::text as last_client_update_at,
        c.last_operator_action_at::text as last_operator_action_at,
        c.created_at::text as created_at,
        c.updated_at::text as updated_at,
        c.legacy_payload,
        customer.full_name as client_name,
        customer.email as client_email,
        customer.phone as client_phone,
        customer.relationship_to_deceased as customer_relationship_to_deceased
      from cases c
      inner join customers customer on customer.id = c.customer_id
      order by c.updated_at desc
    `);

    const hydrated = await hydrateDatabaseCases(result.rows);
    return hydrated.map(buildAdminCase);
  }

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

async function backfillAdminReadModel() {
  if (!hasDatabaseConnection()) {
    return { ok: false, updated: 0 };
  }

  await ensureAdminReadModelSchema();

  const result = await query(`
    select
      c.id::text as id,
      c.reference,
      c.deceased_name,
      c.preferred_outcome,
      c.case_details,
      c.relationship_to_deceased,
      c.urgency,
      c.selected_package,
      c.package_label,
      c.status,
      c.payment_status,
      c.priority,
      c.intake_source,
      c.referral_source,
      c.referral_partner_type,
      c.referral_partner_name,
      c.referral_partner_email,
      c.referral_partner_phone,
      c.referral_fee_status,
      c.referral_notes,
      c.assigned_to_name_snapshot,
      c.due_date::text as due_date,
      c.next_follow_up_at::text as next_follow_up_at,
      c.operator_lane,
      c.blocker_reason,
      c.authority_basis,
      c.document_notes,
      c.internal_notes,
      c.archived_at::text as archived_at,
      c.archived_by_name_snapshot,
      c.archive_reason,
      c.last_client_update_at::text as last_client_update_at,
      c.last_operator_action_at::text as last_operator_action_at,
      c.created_at::text as created_at,
      c.updated_at::text as updated_at,
      c.legacy_payload,
      customer.full_name as client_name,
      customer.email as client_email,
      customer.phone as client_phone,
      customer.relationship_to_deceased as customer_relationship_to_deceased
    from cases c
    inner join customers customer on customer.id = c.customer_id
    order by c.updated_at desc
  `);

  const hydrated = await hydrateDatabaseCases(result.rows);

  await withTransaction(async (client) => {
    for (const caseRecord of hydrated) {
      await syncAdminCaseReadModel(client, caseRecord);
    }
  });

  return { ok: true, updated: hydrated.length };
}

async function listCaseRecordsForMigration() {
  if (hasDatabaseConnection()) {
    const result = await query(`
      select
        c.id::text as id,
        c.reference,
        c.deceased_name,
        c.preferred_outcome,
        c.case_details,
        c.relationship_to_deceased,
        c.urgency,
        c.selected_package,
        c.package_label,
        c.status,
        c.payment_status,
        c.priority,
        c.intake_source,
        c.referral_source,
        c.referral_partner_type,
        c.referral_partner_name,
        c.referral_partner_email,
        c.referral_partner_phone,
        c.referral_fee_status,
        c.referral_notes,
        c.assigned_to_name_snapshot,
        c.due_date::text as due_date,
        c.next_follow_up_at::text as next_follow_up_at,
        c.operator_lane,
        c.blocker_reason,
        c.authority_basis,
        c.document_notes,
        c.internal_notes,
        c.archived_at::text as archived_at,
        c.archived_by_name_snapshot,
        c.archive_reason,
        c.last_client_update_at::text as last_client_update_at,
        c.last_operator_action_at::text as last_operator_action_at,
        c.created_at::text as created_at,
        c.updated_at::text as updated_at,
        c.legacy_payload,
        customer.full_name as client_name,
        customer.email as client_email,
        customer.phone as client_phone,
        customer.relationship_to_deceased as customer_relationship_to_deceased
      from cases c
      inner join customers customer on customer.id = c.customer_id
      order by c.created_at asc
    `);

    return hydrateDatabaseCases(result.rows);
  }

  const index = await readIndex();
  const cases = [];

  for (const entry of index) {
    const caseRecord = await readCase(entry.id);
    if (caseRecord) {
      cases.push(caseRecord);
    }
  }

  return cases.sort((left, right) => new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime());
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

    if (updates.activityEvent) {
      caseRecord.activity.unshift(createActivityEntry(updates.activityEvent, updates.activityMetadata, 'public'));
    }

    caseRecord.lastClientUpdateAt = updateStamp;

    return caseRecord;
  });
}

async function updateAdminCase(id, updates) {
  return updateCase(id, async (caseRecord) => {
    const previousRecord = JSON.parse(JSON.stringify(caseRecord));
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

    if (typeof updates.archiveReason === 'string') {
      caseRecord.archiveReason = trimTo(updates.archiveReason, 2000);
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

    if (Array.isArray(updates.reminders)) {
      caseRecord.reminders = updates.reminders
        .map((reminder, index) => normalizeReminder(reminder, index, new Date().toISOString()))
        .filter((reminder) => reminder.title);
    }

    if (updates.activityEvent) {
      caseRecord.activity.unshift(createActivityEntry(updates.activityEvent, updates.activityMetadata, 'admin'));
    } else {
      const diff = buildAdminUpdateDiff(previousRecord, caseRecord);
      if (diff.length) {
        caseRecord.activity.unshift(createActivityEntry('admin_case_updated', {
          diff
        }, 'admin'));
      }
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
  const eventRecord = {
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
  };

  if (hasDatabaseConnection()) {
    try {
      await query(`
        insert into analytics_events (
          id,
          session_id,
          case_id,
          event_type,
          path,
          label,
          page_title,
          referrer,
          metadata,
          created_at
        ) values ($1, $2, nullif($3, '')::uuid, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz)
        on conflict (id) do nothing
      `, [
        eventRecord.id,
        eventRecord.sessionId,
        eventRecord.caseId || '',
        eventRecord.eventType,
        eventRecord.path,
        eventRecord.label,
        eventRecord.pageTitle,
        eventRecord.referrer,
        JSON.stringify(eventRecord.metadata || {}),
        eventRecord.createdAt
      ]);
    } catch (error) {
      if (error && error.code === '23503') {
        await query(`
          insert into analytics_events (
            id,
            session_id,
            case_id,
            event_type,
            path,
            label,
            page_title,
            referrer,
            metadata,
            created_at
          ) values ($1, $2, null, $3, $4, $5, $6, $7, $8::jsonb, $9::timestamptz)
          on conflict (id) do nothing
        `, [
          eventRecord.id,
          eventRecord.sessionId,
          eventRecord.eventType,
          eventRecord.path,
          eventRecord.label,
          eventRecord.pageTitle,
          eventRecord.referrer,
          JSON.stringify(eventRecord.metadata || {}),
          eventRecord.createdAt
        ]);
      } else {
        throw error;
      }
    }

    return;
  }

  if (getStorageMode() === 'blob') {
    const stamp = eventRecord.createdAt.replace(/[:.]/g, '-');
    const blobPath = `${ANALYTICS_EVENTS_PREFIX}${stamp}-${eventRecord.id}.json`;
    await writeBlobJson(blobPath, eventRecord);
    return;
  }

  const events = await readAnalyticsEvents();
  events.unshift(eventRecord);

  await writeAnalyticsEvents(events);
}

function normalizeAnalyticsMetadata(event) {
  return event && event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
}

function normalizeAnalyticsDomain(value) {
  const source = trimTo(value, 240);

  if (!source) {
    return '';
  }

  try {
    return new URL(source).hostname.toLowerCase().replace(/^www\./, '');
  } catch (error) {
    return source.toLowerCase().replace(/^www\./, '');
  }
}

function normalizeAnalyticsPath(value) {
  const pathValue = trimTo(value, 240) || '/';
  return pathValue.startsWith('/') ? pathValue : `/${pathValue}`;
}

function determineAnalyticsSource(event) {
  const metadata = normalizeAnalyticsMetadata(event);
  const pathValue = normalizeAnalyticsPath(event.path);
  const referrerDomain = normalizeAnalyticsDomain(metadata.referrerDomain || event.referrer);
  const utmSource = trimTo(metadata.utmSource, 120).toLowerCase();
  const utmMedium = trimTo(metadata.utmMedium, 120).toLowerCase();
  const utmCampaign = trimTo(metadata.utmCampaign, 180);
  const sourceCategory = trimTo(metadata.sourceCategory, 80).toLowerCase();
  const explicitInternal = metadata.isInternalOperator === true;

  if (explicitInternal || pathValue.startsWith('/admin') || pathValue.startsWith('/studio')) {
    return {
      sourceGroup: 'internal',
      sourceLabel: 'Internal / operator',
      referrerDomain,
      utmCampaign
    };
  }

  if (utmSource) {
    if (/email|newsletter/.test(utmMedium)) {
      return {
        sourceGroup: 'email',
        sourceLabel: `${utmSource} / ${utmMedium || 'email'}`,
        referrerDomain,
        utmCampaign
      };
    }

    if (/cpc|ppc|paid|display|remarketing|affiliate/.test(utmMedium)) {
      return {
        sourceGroup: 'paid',
        sourceLabel: `${utmSource} / ${utmMedium || 'paid'}`,
        referrerDomain,
        utmCampaign
      };
    }

    if (/social/.test(utmMedium)) {
      return {
        sourceGroup: 'social',
        sourceLabel: `${utmSource} / ${utmMedium}`,
        referrerDomain,
        utmCampaign
      };
    }

    return {
      sourceGroup: sourceCategory || 'campaign',
      sourceLabel: `${utmSource}${utmMedium ? ` / ${utmMedium}` : ''}`,
      referrerDomain,
      utmCampaign
    };
  }

  if (sourceCategory === 'organic_search') {
    return {
      sourceGroup: 'organic_search',
      sourceLabel: referrerDomain ? `${referrerDomain} (organic)` : 'Organic search',
      referrerDomain,
      utmCampaign
    };
  }

  if (sourceCategory === 'social') {
    return {
      sourceGroup: 'social',
      sourceLabel: referrerDomain || 'Social',
      referrerDomain,
      utmCampaign
    };
  }

  if (sourceCategory === 'email') {
    return {
      sourceGroup: 'email',
      sourceLabel: referrerDomain || 'Email',
      referrerDomain,
      utmCampaign
    };
  }

  if (sourceCategory === 'paid') {
    return {
      sourceGroup: 'paid',
      sourceLabel: referrerDomain || 'Paid campaign',
      referrerDomain,
      utmCampaign
    };
  }

  if (!referrerDomain) {
    return {
      sourceGroup: 'direct',
      sourceLabel: 'Direct',
      referrerDomain: '',
      utmCampaign
    };
  }

  if (/google\.|bing\.|duckduckgo\.|yahoo\.|ecosia\.|startpage\.|search\.brave\.com/.test(referrerDomain)) {
    return {
      sourceGroup: 'organic_search',
      sourceLabel: `${referrerDomain} (organic)`,
      referrerDomain,
      utmCampaign
    };
  }

  if (/facebook\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|t\.co|reddit\.com|youtube\.com|tiktok\.com|pinterest\./.test(referrerDomain)) {
    return {
      sourceGroup: 'social',
      sourceLabel: referrerDomain,
      referrerDomain,
      utmCampaign
    };
  }

  if (/departed\.digital$/.test(referrerDomain)) {
    return {
      sourceGroup: 'internal',
      sourceLabel: 'Internal / onsite',
      referrerDomain,
      utmCampaign
    };
  }

  return {
    sourceGroup: 'referral',
    sourceLabel: referrerDomain,
    referrerDomain,
    utmCampaign
  };
}

function incrementMapCounter(map, key) {
  if (!key) {
    return;
  }

  map.set(key, (map.get(key) || 0) + 1);
}

function mapToTopEntries(map, keyName, limit = 6) {
  return Array.from(map.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([key, count]) => ({ [keyName]: key, count }));
}

async function getAnalyticsSummary() {
  const events = await readAnalyticsEvents();
  const sessions = new Set();
  const visitors = new Set();
  const pathCounts = new Map();
  const labelCounts = new Map();
  const sourceCounts = new Map();
  const referrerCounts = new Map();
  const campaignCounts = new Map();
  const landingPageCounts = new Map();
  const sessionRecords = new Map();

  for (const event of events) {
    const metadata = normalizeAnalyticsMetadata(event);

    if (event.sessionId) {
      sessions.add(event.sessionId);
    }

    if (metadata.visitorId) {
      visitors.add(trimTo(metadata.visitorId, 120));
    }

    if (event.path && (event.eventType === 'page_view' || event.eventType === 'article_view')) {
      pathCounts.set(event.path, (pathCounts.get(event.path) || 0) + 1);
    }

    if (event.label && (event.eventType === 'cta_click' || event.eventType === 'payment_cta_clicked' || event.eventType === 'partner_lead_submitted' || event.eventType === 'intake_submitted')) {
      labelCounts.set(event.label, (labelCounts.get(event.label) || 0) + 1);
    }

    if (event.sessionId) {
      const existing = sessionRecords.get(event.sessionId);
      const createdAt = trimTo(event.createdAt, 80);

      if (!existing) {
        sessionRecords.set(event.sessionId, {
          id: event.sessionId,
          firstEvent: event,
          firstAt: createdAt
        });
      } else if (createdAt && (!existing.firstAt || new Date(createdAt).getTime() < new Date(existing.firstAt).getTime())) {
        existing.firstEvent = event;
        existing.firstAt = createdAt;
      }
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
  const partnerLeads = events.filter((event) => event.eventType === 'partner_lead_submitted').length;
  const sessionList = Array.from(sessionRecords.values());
  const anonymousLegacySessions = sessionList.filter((entry) => {
    const metadata = normalizeAnalyticsMetadata(entry.firstEvent);
    return !trimTo(metadata.visitorId, 120);
  }).length;
  let internalSessions = 0;
  let publicSessions = 0;
  let directSessions = 0;
  let searchSessions = 0;
  let socialSessions = 0;
  let referralSessions = 0;
  let campaignSessions = 0;

  for (const sessionRecord of sessionList) {
    const source = determineAnalyticsSource(sessionRecord.firstEvent);
    incrementMapCounter(sourceCounts, source.sourceLabel);
    incrementMapCounter(referrerCounts, source.referrerDomain);
    incrementMapCounter(campaignCounts, source.utmCampaign);
    incrementMapCounter(landingPageCounts, normalizeAnalyticsPath(sessionRecord.firstEvent && sessionRecord.firstEvent.path));

    if (source.sourceGroup === 'internal') {
      internalSessions += 1;
    } else {
      publicSessions += 1;
    }

    if (source.sourceGroup === 'direct') {
      directSessions += 1;
    } else if (source.sourceGroup === 'organic_search') {
      searchSessions += 1;
    } else if (source.sourceGroup === 'social') {
      socialSessions += 1;
    } else if (source.sourceGroup === 'referral') {
      referralSessions += 1;
    } else if (source.sourceGroup === 'paid' || source.sourceGroup === 'campaign' || source.sourceGroup === 'email') {
      campaignSessions += 1;
    }
  }

  return {
    totalEvents: events.length,
    uniqueSessions: sessions.size,
    uniqueVisitors: visitors.size + anonymousLegacySessions,
    pageViews,
    ctaClicks,
    articleViews,
    intakeStarts,
    intakeSubmits,
    paymentClicks,
    partnerLeads,
    topPages,
    topClicks,
    topSources: mapToTopEntries(sourceCounts, 'source'),
    topReferrers: mapToTopEntries(referrerCounts, 'domain'),
    topCampaigns: mapToTopEntries(campaignCounts, 'campaign'),
    topLandingPages: mapToTopEntries(landingPageCounts, 'path'),
    trafficBreakdown: {
      publicSessions,
      internalSessions,
      directSessions,
      searchSessions,
      socialSessions,
      referralSessions,
      campaignSessions
    },
    latestEvents: events.slice(0, 12)
  };
}

async function listAnalyticsEventsForMigration() {
  return readAnalyticsEvents();
}

async function getAnalyticsOverview() {
  if (hasDatabaseConnection()) {
    const result = await query(`
      select
        count(*)::int as total_events,
        count(*) filter (where event_type = 'page_view')::int as page_views,
        count(*) filter (where event_type = 'cta_click')::int as cta_clicks,
        count(*) filter (where event_type = 'article_view')::int as article_views,
        count(*) filter (where event_type = 'intake_started')::int as intake_starts,
        count(*) filter (where event_type = 'intake_submitted')::int as intake_submits,
        count(*) filter (where event_type = 'payment_cta_clicked')::int as payment_clicks,
        count(*) filter (where event_type = 'partner_lead_submitted')::int as partner_leads,
        count(distinct session_id)::int as unique_sessions,
        count(distinct coalesce(nullif(metadata->>'visitorId', ''), 'legacy:' || session_id))::int as unique_visitors
      from analytics_events
    `);

    const row = result.rows[0] || {};
    return {
      totalEvents: Number(row.total_events || 0),
      uniqueSessions: Number(row.unique_sessions || 0),
      uniqueVisitors: Number(row.unique_visitors || 0),
      pageViews: Number(row.page_views || 0),
      ctaClicks: Number(row.cta_clicks || 0),
      articleViews: Number(row.article_views || 0),
      intakeStarts: Number(row.intake_starts || 0),
      intakeSubmits: Number(row.intake_submits || 0),
      paymentClicks: Number(row.payment_clicks || 0),
      partnerLeads: Number(row.partner_leads || 0),
      topPages: [],
      topClicks: [],
      topSources: [],
      topReferrers: [],
      topCampaigns: [],
      topLandingPages: [],
      trafficBreakdown: {
        publicSessions: 0,
        internalSessions: 0,
        directSessions: 0,
        searchSessions: 0,
        socialSessions: 0,
        referralSessions: 0,
        campaignSessions: 0
      },
      latestEvents: []
    };
  }

  return getAnalyticsSummary();
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

  if (caseRecord.paymentStatus !== 'paid') {
    throw new PaymentRequiredError('Supporting documents can only be uploaded after payment is confirmed.');
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

    if (existingCase.paymentStatus !== 'paid') {
      throw new PaymentRequiredError('Supporting documents can only be uploaded after payment is confirmed.');
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

async function getOpsJobSummary() {
  if (!hasDatabaseConnection()) {
    return {
      queued: 0,
      dueNow: 0,
      failed: 0
    };
  }

  const result = await query(`
    select
      count(*) filter (where status = 'queued')::int as queued,
      count(*) filter (where status = 'queued' and run_at <= now())::int as due_now,
      count(*) filter (where status = 'failed')::int as failed
    from ops_jobs
  `);

  const row = result.rows[0] || {};

  return {
    queued: Number(row.queued || 0),
    dueNow: Number(row.due_now || 0),
    failed: Number(row.failed || 0)
  };
}

async function listPartnerAccounts() {
  if (!hasDatabaseConnection()) {
    return [];
  }

  const result = await query(`
    select
      id::text as id,
      partner_type,
      business_name,
      primary_contact_name,
      email,
      phone,
      referral_fee_gbp::text as referral_fee_gbp,
      status,
      notes,
      created_at::text as created_at,
      updated_at::text as updated_at
    from partner_accounts
    order by updated_at desc, created_at desc
  `);

  return result.rows.map((row) => ({
    id: trimTo(row.id, 120),
    partnerType: trimTo(row.partner_type, 80) || 'direct',
    businessName: row.business_name || '',
    primaryContactName: row.primary_contact_name || '',
    email: row.email || '',
    phone: row.phone || '',
    referralFeeGbp: Number(row.referral_fee_gbp || 0),
    status: row.status || 'prospect',
    notes: row.notes || '',
    createdAt: trimTo(row.created_at, 80),
    updatedAt: trimTo(row.updated_at, 80)
  }));
}

async function archiveAdminCase(id, actor = 'admin', reason = '') {
  return updateCase(id, async (caseRecord) => {
    const archivedAt = new Date().toISOString();
    caseRecord.archivedAt = archivedAt;
    caseRecord.archivedBy = trimTo(actor, 160) || 'admin';
    caseRecord.archiveReason = trimTo(reason, 2000);
    caseRecord.nextFollowUpAt = '';
    caseRecord.activity.unshift(createActivityEntry('case_archived', {
      archivedBy: caseRecord.archivedBy,
      archiveReason: caseRecord.archiveReason
    }, 'admin'));
    caseRecord.lastOperatorActionAt = archivedAt;
    return caseRecord;
  });
}

async function restoreAdminCase(id, actor = 'admin') {
  return updateCase(id, async (caseRecord) => {
    const restoredAt = new Date().toISOString();
    const previousArchivedAt = caseRecord.archivedAt || '';
    caseRecord.archivedAt = '';
    caseRecord.archivedBy = '';
    caseRecord.archiveReason = '';
    caseRecord.activity.unshift(createActivityEntry('case_restored', {
      restoredBy: trimTo(actor, 160) || 'admin',
      previousArchivedAt
    }, 'admin'));
    caseRecord.lastOperatorActionAt = restoredAt;
    return caseRecord;
  });
}

async function deleteCase(id, actor = 'admin') {
  assertWritableStore();

  const caseRecord = await readCase(id);

  if (!caseRecord) {
    return null;
  }

  if (hasDatabaseConnection()) {
    await query('delete from cases where id = $1', [id]);

    if (getStorageMode() === 'blob') {
      const response = await list({ prefix: `documents/${id}/` });
      const documentPaths = response.blobs.map((entry) => entry.pathname).filter(Boolean);

      if (documentPaths.length) {
        await del(documentPaths);
      }
    } else {
      await fs.rm(path.join(DOCUMENTS_DIR, id), { recursive: true, force: true });
    }

    return {
      ...buildAdminCase(caseRecord),
      deletedBy: trimTo(actor, 160) || 'admin'
    };
  }

  if (getStorageMode() === 'blob') {
    await del(getCaseBlobPath(id));
    const response = await list({ prefix: `documents/${id}/` });
    const documentPaths = response.blobs.map((entry) => entry.pathname).filter(Boolean);

    if (documentPaths.length) {
      await del(documentPaths);
    }
  } else {
    await fs.rm(getCaseFilePath(id), { force: true });
    await fs.rm(path.join(DOCUMENTS_DIR, id), { recursive: true, force: true });
  }

  if (getStorageMode() !== 'blob') {
    const index = await readIndex();
    const nextIndex = index.filter((entry) => entry.id !== id);
    await writeIndex(nextIndex);
  }

  return {
    ...buildAdminCase(caseRecord),
    deletedBy: trimTo(actor, 160) || 'admin'
  };
}

async function getAdminCaseDocumentAsset(caseId, documentId) {
  const caseRecord = await getCaseForAdmin(caseId);

  if (!caseRecord) {
    return null;
  }

  const document = ensureArray(caseRecord.documents).find((entry) => entry.id === documentId);

  if (!document) {
    return null;
  }

  if (getStorageMode() === 'blob') {
    const response = await get(document.storagePath, { access: 'private' });

    if (!response || response.statusCode !== 200 || !response.stream) {
      return null;
    }

    const arrayBuffer = await new Response(response.stream).arrayBuffer();
    return {
      caseRecord,
      document,
      buffer: Buffer.from(arrayBuffer),
      contentType: document.contentType || 'application/octet-stream',
      fileName: document.fileName || `${document.id}.bin`
    };
  }

  const buffer = await fs.readFile(document.storagePath);
  return {
    caseRecord,
    document,
    buffer,
    contentType: document.contentType || 'application/octet-stream',
    fileName: document.fileName || `${document.id}.bin`
  };
}

module.exports = {
  PaymentRequiredError,
  StoreConfigurationError,
  archiveAdminCase,
  backfillAdminReadModel,
  buildAdminCase,
  buildAdminCaseSummary,
  buildPublicCase,
  createCase,
  deleteCase,
  getAdminCaseById,
  getAdminCaseDocumentAsset,
  getAnalyticsOverview,
  getCaseForAdmin,
  getAnalyticsSummary,
  getCaseForPublic,
  getDocumentInventory,
  getOpsJobSummary,
  getStorageHealth,
  listPartnerAccounts,
  listAnalyticsEventsForMigration,
  listAdminCases,
  listAdminCaseSummaries,
  listCaseRecordsForMigration,
  recordAnalyticsEvent,
  recordEvent,
  restoreAdminCase,
  updateAdminCase,
  updatePublicCase,
  uploadDocuments
};
