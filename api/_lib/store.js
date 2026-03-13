const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { get, list, put } = require('@vercel/blob');

const {
  CASE_STATUSES,
  MAX_ANALYTICS_EVENTS,
  PACKAGE_CONFIG,
  PAYMENT_STATUSES
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

function normalizeCaseSummary(caseRecord) {
  return {
    id: caseRecord.id,
    reference: caseRecord.reference,
    clientName: caseRecord.clientName,
    clientEmail: caseRecord.clientEmail,
    deceasedName: caseRecord.deceasedName,
    selectedPackage: caseRecord.selectedPackage,
    packageLabel: caseRecord.packageLabel,
    relationshipToDeceased: caseRecord.relationshipToDeceased || '',
    status: caseRecord.status,
    paymentStatus: caseRecord.paymentStatus,
    documentCount: ensureArray(caseRecord.documents).length,
    createdAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt
  };
}

function buildPublicCase(caseRecord) {
  const operational = buildOperationalKit(caseRecord);

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
    authorityBasis: caseRecord.authorityBasis || '',
    documentNotes: caseRecord.documentNotes || '',
    documents: ensureArray(caseRecord.documents).map((document) => ({
      id: document.id,
      fileName: document.fileName,
      documentType: document.documentType,
      size: document.size,
      uploadedAt: document.uploadedAt
    })),
    operational,
    createdAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt
  };
}

function buildAdminCase(caseRecord) {
  return {
    ...buildPublicCase(caseRecord),
    publicToken: caseRecord.publicToken,
    caseLinks: {
      payment: `/payment?case=${caseRecord.id}&token=${caseRecord.publicToken}&package=${caseRecord.selectedPackage}`,
      documents: `/documents?case=${caseRecord.id}&token=${caseRecord.publicToken}`
    },
    intakeSource: caseRecord.intakeSource,
    referralSource: caseRecord.referralSource,
    internalNotes: caseRecord.internalNotes || '',
    activity: ensureArray(caseRecord.activity)
  };
}

function buildOperationalKit(caseRecord) {
  const knownPlatforms = formatList(caseRecord.knownPlatforms);
  const profileUrls = formatList(caseRecord.profileUrls);
  const documentCount = ensureArray(caseRecord.documents).length;
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

  const agentChecklist = [
    `Case reference: ${caseRecord.reference}`,
    `Selected package: ${caseRecord.packageLabel}`,
    `Preferred outcome: ${toTitle(caseRecord.preferredOutcome || 'not_sure')}`,
    knownPlatforms.length ? `Known platforms: ${knownPlatforms.join(', ')}` : 'Known platforms still need to be confirmed.',
    profileUrls.length ? `Known profiles/handles: ${profileUrls.join(', ')}` : 'No profile URLs or handles are recorded yet.',
    `Next best action: ${nextBestAction}`
  ];

  const agentSummary = [
    `Departed Digital case ${caseRecord.reference}.`,
    `Client: ${caseRecord.clientName} (${caseRecord.clientEmail}).`,
    `Deceased: ${caseRecord.deceasedName}.`,
    `Relationship: ${caseRecord.relationshipToDeceased || 'Not supplied yet'}.`,
    `Package: ${caseRecord.packageLabel}.`,
    `Outcome requested: ${toTitle(caseRecord.preferredOutcome || 'not_sure')}.`,
    knownPlatforms.length ? `Platforms: ${knownPlatforms.join(', ')}.` : 'Platforms: still to be confirmed.',
    profileUrls.length ? `Profiles or handles: ${profileUrls.join(', ')}.` : 'Profiles or handles: not yet supplied.',
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
    '',
    nextBestAction,
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
    caseRecord.caseDetails ? `Case notes: ${caseRecord.caseDetails}` : 'Case notes: none recorded yet',
    `Supporting documents received: ${documentCount}`
  ].join('\n');

  return {
    nextBestAction,
    missingItems,
    knownPlatformsList: knownPlatforms,
    profileUrlsList: profileUrls,
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
    intakeSource: input.intakeSource || 'website',
    referralSource: input.referralSource || '',
    authorityBasis: '',
    documentNotes: '',
    documents: [],
    internalNotes: '',
    activity: [
      createActivityEntry('case_created', {
        selectedPackage,
        intakeSource: input.intakeSource || 'website'
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

    if (updates.selectedPackage && PACKAGE_CONFIG[updates.selectedPackage]) {
      caseRecord.selectedPackage = updates.selectedPackage;
      caseRecord.packageLabel = PACKAGE_CONFIG[updates.selectedPackage].label;
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

    if (updates.paymentStatus && PAYMENT_STATUSES.includes(updates.paymentStatus)) {
      caseRecord.paymentStatus = updates.paymentStatus;
    }

    if (updates.status && CASE_STATUSES.includes(updates.status)) {
      caseRecord.status = updates.status;
    }

    if (updates.activityEvent) {
      caseRecord.activity.unshift(createActivityEntry(updates.activityEvent, updates.activityMetadata, 'public'));
    }

    return caseRecord;
  });
}

async function updateAdminCase(id, updates) {
  return updateCase(id, async (caseRecord) => {
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

    if (updates.activityEvent) {
      caseRecord.activity.unshift(createActivityEntry(updates.activityEvent, updates.activityMetadata, 'admin'));
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
