const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { get, list, put } = require('@vercel/blob');

const { CASE_STATUSES, PACKAGE_CONFIG, PAYMENT_STATUSES } = require('./config');

const DATA_ROOT = process.env.DEPARTED_DATA_ROOT
  ? path.resolve(process.env.DEPARTED_DATA_ROOT)
  : path.join(process.cwd(), 'data');
const CASES_DIR = path.join(DATA_ROOT, 'cases');
const DOCUMENTS_DIR = path.join(DATA_ROOT, 'documents');
const INDEX_FILE = path.join(DATA_ROOT, 'meta', 'cases-index.json');
const INDEX_BLOB_PATH = 'meta/cases-index.json';

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
    status: caseRecord.status,
    paymentStatus: caseRecord.paymentStatus,
    documentCount: ensureArray(caseRecord.documents).length,
    createdAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt
  };
}

function buildPublicCase(caseRecord) {
  return {
    id: caseRecord.id,
    reference: caseRecord.reference,
    clientName: caseRecord.clientName,
    clientEmail: caseRecord.clientEmail,
    deceasedName: caseRecord.deceasedName,
    preferredOutcome: caseRecord.preferredOutcome,
    caseDetails: caseRecord.caseDetails,
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
    createdAt: caseRecord.createdAt,
    updatedAt: caseRecord.updatedAt
  };
}

function buildAdminCase(caseRecord) {
  return {
    ...buildPublicCase(caseRecord),
    intakeSource: caseRecord.intakeSource,
    referralSource: caseRecord.referralSource,
    internalNotes: caseRecord.internalNotes || '',
    activity: ensureArray(caseRecord.activity)
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
  const response = await get(blobPath, { access: 'private' });

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
  getCaseForPublic,
  getDocumentInventory,
  getStorageHealth,
  listAdminCases,
  recordEvent,
  updateAdminCase,
  updatePublicCase,
  uploadDocuments
};
