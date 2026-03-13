const PACKAGE_CONFIG = {
  essential: {
    key: 'essential',
    label: 'Essential',
    price: 149,
    priceLabel: '£149',
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

const MAX_DOCUMENT_COUNT = 6;
const MAX_DOCUMENT_SIZE_BYTES = 4 * 1024 * 1024;

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
    }
  };
}

module.exports = {
  CASE_STATUSES,
  MAX_DOCUMENT_COUNT,
  MAX_DOCUMENT_SIZE_BYTES,
  PACKAGE_CONFIG,
  PAYMENT_STATUSES,
  TRUST_SIGNALS,
  getPublicConfig
};
