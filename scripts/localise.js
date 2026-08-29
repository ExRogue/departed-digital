// Localises wording and pricing for visitors outside the UK. UK visitors and
// search engines see the page exactly as authored. Prices must match the
// currency options configured on the Stripe payment links.
(function () {
  'use strict';

  var EUROZONE = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];

  var PACKS = {
    US: {
      symbol: '$',
      prices: ['199', '329', '529'],
      badge: 'For US families after a loss',
      stat: { countTo: 3000000, display: '3 million+', label: 'people die in the US each year, and most leave online accounts active', source: 'Centers for Disease Control and Prevention' }
    },
    CA: {
      symbol: 'C$',
      prices: ['269', '449', '719'],
      badge: 'For Canadian families after a loss',
      stat: { countTo: 330000, display: '330,000+', label: 'people die in Canada each year, and most leave online accounts active', source: 'Statistics Canada' }
    },
    AU: {
      symbol: 'A$',
      prices: ['299', '499', '799'],
      badge: 'For Australian families after a loss',
      stat: { countTo: 180000, display: '180,000+', label: 'people die in Australia each year, and most leave online accounts active', source: 'Australian Bureau of Statistics' }
    },
    NZ: {
      symbol: 'NZ$',
      prices: ['329', '549', '879'],
      badge: 'For New Zealand families after a loss',
      stat: { countTo: 38000, display: '38,000+', label: 'people die in New Zealand each year, and most leave online accounts active', source: 'Stats NZ' }
    },
    EU: {
      symbol: '€',
      prices: ['179', '299', '479'],
      badge: 'For families after a loss',
      stat: { countTo: 60000000, display: '60 million+', label: 'people die worldwide each year, and most leave online accounts active', source: 'United Nations' }
    },
    INTL: {
      symbol: null, // keep GBP display; checkout converts automatically
      prices: null,
      badge: 'For families after a loss',
      stat: { countTo: 60000000, display: '60 million+', label: 'people die worldwide each year, and most leave online accounts active', source: 'United Nations' }
    }
  };

  function packFor(country) {
    if (!country || country === 'GB') return null;
    if (PACKS[country]) return PACKS[country];
    if (EUROZONE.indexOf(country) !== -1) return PACKS.EU;
    return PACKS.INTL;
  }

  function setPrice(el, symbol, amount) {
    if (!el) return;
    var sup = el.querySelector('sup, small');
    if (sup) {
      sup.textContent = symbol;
      var textNodes = [];
      el.childNodes.forEach(function (node) {
        if (node.nodeType === 3) textNodes.push(node);
      });
      if (textNodes.length) {
        textNodes[textNodes.length - 1].textContent = amount;
      } else {
        el.appendChild(document.createTextNode(amount));
      }
    } else {
      el.textContent = symbol + amount;
    }
  }

  function apply(pack) {
    // Hero badge and any generic "UK families" wording marker
    document.querySelectorAll('.hero-badge').forEach(function (el) {
      el.textContent = pack.badge;
    });

    // "from £149" style mentions
    if (pack.symbol && pack.prices) {
      document.querySelectorAll('[data-local-from]').forEach(function (el) {
        el.textContent = pack.symbol + pack.prices[0];
      });

      // Homepage pricing cards
      var amounts = document.querySelectorAll('.pricing .price-amount');
      if (amounts.length === 3) {
        setPrice(amounts[0], pack.symbol, pack.prices[0]);
        setPrice(amounts[1], pack.symbol, pack.prices[1]);
        setPrice(amounts[2], pack.symbol, pack.prices[2]);
      }

      // Start page package picker
      var pickerPrices = document.querySelectorAll('#package-picker .price');
      if (pickerPrices.length === 3) {
        setPrice(pickerPrices[0], pack.symbol, pack.prices[0]);
        setPrice(pickerPrices[1], pack.symbol, pack.prices[1]);
        setPrice(pickerPrices[2], pack.symbol, pack.prices[2]);
      }
    }

    // Stats band: swap the UK figure for the local one
    var statNumber = document.querySelector('.scale-number[data-count-to="650000"]');
    if (statNumber && pack.stat) {
      var stat = statNumber.closest('.scale-stat');
      statNumber.dataset.countTo = String(pack.stat.countTo);
      statNumber.dataset.suffix = '+';
      delete statNumber.dataset.decimals;
      if (pack.stat.countTo >= 1000000) {
        // Large numbers read better as a fixed display than a raw count
        statNumber.dataset.countTo = '';
        statNumber.textContent = pack.stat.display;
      } else {
        statNumber.textContent = pack.stat.display;
      }
      if (stat) {
        var label = stat.querySelector('.scale-label');
        var source = stat.querySelector('.scale-source');
        if (label) label.textContent = pack.stat.label;
        if (source) source.textContent = pack.stat.source;
      }
    }
  }

  function boot(country) {
    var pack = packFor(country);
    if (pack) apply(pack);
  }

  var override = new URLSearchParams(window.location.search).get('geo');
  if (override) {
    boot(override.toUpperCase());
    return;
  }

  var cached = null;
  try { cached = sessionStorage.getItem('ddGeoCountry'); } catch (e) { /* private mode */ }

  if (cached !== null) {
    boot(cached);
    return;
  }

  fetch('/api/geo')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var country = String(data.country || '');
      try { sessionStorage.setItem('ddGeoCountry', country); } catch (e) { /* ignore */ }
      boot(country);
    })
    .catch(function () { /* stay with UK defaults */ });
})();
