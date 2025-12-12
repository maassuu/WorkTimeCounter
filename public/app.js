const state = {
  entries: {},
  clients: [],
  invoices: [],
  profile: null,
  selectedInvoices: new Set(),
};

const els = {
  navButtons: document.querySelectorAll('.nav button'),
  views: document.querySelectorAll('.view'),
  monthFilter: document.getElementById('month-filter'),
  monthSummary: document.getElementById('month-summary'),
  plannedHoursText: document.getElementById('planned-hours-text'),
  plannedHoursBar: document.getElementById('planned-hours-bar'),
  dayProgressText: document.getElementById('day-progress-text'),
  dayProgressBar: document.getElementById('day-progress-bar'),
  entriesTable: document.querySelector('#entries-table tbody'),
  metricHours: document.getElementById('metric-hours'),
  metricHoursHelper: document.getElementById('metric-hours-helper'),
  metricInvoices: document.getElementById('metric-invoices'),
  metricClients: document.getElementById('metric-clients'),
  invoiceList: document.getElementById('invoice-list'),
  clientsList: document.getElementById('clients-list'),
  invoiceClientSelect: document.getElementById('invoice-client-select'),
  previewNet: document.getElementById('preview-net'),
  previewVat: document.getElementById('preview-vat'),
  previewGross: document.getElementById('preview-gross'),
  previewHelper: document.getElementById('preview-helper'),
};

function switchView(targetId) {
  els.views.forEach(view => {
    view.classList.toggle('active', view.id === targetId);
  });
  els.navButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.target === targetId);
  });
}

function formatHours(value) {
  const num = Number(value) || 0;
  return `${num.toFixed(2)}h`;
}

function formatHoursToHHMM(value) {
  const totalMinutes = Math.round((Number(value) || 0) * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatMoney(value, currency) {
  const num = Number(value) || 0;
  return `${num.toFixed(2)}${currency ? ` ${currency}` : ''}`;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function parseNumber(value) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

function parseHours(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.includes(':')) {
      const [h, m] = trimmed.split(':').map(Number);
      if (Number.isFinite(h) && Number.isFinite(m) && h >= 0 && m >= 0 && m < 60) {
        return round2(h + m / 60);
      }
      return null;
    }
    const num = parseNumber(trimmed);
    return num === null ? null : round2(num);
  }
  const num = parseNumber(value);
  return num === null ? null : round2(num);
}

function getMonthContext() {
  const monthValue = currentMonthFilter();
  if (monthValue && /^\d{4}-\d{2}$/.test(monthValue)) {
    const [year, month] = monthValue.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    return { year, month, daysInMonth };
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const isoMonth = `${year}-${String(month).padStart(2, '0')}`;
  els.monthFilter.value = isoMonth;
  return { year, month, daysInMonth };
}

function getInvoiceReferenceDate() {
  const form = document.getElementById('invoice-form');
  if (form.saleDate.value) return form.saleDate.value;
  if (form.issueDate.value) return form.issueDate.value;
  if (els.monthFilter && els.monthFilter.value) {
    return `${els.monthFilter.value}-01`;
  }
  return '';
}

function autofillInvoiceHours() {
  const form = document.getElementById('invoice-form');
  const refDate = getInvoiceReferenceDate();
  const total = sumEntriesForMonth(refDate);
  if (total === null) {
    form.hours.value = '';
    return;
  }
  form.hours.value = formatHoursToHHMM(total);
  computeInvoicePreview();
}

function ensureInvoiceHours() {
  const form = document.getElementById('invoice-form');
  if (form.hours.hasAttribute('readonly')) {
    autofillInvoiceHours();
    return;
  }
}

function selectedInvoiceIdsFromDom() {
  return Array.from(document.querySelectorAll('#invoice-list input[name="invoice-select"]:checked')).map(el => el.value);
}

function sumEntriesForMonth(refDate) {
  if (!refDate) return null;
  const target = new Date(refDate);
  if (Number.isNaN(target.getTime())) return null;
  const targetYear = target.getFullYear();
  const targetMonth = target.getMonth();
  let total = 0;
  Object.entries(state.entries || {}).forEach(([date, hours]) => {
    const d = new Date(date);
    if (!Number.isNaN(d.getTime()) && d.getFullYear() === targetYear && d.getMonth() === targetMonth) {
      total += Number(hours) || 0;
    }
  });
  return round2(total);
}

function computeEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function polishHolidays(year) {
  const fixed = [
    `${year}-01-01`,
    `${year}-01-06`,
    `${year}-05-01`,
    `${year}-05-03`,
    `${year}-08-15`,
    `${year}-11-01`,
    `${year}-11-11`,
    `${year}-12-24`, // Christmas Eve treated as holiday
    `${year}-12-25`,
    `${year}-12-26`,
  ];
  const easterSunday = computeEaster(year);
  const easterMonday = new Date(easterSunday);
  easterMonday.setDate(easterMonday.getDate() + 1);
  const corpusChristi = new Date(easterSunday);
  corpusChristi.setDate(corpusChristi.getDate() + 60);

  return new Set([
    ...fixed,
    dateKey(easterMonday),
    dateKey(corpusChristi),
  ]);
}

function workingDaysInMonth(year, month) {
  const holidays = polishHolidays(year);
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month - 1, day);
    const dow = d.getDay(); // 0=Sun
    const key = dateKey(d);
    if (dow === 0 || dow === 6) continue;
    if (holidays.has(key)) continue;
    count += 1;
  }
  return count;
}

function updateProgressBars(totalHours) {
  if (!els.plannedHoursText || !els.plannedHoursBar || !els.dayProgressText || !els.dayProgressBar) return;
  const { year, month, daysInMonth } = getMonthContext();
  const workingDays = workingDaysInMonth(year, month);
  const plannedHours = workingDays * 8;
  const pctHours = plannedHours > 0 ? Math.min(100, Math.round((totalHours / plannedHours) * 100)) : 0;
  els.plannedHoursText.textContent = `${totalHours.toFixed(2)}h / ${plannedHours.toFixed(2)}h planned (${workingDays} work days)`;
  els.plannedHoursBar.style.width = `${pctHours}%`;

  const now = new Date();
  const selectedIsCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
  let dayValue = 0;
  if (selectedIsCurrentMonth) {
    dayValue = now.getDate();
  } else if (new Date(year, month - 1, 1) < new Date(now.getFullYear(), now.getMonth(), 1)) {
    dayValue = daysInMonth;
  } else {
    dayValue = 0;
  }
  const pctDays = daysInMonth > 0 ? Math.min(100, Math.round((dayValue / daysInMonth) * 100)) : 0;
  els.dayProgressText.textContent = `Day ${dayValue} of ${daysInMonth}`;
  els.dayProgressBar.style.width = `${pctDays}%`;
}

async function fetchJson(url, options = {}) {
  const opts = { ...options };
  opts.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || res.statusText || 'Request failed';
    throw new Error(message);
  }
  return data;
}

function initNav() {
  els.navButtons.forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.target));
  });
}

function setDefaultMonth() {
  const now = new Date();
  const isoMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  els.monthFilter.value = isoMonth;
}

function currentMonthFilter() {
  return els.monthFilter.value || '';
}

async function loadEntries() {
  const data = await fetchJson('/api/entries');
  state.entries = data.entries || {};
  renderEntries();
  autofillInvoiceHours();
}

function renderEntries() {
  const month = currentMonthFilter();
  const rows = Object.entries(state.entries)
    .filter(([date]) => !month || date.startsWith(month))
    .sort(([a], [b]) => (a < b ? 1 : -1));

  els.entriesTable.innerHTML = '';
  let total = 0;
  rows.forEach(([date, hours]) => {
    total += Number(hours) || 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${date}</td>
      <td>${formatHours(hours)}</td>
      <td><button class="secondary" data-action="delete-entry" data-date="${date}">Remove</button></td>
    `;
      els.entriesTable.appendChild(tr);
  });

  els.metricHours.textContent = formatHours(total);
  els.metricHoursHelper.textContent = month ? `Sum for ${month}` : 'Pick a month to see the sum.';
  els.monthSummary.textContent = rows.length
    ? `${rows.length} day(s) logged · ${formatHours(total)}`
    : 'No hours yet.';
  updateProgressBars(total);
}

async function saveEntry(event) {
  event.preventDefault();
  const form = event.target;
  const date = form.date.value;
  const hours = parseHours(form.hours.value);
  if (!date || hours === null || hours < 0) return alert('Provide hours as HH:MM (minutes 00-59)');
  await fetchJson('/api/entry', { method: 'POST', body: JSON.stringify({ date, hours }) });
  await loadEntries();
}

async function deleteEntry(date) {
  await fetchJson(`/api/entry?date=${encodeURIComponent(date)}`, { method: 'DELETE' });
  await loadEntries();
}

async function clearMonth() {
  const month = currentMonthFilter();
  if (!month) return alert('Pick a month first');
  if (!confirm(`Remove all entries for ${month}?`)) return;
  await fetchJson(`/api/month?month=${encodeURIComponent(month)}`, { method: 'DELETE' });
  await loadEntries();
}

async function loadClients() {
  const data = await fetchJson('/api/clients');
  state.clients = data.clients || [];
  renderClients();
  populateClientSelect();
}

function renderClients() {
  els.clientsList.innerHTML = '';
  if (!state.clients.length) {
    els.clientsList.innerHTML = '<p class="helper">No clients yet.</p>';
  } else {
    state.clients
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(client => {
        const card = document.createElement('div');
        card.className = 'invoice-card';
        card.innerHTML = `
          <div class="row">
            <strong>${client.name}</strong>
            <div class="actions">
              <button class="secondary" data-action="edit-client" data-id="${client.id}">Edit</button>
              <button class="danger" data-action="delete-client" data-id="${client.id}">Delete</button>
            </div>
          </div>
          <div class="meta">${client.address || ''}</div>
          <div class="meta">${client.city || ''}</div>
          <div class="meta">${client.taxId ? `Tax ID: ${client.taxId}` : ''}</div>
        `;
        els.clientsList.appendChild(card);
      });
  }
  els.metricClients.textContent = state.clients.length;
}

function populateClientSelect() {
  els.invoiceClientSelect.innerHTML = '<option value="">-- none --</option>';
  state.clients.forEach(client => {
    const opt = document.createElement('option');
    opt.value = client.id;
    opt.textContent = client.name;
    els.invoiceClientSelect.appendChild(opt);
  });
}

async function saveClient(event) {
  event.preventDefault();
  const form = event.target;
  const payload = {
    id: form.clientId.value || undefined,
    name: form.clientName.value.trim(),
    address: form.clientAddress.value.trim(),
    city: form.clientCity.value.trim(),
    taxId: form.clientTaxId.value.trim(),
  };
  if (!payload.name) return alert('Client name is required');
  await fetchJson('/api/clients', { method: 'POST', body: JSON.stringify(payload) });
  form.reset();
  await loadClients();
}

function startEditClient(id) {
  const client = state.clients.find(c => c.id === id);
  if (!client) return;
  const form = document.getElementById('client-form');
  form.clientId.value = client.id;
  form.clientName.value = client.name || '';
  form.clientAddress.value = client.address || '';
  form.clientCity.value = client.city || '';
  form.clientTaxId.value = client.taxId || '';
  setStatus('Editing client', 'neutral');
}

async function deleteClient(id) {
  if (!confirm('Delete this client?')) return;
  await fetchJson(`/api/clients?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  await loadClients();
}

async function loadProfile() {
  const data = await fetchJson('/api/profile');
  state.profile = data.profile || null;
  fillProfileForm();
  applyProfileToInvoiceForm();
}

function fillProfileForm() {
  if (!state.profile) return;
  const form = document.getElementById('profile-form');
  const { seller, defaults } = state.profile;
  form.sellerName.value = seller.name || '';
  form.sellerAddress.value = seller.address || '';
  form.sellerCity.value = seller.city || '';
  form.sellerTaxId.value = seller.taxId || '';
  form.sellerAccount.value = seller.account || '';
  form.sellerBank.value = seller.bank || '';

  form.hourlyRate.value = defaults.hourlyRate ?? '';
  form.vatPercent.value = defaults.vatPercent ?? '';
  form.currency.value = defaults.currency || '';
  form.invoicePlace.value = defaults.invoicePlace || '';
  form.itemDescription.value = defaults.itemDescription || '';
  form.itemUnit.value = defaults.itemUnit || '';
  form.dueDays.value = defaults.dueDays ?? '';
}

async function saveProfile(event) {
  event.preventDefault();
  const form = event.target;
  const payload = {
    seller: {
      name: form.sellerName.value.trim(),
      address: form.sellerAddress.value.trim(),
      city: form.sellerCity.value.trim(),
      taxId: form.sellerTaxId.value.trim(),
      account: form.sellerAccount.value.trim(),
      bank: form.sellerBank.value.trim(),
    },
    defaults: {
      hourlyRate: parseNumber(form.hourlyRate.value),
      vatPercent: parseNumber(form.vatPercent.value),
      currency: form.currency.value.trim(),
      invoicePlace: form.invoicePlace.value.trim(),
      itemDescription: form.itemDescription.value.trim(),
      itemUnit: form.itemUnit.value.trim(),
      dueDays: parseNumber(form.dueDays.value),
    },
  };
  await fetchJson('/api/profile', { method: 'PUT', body: JSON.stringify(payload) });
  await loadProfile();
}

function applyProfileToInvoiceForm() {
  if (!state.profile) return;
  const form = document.getElementById('invoice-form');
  const { seller, defaults } = state.profile;
  if (!form.currency.value) form.currency.value = defaults.currency || '';
  if (!form.vatPercent.value) form.vatPercent.value = defaults.vatPercent ?? '';
  if (!form.rate.value && defaults.hourlyRate !== null && defaults.hourlyRate !== undefined) {
    form.rate.value = defaults.hourlyRate;
  }
  if (!form.place.value) form.place.value = defaults.invoicePlace || '';
  if (!form.itemDesc.value) form.itemDesc.value = defaults.itemDescription || '';
  if (!form.itemUnit.value) form.itemUnit.value = defaults.itemUnit || '';
  if (!form.dueDays.value && defaults.dueDays !== null && defaults.dueDays !== undefined) {
    form.dueDays.value = defaults.dueDays;
  }
  if (!form.sellerName.value) form.sellerName.value = seller.name || '';
  if (!form.sellerAddress.value) form.sellerAddress.value = seller.address || '';
  if (!form.sellerCity.value) form.sellerCity.value = seller.city || '';
  if (!form.sellerTaxId.value) form.sellerTaxId.value = seller.taxId || '';
  if (!form.sellerAccount.value) form.sellerAccount.value = seller.account || '';
  if (!form.sellerBank.value) form.sellerBank.value = seller.bank || '';
}

function applyClientToInvoice(clientId) {
  const client = state.clients.find(c => c.id === clientId);
  const form = document.getElementById('invoice-form');
  if (!client) {
    form.buyerName.value = '';
    form.buyerAddress.value = '';
    form.buyerCity.value = '';
    form.buyerTaxId.value = '';
    return;
  }
  form.buyerName.value = client.name || '';
  form.buyerAddress.value = client.address || '';
  form.buyerCity.value = client.city || '';
  form.buyerTaxId.value = client.taxId || '';
}

function computeInvoicePreview() {
  const form = document.getElementById('invoice-form');
  const hoursVal = parseHours(form.hours.value);
  const hours = hoursVal === null ? 0 : hoursVal;
  const rate = parseNumber(form.rate.value) || 0;
  const vat = parseNumber(form.vatPercent.value) || 0;
  const manualNet = form.manualNet.value !== '' ? parseNumber(form.manualNet.value) : null;
  const extraNet = form.extraDesc.value && form.extraNet.value !== '' ? (parseNumber(form.extraNet.value) || 0) : 0;
  const net = manualNet !== null ? manualNet : hours * rate;
  const totalNet = manualNet !== null ? manualNet + extraNet : net + extraNet;
  const vatAmount = totalNet * (vat / 100);
  const gross = totalNet + vatAmount;
  const currency = form.currency.value.trim();

  els.previewNet.textContent = formatMoney(net, currency);
  els.previewVat.textContent = formatMoney(vatAmount, currency);
  els.previewGross.textContent = formatMoney(gross, currency);

  els.previewHelper.textContent = totalNet > 0
    ? 'Values shown with current inputs; saved invoices stay on disk only.'
    : 'Fill hours, rate, and VAT to see totals.';
}

async function saveInvoice(event) {
  event.preventDefault();
  const form = event.target;
  ensureInvoiceHours();
  const payload = {
    invoiceNumber: form.invoiceNumber.value.trim(),
    currency: form.currency.value.trim(),
    issueDate: form.issueDate.value || undefined,
    saleDate: form.saleDate.value || undefined,
    dueDays: form.dueDays.value !== '' ? parseNumber(form.dueDays.value) : undefined,
    dueDate: form.dueDate ? form.dueDate.value || undefined : undefined,
    place: form.place.value.trim(),
    hours: form.hours.value !== '' ? parseHours(form.hours.value) : 0,
    rate: form.rate.value !== '' ? parseNumber(form.rate.value) : undefined,
    vatPercent: form.vatPercent.value !== '' ? parseNumber(form.vatPercent.value) : undefined,
    item: {
      desc: form.itemDesc.value.trim(),
      unit: form.itemUnit.value.trim(),
    },
    manualNet: form.manualNet.value !== '' ? parseNumber(form.manualNet.value) : undefined,
    extra: form.extraDesc.value.trim()
      ? { desc: form.extraDesc.value.trim(), net: parseNumber(form.extraNet.value) || 0 }
      : null,
    buyer: {
      name: form.buyerName.value.trim(),
      address: form.buyerAddress.value.trim(),
      city: form.buyerCity.value.trim(),
      taxId: form.buyerTaxId.value.trim(),
    },
    seller: {
      name: form.sellerName.value.trim(),
      address: form.sellerAddress.value.trim(),
      city: form.sellerCity.value.trim(),
      taxId: form.sellerTaxId.value.trim(),
      account: form.sellerAccount.value.trim(),
      bank: form.sellerBank.value.trim(),
    },
  };

  await fetchJson('/api/invoices', { method: 'POST', body: JSON.stringify(payload) });
  await loadInvoices();
}

function resetInvoiceForm() {
  const form = document.getElementById('invoice-form');
  form.reset();
  applyProfileToInvoiceForm();
  computeInvoicePreview();
  state.selectedInvoices.clear();
}

async function loadInvoices() {
  const data = await fetchJson('/api/invoices');
  state.invoices = data.invoices || [];
  renderInvoices();
}

function renderInvoices() {
  els.invoiceList.innerHTML = '';
  const existingIds = new Set(state.invoices.map(inv => inv.id));
  Array.from(state.selectedInvoices).forEach(id => {
    if (!existingIds.has(id)) state.selectedInvoices.delete(id);
  });

  const sorted = state.invoices.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (!sorted.length) {
    els.invoiceList.innerHTML = '<p class="helper">No invoices saved yet.</p>';
  } else {
    sorted.forEach(inv => {
      const card = document.createElement('div');
      card.className = 'invoice-card';
      const buyer = inv.buyer?.name || 'Buyer not set';
      const created = inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : '';
      card.innerHTML = `
        <div class="row">
          <div class="inline">
            <input type="checkbox" name="invoice-select" value="${inv.id}" ${state.selectedInvoices.has(inv.id) ? 'checked' : ''}>
            <strong>${inv.invoiceNumber}</strong>
          </div>
          <div class="actions">
            <button class="danger" data-action="delete-invoice" data-id="${inv.id}">Delete</button>
          </div>
        </div>
        <div class="meta">${buyer}</div>
        <div class="meta">Issue: ${inv.issueDate || ''} · Due: ${inv.dueDate || ''}</div>
        <div class="meta">${formatMoney(inv.totalNet || inv.net, inv.currency)} net · ${formatMoney(inv.gross, inv.currency)} gross</div>
        <div class="meta">Saved ${created}</div>
      `;
      els.invoiceList.appendChild(card);
    });
  }
  els.metricInvoices.textContent = state.invoices.length;
}

async function deleteInvoice(id) {
  if (!confirm('Delete this invoice?')) return;
  await fetchJson(`/api/invoices?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  state.selectedInvoices.delete(id);
  await loadInvoices();
}

async function generatePdfs() {
  try {
    const ids = selectedInvoiceIdsFromDom();
    state.selectedInvoices = new Set(ids);
    if (!ids.length) return alert('Select at least one invoice');
    const result = await fetchJson('/api/invoices/pdf', { method: 'POST', body: JSON.stringify({ ids }) });
    if (Array.isArray(result.files) && result.files.length) {
      result.files.forEach(file => {
        window.open(file.url, '_blank');
      });
      alert('PDFs generated and saved to data/pdfs/.');
    } else {
      alert('No PDF files returned. Make sure invoices exist.');
    }
  } catch (err) {
    console.error(err);
    alert(err.message || 'Could not generate PDFs');
  }
}

function bindEvents() {
  document.getElementById('entry-form').addEventListener('submit', saveEntry);
  els.entriesTable.addEventListener('click', evt => {
    const btn = evt.target.closest('button[data-action="delete-entry"]');
    if (btn) deleteEntry(btn.dataset.date);
  });
  document.getElementById('clear-month').addEventListener('click', clearMonth);
  els.monthFilter.addEventListener('change', () => {
    renderEntries();
    autofillInvoiceHours();
  });

  document.getElementById('client-form').addEventListener('submit', saveClient);
  document.getElementById('reset-client').addEventListener('click', () => document.getElementById('client-form').reset());
  els.clientsList.addEventListener('click', evt => {
    const btn = evt.target.closest('button[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'edit-client') startEditClient(btn.dataset.id);
    if (btn.dataset.action === 'delete-client') deleteClient(btn.dataset.id);
  });

  document.getElementById('profile-form').addEventListener('submit', saveProfile);

  document.getElementById('invoice-form').addEventListener('submit', saveInvoice);
  document.getElementById('invoice-form').addEventListener('input', computeInvoicePreview);
  document.getElementById('invoice-form').addEventListener('change', evt => {
    if (evt.target.name === 'saleDate' || evt.target.name === 'issueDate') {
      autofillInvoiceHours();
    }
  });
  document.getElementById('invoice-client-select').addEventListener('change', evt => applyClientToInvoice(evt.target.value));
  document.getElementById('reset-invoice').addEventListener('click', resetInvoiceForm);
  els.invoiceList.addEventListener('change', evt => {
    if (evt.target.name === 'invoice-select') {
      const id = evt.target.value;
      if (evt.target.checked) state.selectedInvoices.add(id);
      else state.selectedInvoices.delete(id);
    }
  });
  els.invoiceList.addEventListener('click', evt => {
    const btn = evt.target.closest('button[data-action="delete-invoice"]');
    if (btn) deleteInvoice(btn.dataset.id);
  });
  document.getElementById('generate-pdf').addEventListener('click', generatePdfs);
}

async function init() {
  initNav();
  bindEvents();
  setDefaultMonth();
  ensureInvoiceHours();
  computeInvoicePreview();
  try {
    await Promise.all([loadEntries(), loadClients(), loadProfile(), loadInvoices()]);
    autofillInvoiceHours();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Error loading data');
  }
}

init();
