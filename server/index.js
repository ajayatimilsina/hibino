import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { db, load, save } from './store.js';
import { send, ticketBuffer, receiptBuffer } from './escpos.js';

load();
const PIN = String(process.env.STAFF_PIN || db.settings.pin);
const PORT = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(here, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const tokens = new Set();

wss.on('connection', (ws, req) => {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  ws.staff = tokens.has(token);
});

// Public events go to everyone; staff-only events (new order, call) only to authenticated sockets.
function emit(msg, staffOnly = false) {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === 1 && (!staffOnly || c.staff)) c.send(s);
}
function commit(res, data = { ok: true }) {
  save();
  emit({ t: 'sync' });
  res.json(data);
}

// ---------- helpers ----------
const now = () => Date.now();
const pad = (n) => String(n).padStart(2, '0');
const ymd = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const next = (k) => db.counters[k]++;
const tbl = (n) => (db.tables[n] ??= { call: null, notice: null, receipt: { needed: false, name: '' } });
const validTable = (v) => { const n = parseInt(v, 10); return n >= 1 && n <= db.settings.tableCount ? n : 0; };
const lineAmount = (l) => (l.unitPrice + l.options.reduce((s, o) => s + o.price, 0)) * l.qty;
const orderTotal = (o) => o.items.reduce((s, l) => s + lineAmount(l), 0);
const openOrders = (n) => db.orders.filter((o) => o.table === n && !o.paid);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const STATUSES = ['new', 'cooking', 'ready', 'served'];

function categories() {
  const present = [...new Set(db.menu.map((m) => m.category))];
  const order = db.settings.categoryOrder;
  return [...order.filter((c) => present.includes(c)), ...present.filter((c) => !order.includes(c))];
}

// Every stock change goes through here: logs it and auto-sets 欠品 at 0.
function adjustStock(m, newStock, type, ref = null) {
  const before = m.stock;
  m.stock = Math.max(0, newStock);
  if (m.stock === 0) m.soldOut = true;
  db.stockLog.push({ id: next('log'), ts: now(), itemId: m.id, name: m.name, type, ref, before, after: m.stock });
  if (db.stockLog.length > 2000) db.stockLog.splice(0, db.stockLog.length - 2000);
}

// ---------- auth ----------
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const fails = new Map(); // ip -> {count, until}
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const f = fails.get(ip);
  if (f && f.count >= 5 && f.until > now()) return bad(res, '試行回数が多すぎます。しばらくお待ちください', 429);
  if (crypto.timingSafeEqual(sha(req.body?.pin ?? ''), sha(PIN))) {
    fails.delete(ip);
    const token = crypto.randomBytes(24).toString('hex');
    tokens.add(token);
    return res.json({ token });
  }
  fails.set(ip, { count: (f?.count || 0) + 1, until: now() + 60_000 });
  bad(res, 'PINが違います', 401);
});

const staff = express.Router();
staff.use((req, res, next) => (tokens.has(req.get('x-token')) ? next() : bad(res, 'unauthorized', 401)));
app.use('/api/s', staff);
staff.get('/ping', (req, res) => res.json({ ok: true }));

// ---------- public (customer) API ----------
app.get('/api/menu', (req, res) => {
  res.json({
    shop: db.settings.shopName,
    tableCount: db.settings.tableCount,
    categories: categories(),
    items: db.menu.map((m) => ({ ...m, available: !m.soldOut && m.stock > 0, stock: undefined })),
  });
});

app.get('/api/tables/:n', (req, res) => {
  const n = validTable(req.params.n);
  if (!n) return bad(res, 'テーブル番号が正しくありません');
  const t = tbl(n);
  const orders = openOrders(n).map((o) => ({
    id: o.id, createdAt: o.createdAt, note: o.note,
    items: o.items.map((l) => ({ name: l.name, qty: l.qty, options: l.options.map((x) => x.name), status: l.status })),
  }));
  res.json({
    notice: t.notice, receipt: t.receipt, orders,
    total: openOrders(n).reduce((s, o) => s + orderTotal(o), 0),
  });
});

function setReceipt(n, r) {
  if (!r) return;
  tbl(n).receipt = { needed: !!r.needed, name: r.needed ? String(r.name || '').slice(0, 60) : '' };
}

app.post('/api/orders', (req, res) => {
  const { table, items, note, receipt } = req.body || {};
  const n = validTable(table);
  if (!n) return bad(res, 'テーブル番号が正しくありません');
  if (!Array.isArray(items) || !items.length || items.length > 50) return bad(res, '注文内容が正しくありません');

  const need = {};
  const lines = [];
  for (const it of items) {
    const m = db.menu.find((x) => x.id === Number(it.itemId));
    const qty = Math.floor(Number(it.qty));
    if (!m || !(qty >= 1 && qty <= 20)) return bad(res, '注文内容が正しくありません');
    if (m.soldOut || m.stock <= 0) return bad(res, `${m.name}は欠品です`, 409);
    need[m.id] = (need[m.id] || 0) + qty;
    const options = (Array.isArray(it.options) ? it.options : [])
      .map((name) => m.options.find((o) => o.name === name)).filter(Boolean)
      .map((o) => ({ name: o.name, price: o.price }));
    lines.push({ lineId: next('line'), itemId: m.id, name: m.name, qty, unitPrice: m.price, options, status: 'new' });
  }
  for (const [id, q] of Object.entries(need)) {
    const m = db.menu.find((x) => x.id === Number(id));
    if (m.stock < q) return bad(res, `${m.name}は在庫が足りません（残り${m.stock}）`, 409);
  }

  const order = {
    id: next('order'), table: n, createdAt: now(), note: String(note || '').slice(0, 200),
    items: lines, printed: false, paid: false,
    receipt: receipt?.needed ? { needed: true, name: String(receipt.name || '').slice(0, 60) } : { needed: false, name: '' },
  };
  for (const [id, q] of Object.entries(need)) {
    const m = db.menu.find((x) => x.id === Number(id));
    adjustStock(m, m.stock - q, 'order', order.id);
  }
  db.orders.push(order);
  setReceipt(n, receipt);
  save();
  emit({ t: 'sync' });
  emit({ t: 'order', orderId: order.id, table: n }, true);
  res.json({ orderId: order.id });
});

app.post('/api/tables/:n/call', (req, res) => {
  const n = validTable(req.params.n);
  if (!n) return bad(res, 'テーブル番号が正しくありません');
  tbl(n).call = now();
  save();
  emit({ t: 'sync' });
  emit({ t: 'call', table: n }, true);
  res.json({ ok: true });
});

app.post('/api/tables/:n/receipt', (req, res) => {
  const n = validTable(req.params.n);
  if (!n) return bad(res, 'テーブル番号が正しくありません');
  setReceipt(n, req.body);
  commit(res);
});

app.post('/api/tables/:n/notice/clear', (req, res) => {
  const n = validTable(req.params.n);
  if (!n) return bad(res, 'テーブル番号が正しくありません');
  tbl(n).notice = null;
  commit(res);
});

// ---------- staff: state / KDS ----------
staff.get('/state', (req, res) => {
  const tables = [];
  for (let n = 1; n <= db.settings.tableCount; n++) {
    const os = openOrders(n);
    const t = tbl(n);
    tables.push({ n, orderCount: os.length, total: os.reduce((s, o) => s + orderTotal(o), 0), call: t.call, receipt: t.receipt });
  }
  res.json({ tables, shop: db.settings.shopName, taxRate: db.settings.taxRate });
});

// Kitchen view: prices are stripped on purpose.
staff.get('/kds', (req, res) => {
  const orders = db.orders
    .filter((o) => !o.paid && o.items.some((l) => l.status !== 'served'))
    .map((o) => ({
      id: o.id, table: o.table, createdAt: o.createdAt, note: o.note, printed: o.printed,
      items: o.items.map((l) => ({ lineId: l.lineId, name: l.name, qty: l.qty, options: l.options.map((x) => ({ name: x.name })), status: l.status })),
    }));
  res.json({ orders, shop: db.settings.shopName });
});

function findLine(req) {
  const o = db.orders.find((x) => x.id === Number(req.params.id));
  return { o, l: o?.items.find((x) => x.lineId === Number(req.params.lineId)) };
}

staff.patch('/orders/:id/items/:lineId', (req, res) => {
  const { l } = findLine(req);
  if (!l || !STATUSES.includes(req.body?.status)) return bad(res, '不正なリクエスト');
  l.status = req.body.status;
  commit(res);
});

// Pickup notice: stored at tables[n].notice, watched by the customer screen.
staff.post('/orders/:id/items/:lineId/pickup', (req, res) => {
  const { o, l } = findLine(req);
  if (!l) return bad(res, '不正なリクエスト', 404);
  if (l.status !== 'served') l.status = 'ready';
  tbl(o.table).notice = { type: 'pickup', orderId: o.id, timestamp: now() };
  commit(res);
});

// First caller wins, so only one KDS prints each order.
staff.post('/orders/:id/printed', (req, res) => {
  const o = db.orders.find((x) => x.id === Number(req.params.id));
  if (!o) return bad(res, 'not found', 404);
  if (o.printed) return res.json({ first: false });
  o.printed = true;
  save();
  res.json({ first: true });
});

staff.post('/announce', (req, res) => {
  const text = String(req.body?.text || '').slice(0, 100);
  if (req.body?.showCustomers && text) emit({ t: 'announce', text });
  res.json({ ok: true });
});

// ---------- staff: POS ----------
staff.post('/tables/:n/call/clear', (req, res) => {
  const n = validTable(req.params.n);
  if (!n) return bad(res, 'テーブル番号が正しくありません');
  tbl(n).call = null;
  commit(res);
});

staff.get('/tables/:n', (req, res) => {
  const n = validTable(req.params.n);
  if (!n) return bad(res, 'テーブル番号が正しくありません');
  const open = openOrders(n).map((o) => ({ ...o, total: orderTotal(o) }));
  res.json({
    table: n, ...tbl(n), orders: open,
    subtotal: open.reduce((s, o) => s + o.total, 0),
    history: db.sales.filter((s) => s.table === n && s.date === ymd(now())),
  });
});

staff.post('/tables/:n/checkout', (req, res) => {
  const n = validTable(req.params.n);
  if (!n) return bad(res, 'テーブル番号が正しくありません');
  const { method, discountType, discountValue } = req.body || {};
  if (!['cash', 'paypay', 'card'].includes(method)) return bad(res, '支払い方法を選択してください');
  const os = openOrders(n);
  if (!os.length) return bad(res, '未会計の注文がありません');

  const lines = os.flatMap((o) => o.items.map((l) => ({
    name: l.name, qty: l.qty, unit: l.unitPrice, options: l.options, amount: lineAmount(l),
  })));
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  let dv = Math.max(0, Number(discountValue) || 0);
  let da = 0;
  if (discountType === 'percent') { dv = Math.min(dv, 100); da = Math.floor((subtotal * dv) / 100); }
  else if (discountType === 'yen') { dv = Math.floor(dv); da = Math.min(dv, subtotal); }

  const t = tbl(n);
  const ts = now();
  const sale = {
    id: next('sale'), closedAt: ts, date: ymd(ts), table: n, orderIds: os.map((o) => o.id), lines,
    subtotal, discountType: da ? discountType : null, discountValue: da ? dv : 0, discountAmount: da,
    total: subtotal - da, method, receipt: { ...t.receipt },
  };
  db.sales.push(sale);
  os.forEach((o) => { o.paid = true; o.saleId = sale.id; });
  t.receipt = { needed: false, name: '' };
  t.call = null;
  t.notice = { type: 'thanks', timestamp: ts };
  commit(res, { sale });
});

staff.get('/sales', (req, res) => {
  const date = req.query.date || ymd(now());
  res.json({ sales: db.sales.filter((s) => s.date === date).reverse() });
});

staff.get('/daily', (req, res) => {
  const date = req.query.date || ymd(now());
  const sales = db.sales.filter((s) => s.date === date);
  const byMethod = { cash: { count: 0, total: 0 }, card: { count: 0, total: 0 }, paypay: { count: 0, total: 0 } };
  for (const s of sales) { byMethod[s.method].count++; byMethod[s.method].total += s.total; }
  res.json({
    date, shop: db.settings.shopName, count: sales.length, byMethod,
    subtotal: sales.reduce((a, s) => a + s.subtotal, 0),
    discount: sales.reduce((a, s) => a + s.discountAmount, 0),
    total: sales.reduce((a, s) => a + s.total, 0),
    receiptCount: sales.filter((s) => s.receipt?.needed).length,
  });
});

// ---------- staff: menu ----------
function parseItem(b) {
  const id = Math.floor(Number(b.id));
  const price = Math.floor(Number(b.price));
  const stock = Math.floor(Number(b.stock ?? 0));
  const name = String(b.name || '').trim().slice(0, 80);
  const category = String(b.category || '').trim().slice(0, 30);
  if (!(id > 0) || !name || !category || !(price >= 0) || !(stock >= 0)) return null;
  const options = (Array.isArray(b.options) ? b.options : [])
    .map((o) => ({ name: String(o.name || '').trim().slice(0, 60), price: Math.floor(Number(o.price) || 0) }))
    .filter((o) => o.name);
  return { id, name, category, price, stock, options, soldOut: !!b.soldOut };
}

staff.get('/menu', (req, res) => res.json({ items: db.menu, categories: categories() }));

staff.post('/menu', (req, res) => {
  const it = parseItem(req.body || {});
  if (!it) return bad(res, '入力内容が正しくありません');
  if (db.menu.some((m) => m.id === it.id)) return bad(res, 'このIDは既に使われています', 409);
  db.menu.push(it);
  db.menu.sort((a, b) => a.id - b.id);
  commit(res);
});

staff.put('/menu/:id', (req, res) => {
  const m = db.menu.find((x) => x.id === Number(req.params.id));
  const it = parseItem({ ...req.body, id: req.params.id });
  if (!m || !it) return bad(res, '入力内容が正しくありません');
  if (it.stock !== m.stock) adjustStock(m, it.stock, 'adjust');
  Object.assign(m, { ...it, stock: m.stock, soldOut: it.soldOut || m.stock === 0 });
  commit(res);
});

staff.patch('/menu/:id/soldout', (req, res) => {
  const m = db.menu.find((x) => x.id === Number(req.params.id));
  if (!m) return bad(res, 'not found', 404);
  m.soldOut = !!req.body?.soldOut;
  commit(res);
});

staff.delete('/menu/:id', (req, res) => {
  const i = db.menu.findIndex((x) => x.id === Number(req.params.id));
  if (i < 0) return bad(res, 'not found', 404);
  db.menu.splice(i, 1);
  commit(res);
});

// ---------- staff: inventory ----------
staff.get('/inventory', (req, res) => {
  res.json({ items: db.menu, threshold: db.settings.lowStockThreshold, takes: db.stocktakes.slice(-100).reverse() });
});

staff.post('/stocktake', (req, res) => {
  const counts = Array.isArray(req.body?.counts) ? req.body.counts : [];
  const results = [];
  for (const c of counts) {
    const m = db.menu.find((x) => x.id === Number(c.itemId));
    const actual = Math.floor(Number(c.actual));
    if (!m || !(actual >= 0)) continue;
    const system = m.stock;
    const rec = { id: next('take'), ts: now(), itemId: m.id, name: m.name, system, actual, diff: actual - system };
    db.stocktakes.push(rec);
    adjustStock(m, actual, 'stocktake', rec.id);
    if (actual > 0) m.soldOut = false;
    results.push(rec);
  }
  commit(res, { results });
});

// ---------- staff: finance ----------
const FIN_TYPES = ['expense', 'labor', 'other'];

staff.get('/finance', (req, res) => {
  const month = String(req.query.month || ymd(now()).slice(0, 7));
  res.json({ entries: db.finance.filter((e) => e.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date)) });
});

staff.post('/finance', (req, res) => {
  const b = req.body || {};
  const amount = Math.floor(Number(b.amount));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !FIN_TYPES.includes(b.type) || !(amount >= 0)) return bad(res, '入力内容が正しくありません');
  db.finance.push({ id: next('fin'), date: b.date, type: b.type, category: String(b.category || '').slice(0, 40), amount, memo: String(b.memo || '').slice(0, 200) });
  commit(res);
});

staff.delete('/finance/:id', (req, res) => {
  const i = db.finance.findIndex((e) => e.id === Number(req.params.id));
  if (i < 0) return bad(res, 'not found', 404);
  db.finance.splice(i, 1);
  commit(res);
});

staff.get('/finance/summary', (req, res) => {
  const monthly = req.query.mode === 'monthly';
  const keyOf = monthly ? (d) => d.slice(0, 7) : (d) => d;
  let keys;
  if (monthly) {
    const y = Number(req.query.year) || new Date().getFullYear();
    keys = Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`);
  } else {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : ymd(now()).slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    keys = Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => `${month}-${pad(i + 1)}`);
  }
  const rows = Object.fromEntries(keys.map((k) => [k, { key: k, sales: 0, expense: 0, labor: 0, other: 0 }]));
  for (const s of db.sales) { const r = rows[keyOf(s.date)]; if (r) r.sales += s.total; }
  for (const e of db.finance) { const r = rows[keyOf(e.date)]; if (r) r[e.type] += e.amount; }
  const out = Object.values(rows).map((r) => ({ ...r, cost: r.expense + r.labor + r.other, profit: r.sales - r.expense - r.labor - r.other }));
  const sum = (k) => out.reduce((a, r) => a + r[k], 0);
  res.json({ rows: out, totals: { sales: sum('sales'), expense: sum('expense'), labor: sum('labor'), other: sum('other'), cost: sum('cost'), profit: sum('profit') } });
});

// ---------- staff: ESC/POS printing (optional) ----------
staff.post('/print/ticket', async (req, res) => {
  const addr = db.settings.printers.kitchen;
  const o = db.orders.find((x) => x.id === Number(req.body?.orderId));
  if (!addr) return bad(res, '厨房プリンタが設定されていません (settings.printers.kitchen)', 501);
  if (!o) return bad(res, 'not found', 404);
  const lineId = Number(req.body?.lineId);
  const part = lineId ? { ...o, items: o.items.filter((l) => l.lineId === lineId) } : o;
  try { await send(addr, ticketBuffer(part)); res.json({ ok: true }); } catch (e) { bad(res, e.message, 502); }
});

staff.post('/print/receipt', async (req, res) => {
  const addr = db.settings.printers.receipt;
  const s = db.sales.find((x) => x.id === Number(req.body?.saleId));
  if (!addr) return bad(res, 'レシートプリンタが設定されていません (settings.printers.receipt)', 501);
  if (!s) return bad(res, 'not found', 404);
  const copy = req.body?.name ? { ...s, receipt: { needed: true, name: String(req.body.name).slice(0, 60) } } : s;
  try { await send(addr, receiptBuffer(copy, db.settings.shopName, req.body?.kind)); res.json({ ok: true }); } catch (e) { bad(res, e.message, 502); }
});

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}  (staff PIN: ${PIN === '1234' ? '1234 - change it!' : 'set'})`));
