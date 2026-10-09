/* Stivan: логика сайта.
   Откуда берутся данные, по порядку:
   1) Google-таблица по ссылке SHEET_CSV_URL из config.js;
   2) файлы data/settings.csv и data/services.csv;
   3) встроенная копия в index.html (если сайт открыт прямо с диска).
   Сначала страница рисуется из встроенной копии, затем обновляется свежими данными. */
(function () {
  'use strict';

  const root = document.documentElement;
  root.classList.add('js-ready');

  const CACHE_KEY = 'stivan-sheet-v1';
  const THEME_KEY = 'stivan-theme';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Группы, которые знает сайт: подпись в подборщике и иконка.
     Новая группа из таблицы тоже появится, с иконкой-пуговицей. */
  const GROUPS = {
    'одежда': { label: 'Одежда', icon: 'i-shirt' },
    'обувь': { label: 'Обувь', icon: 'i-boot' },
    'сумки и чемоданы': { label: 'Сумка или чемодан', icon: 'i-bag' },
    'ключи и часы': { label: 'Ключи или часы', icon: 'i-key' },
    'мех и кожа': { label: 'Мех или кожа', icon: 'i-hide' },
    'прочее': { label: 'Прочее', icon: 'i-needle', notInPicker: true },
  };

  const SETTING_KEYS = {
    'телефон': 'phone',
    'номер телефона': 'phone',
    'режим работы': 'hours',
    'режим': 'hours',
    'часы работы': 'hours',
    'график': 'hours',
    'акция': 'promo',
    'текст акции': 'promo',
    'акция текст': 'promo',
    'акция включена': 'promoOn',
    'акция вкл': 'promoOn',
    'акция вкл/выкл': 'promoOn',
    'показывать акцию': 'promoOn',
    'telegram': 'telegram',
    'телеграм': 'telegram',
    'телеграмм': 'telegram',
    'ссылка telegram': 'telegram',
    'ссылка на telegram': 'telegram',
    'рейтинг': 'rating',
    'оценок': 'ratings',
    'оценки': 'ratings',
    'число оценок': 'ratings',
    'отзывов': 'reviews',
    'отзывы': 'reviews',
    'число отзывов': 'reviews',
    'награда': 'award',
  };

  const PLURALS = {
    ratings: ['оценка', 'оценки', 'оценок'],
    reviews: ['отзыв', 'отзыва', 'отзывов'],
    services: ['услуга', 'услуги', 'услуг'],
  };

  /* ---------- Мелочи ---------- */
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().replace(/ё/g, 'е').replace(/[\s_]+/g, ' ');
  const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const money = (n) => nf.format(n) + ' ₽';
  const fmtInt = (n) => nf.format(Math.round(n));
  const fmtRating = (n) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');

  function plural(n, forms) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  function storage(fn) {
    try { return fn(window.localStorage); } catch (e) { return null; }
  }

  /* ---------- CSV ---------- */
  function detectDelimiter(text) {
    const line = text.split(/\r?\n/, 1)[0] || '';
    const count = (ch) => line.split(ch).length - 1;
    const c = count(','), s = count(';'), t = count('\t');
    if (t > c && t > s) return '\t';
    return s > c ? ';' : ',';
  }

  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const delim = detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
        } else {
          field += c;
        }
      } else if (c === '"') {
        quoted = true;
      } else if (c === delim) {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function parsePrice(value) {
    const s = String(value || '').replace(/[\s  ]/g, '');
    const m = s.match(/\d[\d.,]*/);
    if (!m) return 0;
    let t = m[0].replace(/[.,]+$/, '');
    if (/^\d{1,3}([.,]\d{3})+$/.test(t)) {
      t = t.replace(/[.,]/g, '');
    } else {
      const cut = Math.max(t.lastIndexOf('.'), t.lastIndexOf(','));
      if (cut >= 0) t = t.slice(0, cut).replace(/[.,]/g, '') + '.' + t.slice(cut + 1);
    }
    const n = Math.round(parseFloat(t));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function parseYes(value, fallback) {
    const s = norm(value);
    if (!s) return fallback;
    if (/^(да|д|yes|y|true|1|\+|вкл|включено|включена|показывать|on)$/.test(s)) return true;
    if (/^(нет|н|no|n|false|0|-|выкл|выключено|выключена|скрыть|скрыто|off)$/.test(s)) return false;
    return fallback;
  }

  function headerMap(row) {
    const find = (names, d) => {
      const i = row.findIndex((c) => names.indexOf(norm(c)) !== -1);
      return i === -1 ? d : i;
    };
    return {
      group: find(['группа', 'категория', 'раздел'], 0),
      name: find(['услуга', 'название'], 1),
      price: find(['цена от', 'цена', 'цена, от', 'стоимость', 'стоимость от'], 2),
      comment: find(['комментарий', 'коммент', 'примечание', 'описание'], 3),
      show: find(['показывать', 'показ', 'показать', 'видно'], 4),
    };
  }

  /* Разбирает таблицу. На одном листе могут быть оба блока:
     «настройка / значение» и «группа / услуга / цена_от / комментарий / показывать». */
  function parseSheet(text) {
    const out = { settings: {}, services: [] };
    if (!text || /^\s*</.test(text)) return out;
    let mode = 'auto';
    let cols = null;
    let lastGroup = '';
    parseCSV(text).forEach((raw) => {
      const row = raw.map((c) => String(c).replace(/ /g, ' ').trim());
      if (!row.some(Boolean)) return;
      const first = norm(row[0]);
      if (first === 'настройка' || first === 'настройки') { mode = 'settings'; return; }
      if (first === 'группа' || row.some((c) => norm(c) === 'услуга')) {
        mode = 'services';
        cols = headerMap(row);
        return;
      }
      if (mode !== 'services') {
        const key = SETTING_KEYS[first];
        if (key) out.settings[key] = row[1] || '';
        return;
      }
      let group = row[cols.group] || '';
      if (group) lastGroup = group; else group = lastGroup || 'Прочее';
      const name = row[cols.name] || '';
      if (!name) return;
      out.services.push({
        group: group,
        name: name,
        price: parsePrice(row[cols.price]),
        comment: row[cols.comment] || '',
        visible: parseYes(row[cols.show], true),
      });
    });
    return out;
  }

  /* ---------- Проверка настроек ---------- */
  function normalizeTelegram(value) {
    let t = String(value || '').trim();
    if (!t) return '';
    t = t.replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?(t\.me|telegram\.me)\//i, '');
    t = t.split(/[/?#]/)[0];
    return /^[A-Za-z0-9_]{5,32}$/.test(t) ? 'https://t.me/' + t : '';
  }

  function telHref(phone) {
    let d = String(phone).replace(/\D/g, '');
    if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
    if (d.length === 10) d = '7' + d;
    return 'tel:+' + d;
  }

  function cleanSettings(raw) {
    const s = {};
    if ('phone' in raw) {
      const p = String(raw.phone).trim();
      if (p.replace(/\D/g, '').length >= 10 && p.length <= 40 && !/[#=]/.test(p)) s.phone = p;
    }
    if ('hours' in raw) {
      const h = String(raw.hours).trim();
      if (h && h.length <= 140 && h[0] !== '#') s.hours = h;
    }
    if ('promo' in raw) s.promo = String(raw.promo).trim().slice(0, 280);
    if ('promoOn' in raw) s.promoOn = parseYes(raw.promoOn, false);
    if ('telegram' in raw) {
      const t = normalizeTelegram(raw.telegram);
      if (t) s.telegram = t;
    }
    if ('rating' in raw) {
      const r = parseFloat(String(raw.rating).replace(',', '.'));
      if (r >= 0 && r <= 5) s.rating = r;
    }
    ['ratings', 'reviews'].forEach((k) => {
      if (!(k in raw)) return;
      const digits = String(raw[k]).replace(/\D/g, '');
      if (digits) s[k] = parseInt(digits, 10);
    });
    if ('award' in raw) {
      const a = String(raw.award).trim();
      if (a[0] !== '#') s.award = a.slice(0, 80);
    }
    return s;
  }

  /* ---------- Данные ---------- */
  function combine(a, b) {
    return {
      settings: Object.assign({}, a.settings, b.settings),
      services: b.services.some((x) => x.visible) ? b.services : a.services,
    };
  }

  function buildGroups(services) {
    const map = new Map();
    services.forEach((s) => {
      if (!s.visible) return;
      const key = norm(s.group);
      if (!map.has(key)) {
        const meta = GROUPS[key] || {};
        map.set(key, {
          key: key,
          name: s.group,
          label: meta.label || s.group,
          icon: meta.icon || 'i-button',
          inPicker: !meta.notInPicker,
          items: [],
        });
      }
      const g = map.get(key);
      const itemKey = norm(s.name);
      if (g.items.some((x) => x.key === itemKey)) return;
      g.items.push({ key: itemKey, name: s.name, price: s.price, comment: s.comment });
    });
    return Array.from(map.values());
  }

  const state = {
    base: { settings: {}, services: [] },
    settings: {},
    groups: [],
    signature: '',
    picker: { group: null, selected: {}, visit: 'bring' },
    message: '',
    defaultTelegram: 'https://t.me/studiostivan',
  };

  function readInline() {
    const st = $('#fallback-settings');
    const sv = $('#fallback-services');
    return combine(parseSheet(st ? st.textContent : ''), parseSheet(sv ? sv.textContent : ''));
  }

  function sheetUrl() {
    let u = typeof SHEET_CSV_URL === 'string' ? SHEET_CSV_URL.trim() : '';
    if (!/^https:\/\//i.test(u)) return '';
    if (/docs\.google\.com\/spreadsheets\/d\/e\//i.test(u)) {
      u = u.replace('/pubhtml', '/pub');
      if (/[?&]output=/.test(u)) u = u.replace(/([?&]output=)[^&#]*/, '$1csv');
      else u += (u.indexOf('?') === -1 ? '?' : '&') + 'output=csv';
    }
    return u;
  }

  function fetchText(url, ms, cacheMode) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : 0;
    return fetch(url, { cache: cacheMode, credentials: 'omit', signal: ctrl ? ctrl.signal : undefined })
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .finally(() => clearTimeout(timer));
  }

  function applyData(data) {
    const settings = cleanSettings(data.settings);
    const groups = buildGroups(data.services);
    if (!groups.length) return;
    const signature = JSON.stringify([settings, groups]);
    if (signature === state.signature) return;
    state.signature = signature;
    state.settings = settings;
    state.groups = groups;
    applySettings(settings);
    renderCatalog();
    renderPicker();
  }

  function readLocalFiles() {
    return Promise.all([
      fetchText('data/settings.csv', 6000, 'no-cache').catch(() => ''),
      fetchText('data/services.csv', 6000, 'no-cache').catch(() => ''),
    ]).then((texts) => {
      state.base = combine(state.base, combine(parseSheet(texts[0]), parseSheet(texts[1])));
      return state.base;
    });
  }

  function loadData() {
    state.base = readInline();
    const url = sheetUrl();
    let cachedSheet = null;
    if (url) {
      const cached = storage((ls) => JSON.parse(ls.getItem(CACHE_KEY) || 'null'));
      if (cached && cached.url === url && typeof cached.text === 'string') cachedSheet = parseSheet(cached.text);
    }
    applyData(cachedSheet ? combine(state.base, cachedSheet) : state.base);

    if (!url) return readLocalFiles().then(applyData);

    return fetchText(url, 8000, 'no-store')
      .then((text) => {
        const sheet = parseSheet(text);
        const hasServices = sheet.services.some((s) => s.visible);
        const hasSettings = Object.keys(sheet.settings).length > 0;
        if (!hasServices && !hasSettings) throw new Error('В таблице не нашлось данных');
        storage((ls) => ls.setItem(CACHE_KEY, JSON.stringify({ url: url, text: text, at: Date.now() })));
        if (hasServices && hasSettings) return applyData(combine(state.base, sheet));
        return readLocalFiles().then((base) => applyData(combine(base, sheet)));
      })
      .catch(() => {
        // Таблица недоступна. Сохранённая копия таблицы свежее стартовых файлов, поэтому оставляем её.
        if (cachedSheet) return;
        return readLocalFiles().then(applyData);
      });
  }

  /* ---------- Настройки на странице ---------- */
  function setNumber(el, value, fmt) {
    el.dataset.value = String(value);
    if (!el.counting) el.textContent = fmt(value);
  }

  function applySettings(s) {
    if (s.phone) {
      $$('[data-setting="phone"]').forEach((el) => { el.textContent = s.phone; });
      $$('[data-tel]').forEach((el) => {
        el.setAttribute('href', telHref(s.phone));
        if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Позвонить: ' + s.phone);
      });
    }
    if (s.hours) $$('[data-setting="hours"]').forEach((el) => { el.textContent = s.hours; });
    if (s.telegram) $$('[data-telegram]').forEach((el) => el.setAttribute('href', s.telegram));

    const promo = $('[data-promo]');
    if (promo) {
      const on = Boolean(s.promoOn && s.promo);
      promo.hidden = !on;
      if (on) $('[data-setting="promo"]', promo).textContent = s.promo;
    }

    if (typeof s.rating === 'number') {
      $$('[data-rating]').forEach((el) => setNumber(el, s.rating, fmtRating));
      $$('[data-stars]').forEach((el) => el.style.setProperty('--rating', String(s.rating)));
    }
    ['ratings', 'reviews'].forEach((k) => {
      if (typeof s[k] !== 'number') return;
      $$('[data-count="' + k + '"]').forEach((el) => setNumber(el, s[k], fmtInt));
      $$('[data-plural="' + k + '"]').forEach((el) => { el.textContent = plural(s[k], PLURALS[k]); });
    });
    if ('award' in s) {
      $$('[data-award]').forEach((el) => { el.hidden = !s.award; });
      $$('[data-setting="award"]').forEach((el) => { el.textContent = s.award; });
    }
    updateSummary();
  }

  /* ---------- Каталог ---------- */
  const priceHtml = (price, cls) => price
    ? '<span class="' + cls + '">от ' + money(price) + '</span>'
    : '<span class="' + cls + ' is-empty">уточняйте у мастера</span>';

  function groupMeta(g) {
    const n = g.items.length;
    const prices = g.items.map((x) => x.price).filter(Boolean);
    let text = n + ' ' + plural(n, PLURALS.services);
    if (prices.length) text += ', от ' + money(Math.min.apply(null, prices));
    return text;
  }

  function renderCatalog() {
    const box = $('[data-catalog]');
    if (!box) return;
    const open = new Set($$('.acc.is-open', box).map((el) => el.dataset.key));
    box.innerHTML = state.groups.map((g, i) => {
      const isOpen = open.has(g.key);
      const rows = g.items.map((item) => (
        '<li class="price-row">' +
          '<span class="price-row__name">' + esc(item.name) + '</span>' +
          '<span class="price-row__leader" aria-hidden="true"></span>' +
          priceHtml(item.price, 'price-row__price') +
          (item.comment ? '<span class="price-row__comment">' + esc(item.comment) + '</span>' : '') +
        '</li>'
      )).join('');
      return (
        '<div class="acc' + (isOpen ? ' is-open' : '') + '" data-key="' + esc(g.key) + '">' +
          '<h3 class="acc__heading">' +
            '<button class="acc__trigger" type="button" id="acc-t-' + i + '" aria-controls="acc-p-' + i + '" aria-expanded="' + isOpen + '">' +
              '<span class="acc__icon" aria-hidden="true"><svg class="icon"><use href="#' + g.icon + '"/></svg></span>' +
              '<span><span class="acc__title">' + esc(g.name) + '</span><span class="acc__count">' + esc(groupMeta(g)) + '</span></span>' +
              '<span class="acc__toggle" aria-hidden="true"></span>' +
            '</button>' +
          '</h3>' +
          '<div class="acc__panel" id="acc-p-' + i + '" role="region" aria-labelledby="acc-t-' + i + '">' +
            '<div class="acc__inner"><ul class="price-list">' + rows + '</ul></div>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function initCatalog() {
    const box = $('[data-catalog]');
    if (!box) return;
    box.addEventListener('click', (e) => {
      const btn = e.target.closest('.acc__trigger');
      if (!btn) return;
      const item = btn.closest('.acc');
      const open = !item.classList.contains('is-open');
      item.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
  }

  /* ---------- Подборщик ---------- */
  const SEW_SVG =
    '<svg class="sew" viewBox="0 0 30 30" aria-hidden="true" focusable="false">' +
      '<circle class="sew__disc" cx="15" cy="15" r="13.2"/>' +
      '<circle class="sew__rim" cx="15" cy="15" r="9.8"/>' +
      '<circle class="sew__hole" cx="11.8" cy="11.8" r="1.7"/><circle class="sew__hole" cx="18.2" cy="11.8" r="1.7"/>' +
      '<circle class="sew__hole" cx="11.8" cy="18.2" r="1.7"/><circle class="sew__hole" cx="18.2" cy="18.2" r="1.7"/>' +
      '<path class="sew__x" d="M11.8 11.8 18.2 18.2M18.2 11.8 11.8 18.2" pathLength="1"/>' +
    '</svg>';

  const pickerGroups = () => state.groups.filter((g) => g.inPicker);
  const currentGroup = () => pickerGroups().find((g) => g.key === state.picker.group) || null;
  function selectedSet(key) {
    if (!state.picker.selected[key]) state.picker.selected[key] = new Set();
    return state.picker.selected[key];
  }

  function renderPicker() {
    const tiles = $('[data-tiles]');
    if (!tiles) return;
    if (state.picker.group && !currentGroup()) state.picker.group = null;
    tiles.innerHTML = pickerGroups().map((g) => {
      const n = g.items.length;
      return (
        '<label class="tile">' +
          '<input class="tile__input" type="radio" name="item" value="' + esc(g.key) + '"' + (g.key === state.picker.group ? ' checked' : '') + '>' +
          '<span class="tile__card">' +
            '<span class="tile__icon" aria-hidden="true"><svg class="icon"><use href="#' + g.icon + '"/></svg></span>' +
            '<span class="tile__label">' + esc(g.label) + '</span>' +
            '<span class="tile__count">' + n + ' ' + plural(n, PLURALS.services) + '</span>' +
          '</span>' +
        '</label>'
      );
    }).join('');
    renderChecks();
  }

  function renderChecks() {
    const box = $('[data-services]');
    const empty = $('[data-services-empty]');
    if (!box) return;
    const g = currentGroup();
    if (empty) empty.hidden = Boolean(g);
    if (!g) {
      box.innerHTML = '';
      updateSummary();
      return;
    }
    const sel = selectedSet(g.key);
    const known = new Set(g.items.map((x) => x.key));
    Array.from(sel).forEach((k) => { if (!known.has(k)) sel.delete(k); });
    box.innerHTML = g.items.map((item) => (
      '<label class="check">' +
        '<input class="check__input" type="checkbox" value="' + esc(item.key) + '"' + (sel.has(item.key) ? ' checked' : '') + '>' +
        '<span class="check__card">' + SEW_SVG +
          '<span><span class="check__name">' + esc(item.name) + '</span>' +
          (item.comment ? '<span class="check__comment">' + esc(item.comment) + '</span>' : '') + '</span>' +
          priceHtml(item.price, 'check__price') +
        '</span>' +
      '</label>'
    )).join('');
    updateSummary();
  }

  function buildMessage(g, chosen, priced, sum) {
    const lines = ['Здравствуйте! Хочу отдать вещь в ремонт.', '', 'Что чиним: ' + g.label];
    if (chosen.length) {
      lines.push('Услуги:');
      chosen.forEach((s) => lines.push('• ' + s.name + (s.price ? ' (от ' + money(s.price) + ')' : '')));
    } else {
      lines.push('Услуги: не знаю, что выбрать, нужен совет мастера');
    }
    if (priced.length) {
      lines.push('Ориентир по сайту: примерно от ' + money(sum) + (priced.length < chosen.length ? ', остальное назовёт мастер' : ''));
    }
    lines.push('');
    lines.push(state.picker.visit === 'ask' ? 'Сначала хочу уточнить срок.' : 'Принесу вещь в мастерскую.');
    return lines.join('\n');
  }

  function telegramLink(text) {
    const base = state.settings.telegram || state.defaultTelegram;
    return base + (base.indexOf('?') === -1 ? '?' : '&') + 'text=' + encodeURIComponent(text);
  }

  function updateSummary() {
    const totalEl = $('[data-total]');
    if (!totalEl) return;
    const noteEl = $('[data-total-note]');
    const itemEl = $('[data-summary-item]');
    const servicesEl = $('[data-summary-services]');
    const send = $('[data-send]');
    const copy = $('[data-copy]');
    const hint = $('[data-send-hint]');

    const g = currentGroup();
    const chosen = g ? g.items.filter((x) => selectedSet(g.key).has(x.key)) : [];
    const priced = chosen.filter((x) => x.price);
    const sum = priced.reduce((a, x) => a + x.price, 0);

    let total;
    let note;
    let isText = false;
    if (!g) {
      total = 'Выберите вещь';
      note = 'Посчитаем примерную стоимость по ценам из прайса.';
      isText = true;
    } else if (!chosen.length) {
      total = 'Отметьте услуги';
      note = 'Можно несколько. Не уверены? Отправьте заявку без отметок и спросите мастера.';
      isText = true;
    } else if (!priced.length) {
      total = 'Точную стоимость назовёт мастер';
      note = 'Для выбранных услуг цены в прайсе пока нет.';
      isText = true;
    } else if (priced.length < chosen.length) {
      total = 'Примерно от ' + money(sum);
      note = 'У части услуг цены нет: точную стоимость назовёт мастер.';
    } else {
      total = 'Примерно от ' + money(sum);
      note = 'Это сумма цен «от». Точную стоимость назовёт мастер.';
    }
    totalEl.textContent = total;
    totalEl.classList.toggle('is-text', isText);
    noteEl.textContent = note;
    itemEl.textContent = g ? g.label : 'пока не выбрано';
    servicesEl.textContent = chosen.length ? chosen.map((x) => x.name).join(', ') : (g ? 'нужен совет мастера' : 'пока не выбрано');

    if (g) {
      state.message = buildMessage(g, chosen, priced, sum);
      send.setAttribute('href', telegramLink(state.message));
      send.setAttribute('aria-disabled', 'false');
      copy.disabled = false;
      hint.textContent = 'Telegram откроет чат с готовым текстом. Если текст не подставился, вставьте скопированную заявку.';
    } else {
      state.message = '';
      send.setAttribute('href', state.settings.telegram || state.defaultTelegram);
      send.setAttribute('aria-disabled', 'true');
      copy.disabled = true;
      hint.textContent = 'Сначала выберите вещь на шаге 1.';
    }

    const step2 = $('[data-step="2"]');
    const step3 = $('[data-step="3"]');
    if (step2) step2.classList.toggle('is-done', chosen.length > 0);
    if (step3) step3.classList.toggle('is-ready', Boolean(g));
    const step1 = $('[data-step="1"]');
    if (step1) step1.classList.toggle('is-done', Boolean(g));
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  function initPicker() {
    const picker = $('[data-picker]');
    if (!picker) return;
    state.defaultTelegram = ($('[data-send]').getAttribute('href') || state.defaultTelegram).split('?')[0];

    $('[data-tiles]').addEventListener('change', (e) => {
      if (!e.target.matches('.tile__input')) return;
      state.picker.group = e.target.value;
      renderChecks();
      // Подкручиваем к шагу 2, если он ниже экрана. offsetTop не зависит от анимации появления.
      const step2 = $('#picker-step-2');
      step2.classList.add('is-visible');
      let top = 0;
      for (let el = step2; el; el = el.offsetParent) top += el.offsetTop;
      if (top - window.scrollY > window.innerHeight * 0.72) {
        window.scrollTo({ top: top - 16, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      }
    });

    $('[data-services]').addEventListener('change', (e) => {
      if (!e.target.matches('.check__input')) return;
      const g = currentGroup();
      if (!g) return;
      const sel = selectedSet(g.key);
      if (e.target.checked) sel.add(e.target.value); else sel.delete(e.target.value);
      updateSummary();
    });

    $$('input[name="visit"]', picker).forEach((input) => {
      input.addEventListener('change', () => {
        if (input.checked) { state.picker.visit = input.value; updateSummary(); }
      });
    });

    $('[data-send]').addEventListener('click', (e) => {
      if (e.currentTarget.getAttribute('aria-disabled') === 'true') {
        e.preventDefault();
        toast('Сначала выберите вещь');
        const firstTile = $('.tile__input');
        if (firstTile) firstTile.focus({ preventScroll: false });
      }
    });

    $('[data-copy]').addEventListener('click', () => {
      if (!state.message) return;
      copyText(state.message).then((ok) => {
        toast(ok ? 'Заявка скопирована' : 'Не получилось скопировать, попробуйте ещё раз');
      });
    });
  }

  /* ---------- Уведомление ---------- */
  let toastTimer = 0;
  function toast(text) {
    const el = $('[data-toast]');
    if (!el) return;
    el.textContent = text;
    el.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-shown'), 2600);
  }

  /* ---------- Тема ---------- */
  function initTheme() {
    const btn = $('[data-theme-toggle]');
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const current = () => root.getAttribute('data-theme') || (mq.matches ? 'dark' : 'light');
    const sync = () => {
      const dark = current() === 'dark';
      if (btn) btn.setAttribute('aria-label', dark ? 'Включить светлую тему' : 'Включить тёмную тему');
      if (root.hasAttribute('data-theme')) {
        $$('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0f1628' : '#f3ecdf'));
      }
    };
    if (btn) {
      btn.addEventListener('click', () => {
        const next = current() === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        storage((ls) => ls.setItem(THEME_KEY, next));
        sync();
      });
    }
    if (mq.addEventListener) mq.addEventListener('change', sync); else if (mq.addListener) mq.addListener(sync);
    sync();
  }

  /* ---------- Анимации при скролле ---------- */
  function countUp(el) {
    const fmt = el.hasAttribute('data-rating') ? fmtRating : fmtInt;
    const target = parseFloat(el.dataset.value);
    if (!Number.isFinite(target) || reduceMotion.matches) return;
    const duration = 1400;
    const start = performance.now();
    el.counting = true;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * eased);
      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        el.counting = false;
        el.textContent = fmt(parseFloat(el.dataset.value));
      }
    };
    requestAnimationFrame(tick);
  }

  function initObservers() {
    $$('[data-countup]').forEach((el) => {
      if (!el.dataset.value) el.dataset.value = el.textContent.replace(/\s/g, '').replace(',', '.');
    });
    const els = $$('.reveal, .seam, [data-countup]');
    const show = (el) => {
      if (el.classList.contains('reveal')) el.classList.add('is-visible');
      if (el.classList.contains('seam')) el.classList.add('is-drawn');
      if (el.hasAttribute('data-countup')) countUp(el);
    };
    if (!('IntersectionObserver' in window)) { els.forEach(show); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        show(entry.target);
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
    els.forEach((el) => io.observe(el));
  }

  /* ---------- Плавающая кнопка и шапка ---------- */
  function initDock() {
    const dock = $('[data-dock]');
    if (!dock) return;
    if (!('IntersectionObserver' in window)) { dock.classList.add('is-shown'); return; }
    const targets = [$('.hero__cta'), $('#podbor'), $('.site-footer')].filter(Boolean);
    const visible = new Set();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); });
      dock.classList.toggle('is-shown', visible.size === 0);
    }, { rootMargin: '-10% 0px -10% 0px' });
    targets.forEach((t) => io.observe(t));
  }

  function initHeader() {
    const header = $('.site-header');
    if (header) {
      let ticking = false;
      const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          header.classList.toggle('is-stuck', window.scrollY > 8);
          ticking = false;
        });
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
    const links = $$('.site-nav a[href^="#"]');
    if (!links.length || !('IntersectionObserver' in window)) return;
    const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const link = byId.get(e.target.id);
        if (!link) return;
        if (e.isIntersecting) {
          links.forEach((a) => a.removeAttribute('aria-current'));
          link.setAttribute('aria-current', 'true');
        } else if (link.getAttribute('aria-current')) {
          link.removeAttribute('aria-current');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    byId.forEach((_, id) => { const sec = document.getElementById(id); if (sec) io.observe(sec); });
  }

  /* ---------- Запуск ---------- */
  function start() {
    initTheme();
    initCatalog();
    initPicker();
    loadData();
    initObservers();
    initDock();
    initHeader();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
