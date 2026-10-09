import { api, requireStaff } from './api.js';
import { $, esc, yen, today, navBar, toast } from './util.js';

await requireStaff();
navBar('finance');

const TYPE = { expense: '経費', labor: '人件費', other: 'その他' };
let summary = { rows: [], totals: {} };
let entries = [];

$('#month').value = today().slice(0, 7);
$('#year').value = new Date().getFullYear();
$('#eDate').value = today();

async function load() {
  const monthly = $('#mode').value === 'monthly';
  $('#month').hidden = monthly;
  $('#year').hidden = !monthly;
  const q = monthly ? `mode=monthly&year=${$('#year').value}` : `mode=daily&month=${$('#month').value}`;
  summary = await api('/s/finance/summary?' + q);
  entries = monthly ? [] : (await api('/s/finance?month=' + $('#month').value)).entries;
  if (monthly) entries = (await Promise.all(Array.from({ length: 12 }, (_, i) => api(`/s/finance?month=${$('#year').value}-${String(i + 1).padStart(2, '0')}`)))).flatMap((r) => r.entries);
  renderCards(); renderEntries(); drawChart();
}

function renderCards() {
  const t = summary.totals;
  const card = (label, v, cls = '') => `<div class="col-6 col-md"><div class="card card-body py-2"><small class="text-muted">${label}</small><div class="fs-5 fw-bold yen ${cls}">${yen(v)}</div></div></div>`;
  $('#cards').innerHTML = card('売上', t.sales) + card('経費', t.expense) + card('人件費', t.labor) + card('その他', t.other)
    + card(t.profit >= 0 ? '利益' : '損失', t.profit, t.profit >= 0 ? 'text-success' : 'text-danger');
}

function renderEntries() {
  $('#entries').innerHTML = entries.map((e) => `
    <tr><td>${e.date}</td><td>${TYPE[e.type]}</td><td>${esc(e.category)}</td><td class="text-end yen">${yen(e.amount)}</td><td>${esc(e.memo)}</td>
    <td class="text-end"><button class="btn btn-sm btn-outline-danger" data-del="${e.id}">削除</button></td></tr>`).join('');
}

// Simple canvas chart: bars = sales / costs, dots+line = profit.
function drawChart() {
  const cv = $('#chart');
  const W = (cv.width = cv.parentElement.clientWidth - 32);
  const H = cv.height;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  const rows = summary.rows;
  const padL = 60, padB = 24, padT = 10;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.sales, r.cost, Math.abs(r.profit))));
  const min = Math.min(0, ...rows.map((r) => r.profit));
  const span = max - min;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - min) / span);
  g.font = '11px sans-serif';
  g.strokeStyle = '#ddd'; g.fillStyle = '#666';
  for (let i = 0; i <= 4; i++) {
    const v = min + (span * i) / 4;
    g.beginPath(); g.moveTo(padL, y(v)); g.lineTo(W, y(v)); g.stroke();
    g.fillText(Math.round(v).toLocaleString(), 2, y(v) + 4);
  }
  const slot = (W - padL) / rows.length;
  const bw = Math.max(2, slot * 0.35);
  rows.forEach((r, i) => {
    const x = padL + i * slot + slot / 2;
    g.fillStyle = '#198754'; g.fillRect(x - bw, y(r.sales), bw, y(0) - y(r.sales));
    g.fillStyle = '#dc3545'; g.fillRect(x, y(r.cost), bw, y(0) - y(r.cost));
    g.fillStyle = '#666';
    if (rows.length <= 12 || i % 5 === 0) g.fillText(r.key.slice(rows.length > 12 ? 8 : 5), x - 6, H - 8);
  });
  g.strokeStyle = '#0d6efd'; g.fillStyle = '#0d6efd'; g.lineWidth = 2; g.beginPath();
  rows.forEach((r, i) => { const x = padL + i * slot + slot / 2; i ? g.lineTo(x, y(r.profit)) : g.moveTo(x, y(r.profit)); });
  g.stroke();
  rows.forEach((r, i) => { g.beginPath(); g.arc(padL + i * slot + slot / 2, y(r.profit), 3, 0, 7); g.fill(); });
}

// CSV with BOM so Excel opens Japanese text correctly.
function downloadCsv(name, lines) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['\ufeff' + lines.map((l) => l.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}
$('#csvSummary').onclick = () => downloadCsv('pl.csv', [
  ['期間', '売上', '経費', '人件費', 'その他', '利益/損失'],
  ...summary.rows.map((r) => [r.key, r.sales, r.expense, r.labor, r.other, r.profit]),
  ['合計', ...['sales', 'expense', 'labor', 'other', 'profit'].map((k) => summary.totals[k])],
]);
$('#csvEntries').onclick = () => downloadCsv('entries.csv', [
  ['日付', '種別', '科目', '金額', 'メモ'], ...entries.map((e) => [e.date, TYPE[e.type], e.category, e.amount, e.memo]),
]);

$('#entryForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/s/finance', { method: 'POST', body: { date: $('#eDate').value, type: $('#eType').value, category: $('#eCat').value, amount: $('#eAmount').value, memo: $('#eMemo').value } });
    $('#eAmount').value = $('#eMemo').value = $('#eCat').value = '';
    toast('追加しました', 'success');
    load();
  } catch (err) { toast(err.message, 'danger'); }
};
$('#entries').onclick = async (e) => {
  const b = e.target.closest('[data-del]');
  if (b && confirm('削除しますか？')) { await api(`/s/finance/${b.dataset.del}`, { method: 'DELETE' }); load(); }
};
for (const id of ['#mode', '#month', '#year']) $(id).onchange = load;
window.addEventListener('resize', drawChart);

load();
