import { api, connect, requireStaff } from './api.js';
import { $, $$, esc, yen, hhmm, today, STATUS, STATUS_CLASS, METHOD, beep, speak, autoEnableAudio, navBar, toast } from './util.js';
import { printHtml, receiptHtml, dailyHtml, getPrintSettings, setPrintSetting } from './print.js';

await requireStaff();
navBar('pos');
autoEnableAudio();

let info = { tables: [], shop: '' };
let selected = null;
let detail = null;
let daily = null;

$('#printMode').value = getPrintSettings().mode;
$('#paper').value = getPrintSettings().paper;
$('#printMode').onchange = (e) => setPrintSetting('printMode', e.target.value);
$('#paper').onchange = (e) => setPrintSetting('paper', e.target.value);

// ---------- tables ----------
async function loadState() {
  info = await api('/s/state');
  renderTables();
  renderCalls();
  if (selected) await loadDetail();
}

function renderTables() {
  $('#tables').innerHTML = info.tables.map((t) => `
    <div class="col-6 col-md-4">
      <div class="card table-tile ${t.orderCount ? 'busy' : ''} ${t.call ? 'calling' : ''} ${t.n === selected ? 'active' : ''}" data-n="${t.n}">
        <div class="card-body p-2">
          <div class="d-flex justify-content-between"><strong class="fs-5">T${t.n}</strong>
            ${t.call ? '<span class="badge bg-danger">🔔呼出</span>' : ''}</div>
          <div class="yen fs-5">${t.orderCount ? yen(t.total) : '空席'}</div>
          ${t.receipt.needed ? '<span class="badge bg-info text-dark">領収書</span>' : ''}
        </div>
      </div>
    </div>`).join('');
}
$('#tables').onclick = (e) => {
  const c = e.target.closest('[data-n]');
  if (c) { selected = Number(c.dataset.n); renderTables(); loadDetail(); }
};

function renderCalls() {
  $('#calls').innerHTML = info.tables.filter((t) => t.call).map((t) => `
    <div class="alert alert-danger d-flex justify-content-between align-items-center py-2 mb-2">
      <strong>🔔 ${t.n}番テーブルが店員を呼んでいます（${hhmm(t.call)}）</strong>
      <button class="btn btn-sm btn-light" data-clear="${t.n}">対応済み</button>
    </div>`).join('');
}
$('#calls').onclick = async (e) => {
  const b = e.target.closest('[data-clear]');
  if (b) { await api(`/s/tables/${b.dataset.clear}/call/clear`, { method: 'POST' }); loadState(); }
};

// ---------- detail / checkout ----------
async function loadDetail() {
  detail = await api(`/s/tables/${selected}`);
  renderDetail();
}

function calcDiscount(subtotal) {
  const v = Math.max(0, Number($('#discValue')?.value) || 0);
  const type = $('#discType')?.value;
  if (type === 'percent') return Math.floor((subtotal * Math.min(v, 100)) / 100);
  return Math.min(Math.floor(v), subtotal);
}

function renderDetail() {
  const d = detail;
  const keep = { type: $('#discType')?.value, val: $('#discValue')?.value, m: $('input[name=method]:checked')?.value };
  $('#detail').className = 'card card-body';
  $('#detail').innerHTML = `
    <h5>テーブル ${d.table} ${d.receipt.needed ? `<span class="badge bg-info text-dark">領収書希望 宛名: ${esc(d.receipt.name || '(未入力)')}</span>` : ''}</h5>
    ${d.orders.length ? d.orders.map((o) => `
      <div class="border rounded p-2 mb-2">
        <div class="d-flex justify-content-between small text-muted"><span>#${o.id} ${hhmm(o.createdAt)}</span><span class="yen">${yen(o.total)}</span></div>
        ${o.items.map((l) => `
          <div class="d-flex justify-content-between">
            <span>${esc(l.name)} × ${l.qty}${l.options.length ? `<small class="text-muted"> (${l.options.map((x) => esc(x.name)).join(', ')})</small>` : ''}</span>
            <span><span class="badge ${STATUS_CLASS[l.status]}">${STATUS[l.status]}</span>
              <span class="yen">${yen((l.unitPrice + l.options.reduce((s, x) => s + x.price, 0)) * l.qty)}</span></span>
          </div>`).join('')}
        ${o.note ? `<div class="small text-warning-emphasis">備考: ${esc(o.note)}</div>` : ''}
      </div>`).join('') : '<div class="text-muted">未会計の注文はありません</div>'}
    ${d.orders.length ? `
    <hr>
    <div class="row g-2 align-items-end">
      <div class="col-6 col-md-4"><label class="form-label small">割引</label>
        <select id="discType" class="form-select"><option value="yen">¥</option><option value="percent">%</option></select></div>
      <div class="col-6 col-md-4"><label class="form-label small">割引値</label><input id="discValue" type="number" min="0" class="form-control" value="0"></div>
    </div>
    <div class="mt-2">${['cash', 'card', 'paypay'].map((m) => `
      <div class="form-check form-check-inline"><input class="form-check-input" type="radio" name="method" id="m_${m}" value="${m}">
      <label class="form-check-label" for="m_${m}">${METHOD[m]}</label></div>`).join('')}</div>
    <div class="mt-3 fs-5">小計 <span class="yen">${yen(d.subtotal)}</span> / 割引 <span id="discOut" class="yen">-¥0</span></div>
    <div class="fs-3 fw-bold">合計 <span id="totalOut" class="yen">${yen(d.subtotal)}</span></div>
    <button id="checkoutBtn" class="btn btn-danger btn-lg mt-2">会計完了（テーブルを閉じる）</button>` : ''}
    ${d.history.length ? `<hr><h6>本日の会計済み</h6>${d.history.map((s) => `
      <div class="d-flex justify-content-between small"><span>No.${s.id} ${hhmm(s.closedAt)} ${METHOD[s.method]}</span><span class="yen">${yen(s.total)}</span></div>`).join('')}` : ''}`;
  if (keep.type) { $('#discType').value = keep.type; $('#discValue').value = keep.val; }
  if (keep.m) $(`#m_${keep.m}`).checked = true;
  updateTotals();
}

function updateTotals() {
  if (!$('#discOut')) return;
  const da = calcDiscount(detail.subtotal);
  $('#discOut').textContent = '-' + yen(da);
  $('#totalOut').textContent = yen(detail.subtotal - da);
}
$('#detail').oninput = updateTotals;
$('#detail').onchange = updateTotals;

$('#detail').onclick = async (e) => {
  if (!e.target.closest('#checkoutBtn')) return;
  const method = $('input[name=method]:checked')?.value;
  if (!method) return toast('支払い方法を選択してください', 'warning');
  if (!confirm(`${yen(detail.subtotal - calcDiscount(detail.subtotal))} を ${METHOD[method]} で会計しますか？`)) return;
  try {
    const { sale } = await api(`/s/tables/${selected}/checkout`, {
      method: 'POST', body: { method, discountType: $('#discType').value, discountValue: $('#discValue').value },
    });
    toast('会計が完了しました', 'success');
    await loadState();
    await printSale(sale, 'receipt');
    if (sale.receipt?.needed) await printSale(sale, 'ryoushuusho');
  } catch (err) { toast(err.message, 'danger'); }
};

async function printSale(sale, kind, name) {
  if (getPrintSettings().mode === 'escpos') {
    return api('/s/print/receipt', { method: 'POST', body: { saleId: sale.id, kind, name } }).catch((e) => toast(e.message, 'danger'));
  }
  const s = name ? { ...sale, receipt: { needed: true, name } } : sale;
  await printHtml(receiptHtml(s, info.shop, kind), 'receipt');
}

// ---------- daily summary ----------
async function loadDaily() {
  daily = await api('/s/daily?date=' + $('#dailyDate').value);
  const row = (l, v) => `<tr><td>${l}</td><td class="text-end yen">${v}</td></tr>`;
  $('#dailyBody').innerHTML = `<table class="table table-bordered bg-white" style="max-width:520px">
    <thead><tr><th>支払い方法</th><th class="text-end">金額（件数）</th></tr></thead>
    ${row('現金', `${yen(daily.byMethod.cash.total)}（${daily.byMethod.cash.count}）`)}
    ${row('クレジットカード', `${yen(daily.byMethod.card.total)}（${daily.byMethod.card.count}）`)}
    ${row('PayPay', `${yen(daily.byMethod.paypay.total)}（${daily.byMethod.paypay.count}）`)}
    ${row('会計件数', daily.count)}${row('割引前合計', yen(daily.subtotal))}${row('割引合計', yen(daily.discount))}
    ${row('領収書発行', daily.receiptCount)}${row('<b>売上合計</b>', `<b>${yen(daily.total)}</b>`)}</table>`;
}
$('#dailyDate').value = $('#salesDate').value = today();
$('#dailyLoad').onclick = loadDaily;
$('#dailyPrint').onclick = async () => { await loadDaily(); await printHtml(dailyHtml(daily), 'report'); };

// ---------- sales history / reprint ----------
let sales = [];
async function loadSales() {
  sales = (await api('/s/sales?date=' + $('#salesDate').value)).sales;
  $('#salesBody').innerHTML = sales.length ? `<table class="table table-sm bg-white"><thead><tr><th>No.</th><th>時刻</th><th>T</th><th>方法</th><th class="text-end">合計</th><th></th></tr></thead><tbody>
    ${sales.map((s) => `<tr><td>${s.id}</td><td>${hhmm(s.closedAt)}</td><td>${s.table}</td><td>${METHOD[s.method]}</td><td class="text-end yen">${yen(s.total)}</td>
      <td class="text-end"><button class="btn btn-sm btn-outline-dark" data-re="receipt" data-id="${s.id}">レシート</button>
      <button class="btn btn-sm btn-outline-dark" data-re="ryoushuusho" data-id="${s.id}">領収書</button></td></tr>`).join('')}</tbody></table>` : '<div class="text-muted">会計履歴がありません</div>';
}
$('#salesLoad').onclick = loadSales;
$('#salesBody').onclick = async (e) => {
  const b = e.target.closest('[data-re]');
  if (!b) return;
  const s = sales.find((x) => x.id === Number(b.dataset.id));
  let name;
  if (b.dataset.re === 'ryoushuusho') {
    name = prompt('宛名を入力してください', s.receipt?.name || '');
    if (name === null) return;
  }
  await printSale(s, b.dataset.re, name);
};
$$('[data-bs-target="#tabSales"]')[0].addEventListener('shown.bs.tab', loadSales);
$$('[data-bs-target="#tabDaily"]')[0].addEventListener('shown.bs.tab', loadDaily);

// ---------- realtime ----------
await loadState();
connect((m) => {
  if (m.t === 'call') { beep(5, 660); speak(`${m.table}番テーブルがお呼びです`); toast(`${m.table}番テーブルが呼んでいます`, 'danger'); }
  if (m.t === 'sync' || m.t === 'call') loadState();
});
setInterval(loadState, 20000);
