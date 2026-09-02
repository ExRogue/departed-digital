// Cookie consent for analytics. Google Analytics loads only after the visitor
// agrees; declining stores that choice and nothing else. Essential storage
// (case links, this choice itself, partner referral memory) does not need
// consent and is documented on the cookie policy page.
(function () {
  'use strict';

  var CONSENT_KEY = 'ddConsent';
  var GA_ID = 'G-VBKFG16BZY';

  function readConsent() {
    try { return localStorage.getItem(CONSENT_KEY) || ''; } catch (e) { return ''; }
  }

  function writeConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (e) { /* private mode */ }
  }

  function loadAnalytics() {
    if (window.dataLayer && window.__ddGaLoaded) { return; }
    window.__ddGaLoaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());

    // Test browsers, local previews, and non-production hosts stay tagged as
    // internal so GA4's internal-traffic filter can exclude them.
    try {
      var internal = (location.hostname !== 'www.departed.digital' && location.hostname !== 'departed.digital')
        || localStorage.getItem('departedDigitalOperatorBrowser') === 'true';
      if (internal) { window.gtag('set', { 'traffic_type': 'internal' }); }
    } catch (e) { /* private mode */ }

    window.gtag('config', GA_ID);

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(script);
  }

  function removeBanner() {
    var banner = document.getElementById('dd-consent-banner');
    if (banner && banner.parentNode) { banner.parentNode.removeChild(banner); }
  }

  function choose(value) {
    writeConsent(value);
    removeBanner();
    if (value === 'granted') { loadAnalytics(); }
    renderChoiceWidget();
  }

  function showBanner() {
    if (document.getElementById('dd-consent-banner')) { return; }

    var banner = document.createElement('div');
    banner.id = 'dd-consent-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie choice');
    banner.innerHTML =
      '<div class="dd-consent-inner">' +
        '<p class="dd-consent-text">We use one small analytics cookie to see which pages help families most. Nothing is used for advertising. <a href="/cookies">Cookie policy</a></p>' +
        '<div class="dd-consent-actions">' +
          '<button type="button" class="dd-consent-accept">That’s fine</button>' +
          '<button type="button" class="dd-consent-decline">No thanks</button>' +
        '</div>' +
      '</div>';

    var style = document.createElement('style');
    style.textContent =
      '#dd-consent-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;display:flex;justify-content:center;pointer-events:none;}' +
      '.dd-consent-inner{pointer-events:auto;display:flex;align-items:center;gap:18px;flex-wrap:wrap;max-width:640px;background:#111b35;color:#e8e6df;border:1px solid rgba(224,192,106,0.35);border-radius:14px;padding:14px 18px;box-shadow:0 12px 40px rgba(17,27,53,0.35);font-family:Inter,-apple-system,sans-serif;font-size:0.88rem;line-height:1.5;}' +
      '.dd-consent-text{margin:0;flex:1;min-width:220px;}' +
      '.dd-consent-text a{color:#e0c06a;text-decoration:underline;}' +
      '.dd-consent-actions{display:flex;gap:10px;}' +
      '.dd-consent-accept,.dd-consent-decline{font-family:inherit;font-size:0.86rem;font-weight:600;border-radius:999px;padding:9px 18px;cursor:pointer;}' +
      '.dd-consent-accept{background:#c9a84c;border:1px solid #c9a84c;color:#111b35;}' +
      '.dd-consent-accept:hover{background:#e0c06a;border-color:#e0c06a;}' +
      '.dd-consent-decline{background:transparent;border:1px solid rgba(255,255,255,0.35);color:#e8e6df;}' +
      '.dd-consent-decline:hover{border-color:#e0c06a;color:#e0c06a;}' +
      '.dd-consent-accept:focus-visible,.dd-consent-decline:focus-visible{outline:2px solid #e0c06a;outline-offset:2px;}' +
      '@media (max-width:520px){.dd-consent-inner{flex-direction:column;align-items:stretch;text-align:center;}.dd-consent-actions{justify-content:center;}}';

    banner.appendChild(style);
    document.body.appendChild(banner);

    banner.querySelector('.dd-consent-accept').addEventListener('click', function () { choose('granted'); });
    banner.querySelector('.dd-consent-decline').addEventListener('click', function () { choose('denied'); });
  }

  // The cookie policy page carries an element with this id so people can
  // change their mind later.
  function renderChoiceWidget() {
    var host = document.getElementById('dd-consent-choice');
    if (!host) { return; }

    var current = readConsent();
    var label = current === 'granted' ? 'allowed' : current === 'denied' ? 'declined' : 'not made yet';
    host.innerHTML =
      '<p style="margin:0 0 12px;">Your analytics cookie choice: <strong>' + label + '</strong></p>' +
      '<button type="button" id="dd-consent-allow" style="font-family:inherit;font-size:0.9rem;font-weight:600;border-radius:999px;padding:10px 20px;cursor:pointer;background:#c9a84c;border:1px solid #c9a84c;color:#111b35;margin-right:10px;">Allow analytics</button>' +
      '<button type="button" id="dd-consent-refuse" style="font-family:inherit;font-size:0.9rem;font-weight:600;border-radius:999px;padding:10px 20px;cursor:pointer;background:transparent;border:1px solid #6b7a8d;color:#2d3a4a;">Decline</button>';

    document.getElementById('dd-consent-allow').addEventListener('click', function () { choose('granted'); });
    document.getElementById('dd-consent-refuse').addEventListener('click', function () { choose('denied'); });
  }

  function boot() {
    var consent = readConsent();

    if (consent === 'granted') {
      loadAnalytics();
    } else if (!consent) {
      showBanner();
    }

    renderChoiceWidget();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
