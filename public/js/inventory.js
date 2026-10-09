import { api, connect, requireStaff } from './api.js';
import { $, esc, navBar, toast } from './util.js';

await requireStaff();
navBar('inventory');

let items = [];
let threshold = 5;
const typed = {}; // keeps entered counts across live refreshes

function badge(m) {
  if (m.soldOut || m.stock <= 0) return '<span class="badge bg-secondary">欠品</span>';
  if (m.stock < threshold) return '<span class="badge bg-warning text-dark">残りわずか</span>';
  return '<span class="badge bg-success">OK</span>';
}

function diffText(m, v) {
  if (v === '' || v === undefined) return '';
  const d = Number(v) - m.stock;
  return `<span class="${d < 0 ? 'text-danger' : d > 0 ? 'text-primary' : ''}">${d > 0 ? '+' : ''}${d}</span>`;
}

async function load() {
  const d = await api('/s/inventory');
  items = d.items;
  threshold = d.threshold;
  $('#th').textContent = threshold;
  $('#rows').innerHTML = items.map((m) => `
    <tr class="${m.stock < threshold ? 'table-warning' : ''}">
      <td>${m.id}</td><td>${esc(m.name)}</td><td>${badge(m)}</td>
      <td class="text-end fw-bold">${m.stock}</td>
      <td><input type="number" min="0" class="form-control form-control-sm" data-in="${m.id}" value="${typed[m.id] ?? ''}"></td>
      <td class="text-end" id="diff${m.id}">${diffText(m, typed[m.id])}</td>
      <td><button class="btn btn-sm btn-outline-primary" data-save="${m.id}">確定</button></td>
    </tr>`).join('');
  $('#takes').innerHTML = d.takes.map((t) => `
    <tr><td>${new Date(t.ts).toLocaleString('ja-JP')}</td><td>${esc(t.name)}</td><td class="text-end">${t.system}</td><td class="text-end">${t.actual}</td>
    <td class="text-end ${t.diff < 0 ? 'text-danger' : ''}">${t.diff > 0 ? '+' : ''}${t.diff}</td></tr>`).join('');
}

$('#rows').oninput = (e) => {
  const i = e.target.closest('[data-in]');
  if (!i) return;
  typed[i.dataset.in] = i.value;
  $(`#diff${i.dataset.in}`).innerHTML = diffText(items.find((m) => m.id === Number(i.dataset.in)), i.value);
};

async function submit(ids) {
  const counts = ids.filter((id) => typed[id] !== undefined && typed[id] !== '').map((id) => ({ itemId: id, actual: typed[id] }));
  if (!counts.length) return toast('実数を入力してください', 'warning');
  try {
    await api('/s/stocktake', { method: 'POST', body: { counts } });
    counts.forEach((c) => delete typed[c.itemId]);
    toast('棚卸を確定しました', 'success');
    load();
  } catch (e) { toast(e.message, 'danger'); }
}
$('#rows').onclick = (e) => { const b = e.target.closest('[data-save]'); if (b) submit([Number(b.dataset.save)]); };
$('#saveAll').onclick = () => submit(items.map((m) => m.id));

await load();
connect((m) => { if (m.t === 'sync' && !document.activeElement?.dataset?.in) load(); });
