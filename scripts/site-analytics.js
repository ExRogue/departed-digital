(function () {
  const SESSION_STORAGE_KEY = 'departedDigitalAnalyticsSession';
  const VISITOR_STORAGE_KEY = 'departedDigitalVisitorId';
  const OPERATOR_STORAGE_KEY = 'departedDigitalOperatorBrowser';
  const SESSION_TTL_MS = 30 * 60 * 1000;
  const endpoint = '/api/analytics';
  const dataAttribute = 'track';
  const labelAttribute = 'trackLabel';

  function makeId(prefix) {
    return prefix + '-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function safeRead(storage, key) {
    try {
      return storage.getItem(key);
    } catch (error) {
      return '';
    }
  }

  function safeWrite(storage, key, value) {
    try {
      storage.setItem(key, value);
    } catch (error) {
      // Ignore storage errors.
    }
  }

  function ensureVisitorId() {
    let value = safeRead(localStorage, VISITOR_STORAGE_KEY);

    if (!value) {
      value = makeId('ddv');
      safeWrite(localStorage, VISITOR_STORAGE_KEY, value);
    }

    return value;
  }

  function normalizeDomain(value) {
    try {
      return value ? new URL(value).hostname.replace(/^www\./, '').toLowerCase() : '';
    } catch (error) {
      return '';
    }
  }

  function inferSourceCategory(referrerDomain, utmMedium) {
    const medium = String(utmMedium || '').trim().toLowerCase();
    const domain = String(referrerDomain || '').trim().toLowerCase();

    if (medium) {
      if (/email|newsletter/.test(medium)) {
        return 'email';
      }

      if (/cpc|ppc|paid|display|remarketing|affiliate/.test(medium)) {
        return 'paid';
      }

      if (/social|organic_social|paid_social/.test(medium)) {
        return 'social';
      }

      return 'campaign';
    }

    if (!domain) {
      return 'direct';
    }

    if (/google\.|bing\.|duckduckgo\.|yahoo\.|ecosia\.|startpage\.|search\.brave\.com/.test(domain)) {
      return 'organic_search';
    }

    if (/facebook\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|t\.co|reddit\.com|youtube\.com|tiktok\.com|pinterest\./.test(domain)) {
      return 'social';
    }

    if (domain === window.location.hostname.replace(/^www\./, '').toLowerCase()) {
      return 'internal';
    }

    return 'referral';
  }

  function getAttributionSnapshot() {
    const url = new URL(window.location.href);
    const referrer = document.referrer || '';
    const referrerDomain = normalizeDomain(referrer);
    const utmSource = url.searchParams.get('utm_source') || '';
    const utmMedium = url.searchParams.get('utm_medium') || '';
    const utmCampaign = url.searchParams.get('utm_campaign') || '';
    const utmTerm = url.searchParams.get('utm_term') || '';
    const utmContent = url.searchParams.get('utm_content') || '';
    const sourceCategory = inferSourceCategory(referrerDomain, utmMedium);
    const sourceLabel = utmSource
      ? utmSource + (utmMedium ? ' / ' + utmMedium : '')
      : (referrerDomain || 'Direct');

    return {
      sourceCategory: sourceCategory,
      sourceLabel: sourceLabel,
      referrerDomain: referrerDomain,
      utmSource: utmSource,
      utmMedium: utmMedium,
      utmCampaign: utmCampaign,
      utmTerm: utmTerm,
      utmContent: utmContent
    };
  }

  function ensureSession() {
    const now = Date.now();
    const visitorId = ensureVisitorId();
    const existingRaw = safeRead(sessionStorage, SESSION_STORAGE_KEY);
    let existing = null;

    if (existingRaw) {
      try {
        existing = JSON.parse(existingRaw);
      } catch (error) {
        existing = null;
      }
    }

    if (existing && existing.id && existing.lastSeenAt && (now - Number(existing.lastSeenAt) < SESSION_TTL_MS)) {
      existing.lastSeenAt = now;
      safeWrite(sessionStorage, SESSION_STORAGE_KEY, JSON.stringify(existing));
      return existing;
    }

    const attribution = getAttributionSnapshot();
    const next = {
      id: makeId('dds'),
      visitorId: visitorId,
      startedAt: now,
      lastSeenAt: now,
      landingPath: window.location.pathname,
      attribution: attribution
    };

    safeWrite(sessionStorage, SESSION_STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function buildContext(extra) {
    const session = ensureSession();
    const metadata = extra || {};

    return {
      visitorId: session.visitorId,
      sessionStartedAt: new Date(session.startedAt).toISOString(),
      landingPath: session.landingPath || window.location.pathname,
      sourceCategory: session.attribution.sourceCategory,
      sourceLabel: session.attribution.sourceLabel,
      referrerDomain: session.attribution.referrerDomain,
      utmSource: session.attribution.utmSource,
      utmMedium: session.attribution.utmMedium,
      utmCampaign: session.attribution.utmCampaign,
      utmTerm: session.attribution.utmTerm,
      utmContent: session.attribution.utmContent,
      isInternalOperator: safeRead(localStorage, OPERATOR_STORAGE_KEY) === 'true',
      ...metadata
    };
  }

  function send(payload) {
    const session = ensureSession();
    const body = JSON.stringify({
      sessionId: session.id,
      path: window.location.pathname,
      pageTitle: document.title,
      referrer: document.referrer,
      ...payload
    });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, body);
      return;
    }

    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body
    }).catch(function () {
      // Analytics should never block the user journey.
    });
  }

  function track(eventType, extra) {
    const metadata = buildContext(extra);
    send({
      eventType: eventType,
      label: metadata.label || '',
      metadata: metadata
    });
  }

  window.DepartedAnalytics = {
    track: track,
    sessionId: ensureSession().id,
    visitorId: ensureVisitorId(),
    markInternalBrowser: function () {
      safeWrite(localStorage, OPERATOR_STORAGE_KEY, 'true');
    },
    clearInternalBrowser: function () {
      try {
        localStorage.removeItem(OPERATOR_STORAGE_KEY);
      } catch (error) {
        // Ignore storage errors.
      }
    },
    buildContext: buildContext
  };

  const isArticle = window.location.pathname.indexOf('/blog/') === 0 && window.location.pathname !== '/blog';
  track(isArticle ? 'article_view' : 'page_view');

  document.addEventListener('click', function (event) {
    const target = event.target.closest('[data-' + dataAttribute + ']');

    if (!target) {
      return;
    }

    track('cta_click', {
      clickType: target.dataset[dataAttribute],
      label: target.dataset[labelAttribute] || target.textContent.trim()
    });
  });
})();
