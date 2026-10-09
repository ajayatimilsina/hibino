import { api, connect, requireStaff } from './api.js';
import { $, esc, hhmm, STATUS, STATUS_CLASS, beep, speak, enableAudio, audioReady, navBar, toast } from './util.js';
import { printHtml, ticketHtml, getPrintSettings, setPrintSetting } from './print.js';

await requireStaff();
navBar('kds');

let orders = [];
let seen = null; // order ids already announced on this screen
const claimed = new Set(); // orders this client already tried to print
let printChain = Promise.resolve();

// ---- settings ----
$('#printMode').value = getPrintSettings().mode;
$('#paper').value = getPrintSettings().paper;
$('#autoPrint').checked = localStorage.getItem('autoPrint') !== '0';
$('#printMode').onchange = (e) => setPrintSetting('printMode', e.target.value);
$('#paper').onchange = (e) => setPrintSetting('paper', e.target.value);
$('#autoPrint').onchange = (e) => localStorage.setItem('autoPrint', e.target.checked ? '1' : '0');

// ---- audio ----
$('#audioBtn').onclick = () => { enableAudio(); speak('音声を有効にしました'); };
document.addEventListener('audio-enabled', () => { $('#audioBtn').hidden = true; });
$('#audioBtn').hidden = audioReady();

for (const b of document.querySelectorAll('[data-say]')) {
  b.onclick = () => {
    speak(b.dataset.say);
    api('/s/announce', { method: 'POST', body: { text: b.dataset.say, showCustomers: $('#showCust').checked } }).catch(() => {});
  };
}

// ---- data ----
async function load() {
  orders = (await api('/s/kds')).orders;
  const ids = new Set(orders.map((o) => o.id));
  if (seen) {
    const fresh = orders.filter((o) => !seen.has(o.id));
    if (fresh.length) {
      beep(3);
      fresh.forEach((o) => speak(`${o.table}番テーブル、新規注文です`));
    }
  }
  seen = ids;
  if ($('#autoPrint').checked) {
    for (const o of orders) if (!o.printed && !claimed.has(o.id)) { claimed.add(o.id); queuePrint(o, true); }
  }
  render();
}

function queuePrint(order, claim) {
  printChain = printChain.then(async () => {
    try {
      if (claim && !(await api(`/s/orders/${order.id}/printed`, { method: 'POST' })).first) return;
      await printOrder(order, order.items.filter((l) => l.status !== 'served'));
    } catch (e) { toast('印刷エラー: ' + e.message, 'danger'); }
  });
}

async function printOrder(order, lines) {
  if (getPrintSettings().mode === 'escpos') {
    await api('/s/print/ticket', { method: 'POST', body: { orderId: order.id, lineId: lines.length === 1 ? lines[0].lineId : undefined } });
  } else {
    await printHtml(lines.map((l) => ticketHtml(order, l)).join(''), 'ticket');
  }
}

function render() {
  const tickets = orders.flatMap((o) => o.items.filter((l) => l.status !== 'served').map((l) => ({ o, l })));
  $('#empty').hidden = tickets.length > 0;
  $('#grid').innerHTML = tickets.map(({ o, l }) => `
    <div class="col-12 col-md-6 col-xl-3">
      <div class="ticket-card st-${l.status}" data-order="${o.id}" data-line="${l.lineId}">
        <div class="d-flex justify-content-between align-items-center">
          <span class="t-table">${o.table}番テーブル</span>
          <span class="badge ${STATUS_CLASS[l.status]}">${STATUS[l.status]}</span>
        </div>
        <div class="small text-secondary">${hhmm(o.createdAt)} / #${o.id}</div>
        <div class="t-name mt-2">${esc(l.name)}</div>
        ${l.options.map((x) => `<div class="text-info">+ ${esc(x.name)}</div>`).join('')}
        <div class="t-qty">× ${l.qty}</div>
        ${o.note ? `<div class="alert alert-warning py-1 px-2 mt-2 mb-0 small">備考: ${esc(o.note)}</div>` : ''}
        <div class="d-grid gap-1 mt-2">
          ${l.status === 'new' ? '<button class="btn btn-warning" data-act="cooking">調理開始</button>' : ''}
          ${l.status !== 'ready' ? '<button class="btn btn-success" data-act="ready">完成</button>' : ''}
          <button class="btn btn-info" data-act="pickup">📣 カウンターへ取りに来てください</button>
          ${l.status === 'ready' ? '<button class="btn btn-primary" data-act="served">提供済み</button>' : ''}
          <button class="btn btn-sm btn-outline-light" data-act="print">🖨 再印刷</button>
        </div>
      </div>
    </div>`).join('');
}

$('#grid').onclick = async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('.ticket-card');
  const { order, line } = card.dataset;
  const o = orders.find((x) => x.id === Number(order));
  const l = o.items.find((x) => x.lineId === Number(line));
  const act = btn.dataset.act;
  try {
    if (act === 'print') { await printOrder({ ...o, items: [l] }, [l]); return; }
    if (act === 'pickup') {
      await api(`/s/orders/${order}/items/${line}/pickup`, { method: 'POST' });
      toast(`${o.table}番テーブルへ通知しました`, 'success');
    } else {
      await api(`/s/orders/${order}/items/${line}`, { method: 'PATCH', body: { status: act } });
    }
    load();
  } catch (err) { toast(err.message, 'danger'); }
};

await load();
connect((m) => { if (m.t === 'sync') load(); });
setInterval(load, 20000);
