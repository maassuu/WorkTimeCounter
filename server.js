const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 9898;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const PDF_DIR = path.join(DATA_DIR, 'pdfs');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
};

const DEFAULT_DATA = {
  entries: {},
  clients: [],
  invoices: [],
  profile: {
    seller: {
      name: '',
      address: '',
      city: '',
      taxId: '',
      account: '',
      bank: '',
    },
    defaults: {
      hourlyRate: null,
      vatPercent: 23,
      currency: 'USD',
      invoicePlace: '',
      itemDescription: 'Consulting services',
      itemUnit: 'h',
      dueDays: 14,
    },
  },
};

function cleanText(value) {
  return (value ?? '').toString().trim();
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function parseHoursInput(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.includes(':')) {
      const [h, m] = trimmed.split(':').map(Number);
      if (Number.isFinite(h) && Number.isFinite(m) && h >= 0 && m >= 0 && m < 60) {
        return round2(h + m / 60);
      }
      return null;
    }
    return round2(toNumber(trimmed, 0));
  }
  return round2(toNumber(value, 0));
}

async function ensureDataFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(PDF_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    await fsp.writeFile(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2), 'utf8');
  }
}

function applyDefaults(parsed) {
  const data = { ...DEFAULT_DATA, ...(parsed || {}) };
  data.entries = parsed && typeof parsed.entries === 'object' ? parsed.entries : {};
  data.clients = Array.isArray(parsed?.clients) ? parsed.clients : [];
  data.invoices = Array.isArray(parsed?.invoices) ? parsed.invoices : [];
  data.profile = { ...DEFAULT_DATA.profile, ...(parsed?.profile || {}) };
  data.profile.seller = { ...DEFAULT_DATA.profile.seller, ...(parsed?.profile?.seller || {}) };
  data.profile.defaults = { ...DEFAULT_DATA.profile.defaults, ...(parsed?.profile?.defaults || {}) };
  return data;
}

async function readData() {
  await ensureDataFile();
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    return applyDefaults(JSON.parse(raw));
  } catch (err) {
    console.warn('[data] Unable to read data file, using defaults', err.message);
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

async function writeData(data) {
  await ensureDataFile();
  await fsp.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Request too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getPythonExecutable() {
  const candidates = process.platform === 'win32'
    ? ['venv\\Scripts\\python.exe', '.venv\\Scripts\\python.exe']
    : ['venv/bin/python3.14', 'venv/bin/python3.13', 'venv/bin/python3', '.venv/bin/python3'];
  for (const rel of candidates) {
    const full = path.join(ROOT, rel);
    if (fs.existsSync(full)) return full;
  }
  return 'python3';
}

function sanitizeFileName(text, fallback) {
  const safe = cleanText(text).replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
  return safe || fallback;
}

function computeDueDate(issueDate, dueDays) {
  const base = new Date(issueDate || Date.now());
  if (Number.isNaN(base.getTime())) {
    base.setTime(Date.now());
  }
  const days = Number.isFinite(dueDays) ? dueDays : 0;
  base.setDate(base.getDate() + days);
  return base.toISOString().slice(0, 10);
}

function normalizeParty(party = {}) {
  return {
    name: cleanText(party.name),
    address: cleanText(party.address),
    city: cleanText(party.city),
    taxId: cleanText(party.taxId || party.nip),
    account: cleanText(party.account),
    bank: cleanText(party.bank),
  };
}

function normalizeInvoice(body, profile) {
  const defaults = profile?.defaults || DEFAULT_DATA.profile.defaults;
  const nowIso = new Date().toISOString();
  const issueDate = cleanText(body.issueDate) || nowIso.slice(0, 10);
  const saleDate = cleanText(body.saleDate) || issueDate;
  const dueDays = body.dueDays !== undefined ? toNumber(body.dueDays, defaults.dueDays) : defaults.dueDays;
  const dueDate = cleanText(body.dueDate) || computeDueDate(issueDate, dueDays);
  const vatPercent = body.vatPercent !== undefined ? toNumber(body.vatPercent, defaults.vatPercent) : defaults.vatPercent;
  const hoursVal = parseHoursInput(body.hours);
  const hours = hoursVal === null ? 0 : hoursVal;
  const rate = toNumber(body.rate, defaults.hourlyRate ?? 0);
  const baseNet = round2(hours * rate);
  const extraNet = round2(toNumber(body.extra?.net, 0));
  const manualNet = body.manualNet === 0 || body.manualNet
    ? toNumber(body.manualNet, baseNet)
    : null;
  const netValue = manualNet !== null ? round2(manualNet) : baseNet;
  const totalNet = manualNet !== null ? round2(manualNet + extraNet) : round2(baseNet + extraNet);
  const vatAmount = round2(totalNet * (vatPercent / 100));
  const gross = round2(totalNet + vatAmount);

  const sale = new Date(saleDate || issueDate);
  const month = sale.getMonth() + 1;
  const year = sale.getFullYear();

  const seller = normalizeParty({ ...profile?.seller, ...(body.seller || {}) });
  const buyer = normalizeParty(body.buyer || {});
  const item = {
    desc: cleanText(body.item?.desc) || defaults.itemDescription,
    unit: cleanText(body.item?.unit) || defaults.itemUnit,
  };

  return {
    id: body.id || Date.now().toString(),
    invoiceNumber: cleanText(body.invoiceNumber) || `INV-${Date.now()}`,
    issueDate,
    saleDate,
    dueDate,
    dueDays,
    place: cleanText(body.place) || cleanText(defaults.invoicePlace),
    vatPercent,
    rate,
    hours,
    net: netValue,
    totalNet,
    vatAmount,
    gross,
    seller,
    buyer,
    item,
    extra: extraNet && cleanText(body.extra?.desc)
      ? { desc: cleanText(body.extra.desc), net: extraNet }
      : null,
    manualNet: manualNet !== null ? manualNet : null,
    currency: cleanText(body.currency) || defaults.currency,
    month,
    year,
    createdAt: body.createdAt || nowIso,
  };
}

async function generatePdf(invoice, outputPath) {
  return new Promise((resolve, reject) => {
    const pythonPath = getPythonExecutable();
    const scriptPath = path.join(ROOT, 'generate_invoice_pdf.py');
    const child = spawn(pythonPath, [scriptPath, '--output', outputPath], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(`PDF generator exited with code ${code}`));
    });
    child.stdin.write(JSON.stringify(invoice));
    child.stdin.end();
  });
}

function serveStatic(req, res, url) {
  const isPdfDownload = url.pathname.startsWith('/data/pdfs/');
  const baseDir = isPdfDownload ? DATA_DIR : PUBLIC_DIR;
  const relativePath = isPdfDownload
    ? url.pathname.replace('/data/', '')
    : (url.pathname === '/' ? '/index.html' : url.pathname);
  const safePath = path.normalize(relativePath).replace(/^\/+/, '');
  const filePath = path.join(baseDir, safePath);

  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    if (url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/entries' && req.method === 'GET') {
      const data = await readData();
      return sendJson(res, 200, { entries: data.entries });
    }

    if (url.pathname === '/api/entry' && (req.method === 'POST' || req.method === 'PUT')) {
      try {
        const body = await parseBody(req);
        const { date, hours } = body;
        if (!date || typeof date !== 'string' || Number.isNaN(Date.parse(date))) {
          return sendJson(res, 400, { error: 'Invalid date' });
        }
        const numericHours = parseHoursInput(hours);
        if (numericHours === null || numericHours < 0) {
          return sendJson(res, 400, { error: 'Invalid hours value' });
        }
        const data = await readData();
        data.entries[date] = numericHours;
        await writeData(data);
        return sendJson(res, 200, { ok: true, entries: data.entries });
      } catch (err) {
        console.error('[entries] save failed', err);
        return sendJson(res, 500, { error: 'Could not save entry' });
      }
    }

    if (url.pathname === '/api/entry' && req.method === 'DELETE') {
      const date = url.searchParams.get('date');
      if (!date) return sendJson(res, 400, { error: 'Missing date' });
      const data = await readData();
      delete data.entries[date];
      await writeData(data);
      return sendJson(res, 200, { ok: true, entries: data.entries });
    }

    if (url.pathname === '/api/month' && req.method === 'DELETE') {
      const month = url.searchParams.get('month'); // YYYY-MM
      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        return sendJson(res, 400, { error: 'Month should be YYYY-MM' });
      }
      const [year, mon] = month.split('-').map(Number);
      const data = await readData();
      Object.keys(data.entries).forEach(date => {
        const d = new Date(date);
        if (d.getFullYear() === year && d.getMonth() + 1 === mon) {
          delete data.entries[date];
        }
      });
      await writeData(data);
      return sendJson(res, 200, { ok: true, entries: data.entries });
    }

    if (url.pathname === '/api/clients' && req.method === 'GET') {
      const data = await readData();
      return sendJson(res, 200, { clients: data.clients });
    }

    if (url.pathname === '/api/clients' && (req.method === 'POST' || req.method === 'PUT')) {
      try {
        const body = await parseBody(req);
        const name = cleanText(body.name);
        if (!name) return sendJson(res, 400, { error: 'Client name is required' });
        const record = {
          id: body.id || Date.now().toString(),
          name,
          address: cleanText(body.address),
          city: cleanText(body.city),
          taxId: cleanText(body.taxId),
        };
        const data = await readData();
        const idx = data.clients.findIndex(c => c.id === record.id);
        if (idx >= 0) data.clients[idx] = { ...data.clients[idx], ...record };
        else data.clients.push(record);
        await writeData(data);
        return sendJson(res, 200, { ok: true, clients: data.clients });
      } catch (err) {
        console.error('[clients] save failed', err);
        return sendJson(res, 500, { error: 'Could not save client' });
      }
    }

    if (url.pathname === '/api/clients' && req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return sendJson(res, 400, { error: 'Missing client id' });
      const data = await readData();
      const next = data.clients.filter(c => c.id !== id);
      data.clients = next;
      await writeData(data);
      return sendJson(res, 200, { ok: true, clients: data.clients });
    }

    if (url.pathname === '/api/profile' && req.method === 'GET') {
      const data = await readData();
      return sendJson(res, 200, { profile: data.profile });
    }

    if (url.pathname === '/api/profile' && req.method === 'PUT') {
      try {
        const body = await parseBody(req);
        const data = await readData();
        data.profile = {
          seller: { ...data.profile.seller, ...(body.seller || {}) },
          defaults: { ...data.profile.defaults, ...(body.defaults || {}) },
        };
        await writeData(data);
        return sendJson(res, 200, { ok: true, profile: data.profile });
      } catch (err) {
        console.error('[profile] save failed', err);
        return sendJson(res, 500, { error: 'Could not save profile' });
      }
    }

    if (url.pathname === '/api/invoices' && req.method === 'GET') {
      const data = await readData();
      return sendJson(res, 200, { invoices: data.invoices });
    }

    if (url.pathname === '/api/invoices' && (req.method === 'POST' || req.method === 'PUT')) {
      try {
        const body = await parseBody(req);
        const data = await readData();
        const normalized = normalizeInvoice(body, data.profile);
        const idx = data.invoices.findIndex(inv => inv.id === normalized.id);
        if (idx >= 0) data.invoices[idx] = normalized;
        else data.invoices.push(normalized);
        await writeData(data);
        return sendJson(res, 200, { ok: true, invoiceId: normalized.id });
      } catch (err) {
        console.error('[invoices] save failed', err);
        return sendJson(res, 500, { error: 'Could not save invoice' });
      }
    }

    if (url.pathname === '/api/invoices' && req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return sendJson(res, 400, { error: 'Missing invoice id' });
      const data = await readData();
      data.invoices = data.invoices.filter(inv => inv.id !== id);
      await writeData(data);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/invoices/pdf' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const ids = Array.isArray(body.ids) ? body.ids : [];
        if (!ids.length) return sendJson(res, 400, { error: 'No invoices selected' });
        const data = await readData();
        const selected = data.invoices.filter(inv => ids.includes(inv.id));
        if (!selected.length) return sendJson(res, 404, { error: 'Invoices not found' });

        await fsp.mkdir(PDF_DIR, { recursive: true });
        const results = [];
        for (const inv of selected) {
          const base = sanitizeFileName(inv.invoiceNumber || inv.id || Date.now().toString(), 'invoice');
          const fileName = `${base}_${inv.id}.pdf`;
          const outputPath = path.join(PDF_DIR, fileName);
          await generatePdf(inv, outputPath);
          results.push({ id: inv.id, file: fileName, url: `/data/pdfs/${fileName}` });
        }
        return sendJson(res, 200, { ok: true, files: results });
      } catch (err) {
        console.error('[pdf] generation failed', err);
        return sendJson(res, 500, { error: 'Could not generate PDF' });
      }
    }

    serveStatic(req, res, url);
  } catch (err) {
    console.error('Unexpected error', err);
    sendJson(res, 500, { error: 'Unexpected server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Counter running on http://localhost:${PORT}`);
});
