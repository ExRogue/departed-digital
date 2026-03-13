(function () {
  const STORAGE_KEY = 'departedDigitalSessionId';
  const endpoint = '/api/analytics';
  const dataAttribute = 'track';
  const labelAttribute = 'trackLabel';

  function ensureSessionId() {
    let value = localStorage.getItem(STORAGE_KEY);

    if (!value) {
      value = 'dd-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(STORAGE_KEY, value);
    }

    return value;
  }

  function send(payload) {
    const body = JSON.stringify({
      sessionId: ensureSessionId(),
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
    const metadata = extra || {};
    send({
      eventType: eventType,
      label: metadata.label || '',
      metadata: metadata
    });
  }

  window.DepartedAnalytics = {
    track: track,
    sessionId: ensureSessionId()
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
