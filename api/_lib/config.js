const PACKAGE_CONFIG = {
  essential: {
    key: 'essential',
    label: 'Essential',
    price: 149,
    priceLabel: '£149',
    targetDays: 14,
    platformsLabel: '2 platforms',
    turnaroundLabel: '14 day target',
    features: [
      'Up to 2 platforms',
      'Removal or memorialisation where available',
      'Document checklist before submissions begin',
      'Written completion summary'
    ]
  },
  standard: {
    key: 'standard',
    label: 'Standard',
    price: 249,
    priceLabel: '£249',
    targetDays: 10,
    platformsLabel: '5 platforms',
    turnaroundLabel: '10 day target',
    features: [
      'Up to 5 platforms',
      'Social, email, and key digital accounts',
      'Priority platform follow-up',
      'Structured written case summary'
    ]
  },
  estate: {
    key: 'estate',
    label: 'Estate',
    price: 399,
    priceLabel: '£399',
    targetDays: 7,
    platformsLabel: 'Unlimited platforms',
    turnaroundLabel: '7 day target',
    features: [
      'Unlimited platforms',
      'Complex estate and executor support',
      'Priority handling throughout',
      'Legal-grade documentation pack'
    ]
  }
};

const TRUST_SIGNALS = [
  'UK-based support for bereaved families',
  'No passwords required',
  'Written case record provided',
  'Used by families and funeral director partners'
];

const CASE_STATUSES = [
  'awaiting_payment',
  'paid',
  'awaiting_documents',
  'documents_received',
  'active',
  'submitted',
  'completed',
  'blocked'
];

const PAYMENT_STATUSES = [
  'pending',
  'payment_link_sent',
  'paid',
  'refunded'
];

const CASE_PRIORITIES = [
  'standard',
  'priority',
  'urgent'
];

const REFERRAL_FEE_STATUSES = [
  'not_applicable',
  'pending',
  'approved',
  'paid'
];

const PLATFORM_STATUSES = [
  'not_started',
  'queued',
  'submitted',
  'waiting',
  'resolved',
  'blocked'
];

const REMINDER_STATUSES = [
  'open',
  'done',
  'dismissed'
];

const REMINDER_SEVERITIES = [
  'normal',
  'priority',
  'urgent'
];

const ADMIN_ROLES = [
  'founder_admin',
  'case_manager',
  'document_specialist',
  'partner_manager',
  'read_only'
];

const ADMIN_ROLE_PERMISSIONS = {
  founder_admin: [
    'dashboard.view',
    'cases.write',
    'cases.archive',
    'cases.delete',
    'users.manage',
    'notifications.send'
  ],
  case_manager: [
    'dashboard.view',
    'cases.write',
    'cases.archive',
    'notifications.send'
  ],
  document_specialist: [
    'dashboard.view',
    'cases.write',
    'notifications.send'
  ],
  partner_manager: [
    'dashboard.view',
    'cases.write',
    'notifications.send'
  ],
  read_only: [
    'dashboard.view'
  ]
};

const MAX_DOCUMENT_COUNT = 6;
const MAX_DOCUMENT_SIZE_BYTES = 4 * 1024 * 1024;
const MAX_ANALYTICS_EVENTS = 5000;
const ADMIN_ENTRY_PATH = '/studio';

function getPublicConfig() {
  return {
    packages: Object.values(PACKAGE_CONFIG),
    paymentLinks: {
      essential: process.env.STRIPE_PAYMENT_LINK_ESSENTIAL || '',
      standard: process.env.STRIPE_PAYMENT_LINK_STANDARD || '',
      estate: process.env.STRIPE_PAYMENT_LINK_ESTATE || ''
    },
    trustSignals: TRUST_SIGNALS,
    limits: {
      maxDocumentCount: MAX_DOCUMENT_COUNT,
      maxDocumentSizeBytes: MAX_DOCUMENT_SIZE_BYTES
    },
    analytics: {
      endpoint: '/api/analytics'
    },
    management: {
      hiddenEntryPath: ADMIN_ENTRY_PATH
    }
  };
}

module.exports = {
  ADMIN_ENTRY_PATH,
  ADMIN_ROLES,
  ADMIN_ROLE_PERMISSIONS,
  CASE_PRIORITIES,
  CASE_STATUSES,
  MAX_ANALYTICS_EVENTS,
  MAX_DOCUMENT_COUNT,
  MAX_DOCUMENT_SIZE_BYTES,
  PACKAGE_CONFIG,
  PAYMENT_STATUSES,
  PLATFORM_STATUSES,
  REMINDER_SEVERITIES,
  REMINDER_STATUSES,
  REFERRAL_FEE_STATUSES,
  TRUST_SIGNALS,
  getPublicConfig
};
