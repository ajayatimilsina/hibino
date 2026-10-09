import { api, connect } from './api.js';
import { $, esc, yen, hhmm, STATUS, STATUS_CLASS, beep, autoEnableAudio, toast } from './util.js';

autoEnableAudio();
const table = parseInt(new URLSearchParams(location.search).get('table'), 10);
let menu = { categories: [], items: [] };
let cat = null;
let cart = []; // {itemId, name, price, options:[{name,price}], qty}
let state = { notice: null, orders: [], total: 0 };
let lastPickupTs = 0;
let receiptTouched = false;
let modalItem = null, modalQty = 1;
const modal = new bootstrap.Modal($('#itemModal'));

if (!(table > 0)) {
  $('#noTable').hidden = false;
  $('#callBtn').hidden = true;
  $('#submitBtn').disabled = true;
} else {
  $('#tableLabel').textContent = `テーブル ${table}`;
  refresh();
  connect((m) => { if (m.t === 'sync') refresh(); if (m.t === 'announce') showAnnounce(m.text); });
  setInterval(refresh, 15000); // fallback if the socket drops
}

async function refresh() {
  try {
    [menu, state] = await Promise.all([api('/menu'), api(`/tables/${table}`)]);
  } catch { return; }
  $('#shopName').textContent = menu.shop;
  document.title = menu.shop;
  cat ??= menu.categories[0];
  renderTabs(); renderMenu(); renderOrders(); handleNotice();
  if (!receiptTouched) {
    $('#needReceipt').checked = state.receipt.needed;
    $('#receiptName').value = state.receipt.name;
    $('#receiptNameBox').hidden = !state.receipt.needed;
  }
}

function renderTabs() {
  $('#catTabs').innerHTML = menu.categories
    .map((c) => `<li class="nav-item"><a href="#" class="nav-link ${c === cat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</a></li>`).join('');
}
$('#catTabs').onclick = (e) => {
  const a = e.target.closest('[data-cat]');
  if (!a) return;
  e.preventDefault();
  cat = a.dataset.cat;
  renderTabs(); renderMenu();
};

function renderMenu() {
  $('#menuList').innerHTML = menu.items.filter((i) => i.category === cat).map((i) => `
    <div class="col-12">
      <div class="card menu-item ${i.available ? '' : 'soldout'}" data-id="${i.id}">
        <div class="card-body d-flex justify-content-between align-items-center py-2">
          <div>
            <div class="fw-bold">${esc(i.name)} ${i.available ? '' : '<span class="badge badge-soldout">欠品</span>'}</div>
            ${i.options.length ? '<small class="text-muted">オプションあり</small>' : ''}
          </div>
          <div class="text-end"><div class="yen fw-bold">${yen(i.price)}</div>
            ${i.available ? '<span class="btn btn-sm btn-outline-danger">追加</span>' : ''}</div>
        </div>
      </div>
    </div>`).join('');
}

$('#menuList').onclick = (e) => {
  const card = e.target.closest('.menu-item');
  if (!card || card.classList.contains('soldout')) return;
  modalItem = menu.items.find((i) => i.id === Number(card.dataset.id));
  modalQty = 1;
  $('#mName').textContent = `${modalItem.name}  ${yen(modalItem.price)}`;
  $('#mQty').textContent = 1;
  $('#mOptions').innerHTML = modalItem.options.map((o, idx) => `
    <div class="form-check">
      <input class="form-check-input" type="checkbox" id="opt${idx}" value="${idx}">
      <label class="form-check-label" for="opt${idx}">${esc(o.name)} <span class="text-muted">+${yen(o.price)}</span></label>
    </div>`).join('');
  modal.show();
};
$('#mMinus').onclick = () => { modalQty = Math.max(1, modalQty - 1); $('#mQty').textContent = modalQty; };
$('#mPlus').onclick = () => { modalQty = Math.min(20, modalQty + 1); $('#mQty').textContent = modalQty; };
$('#mAdd').onclick = () => {
  const options = [...document.querySelectorAll('#mOptions input:checked')].map((c) => modalItem.options[Number(c.value)]);
  cart.push({ itemId: modalItem.id, name: modalItem.name, price: modalItem.price, options, qty: modalQty });
  modal.hide();
  renderCart();
};

const lineTotal = (l) => (l.price + l.options.reduce((s, o) => s + o.price, 0)) * l.qty;

function renderCart() {
  $('#cartList').innerHTML = cart.length ? cart.map((l, i) => `
    <div class="list-group-item d-flex justify-content-between align-items-center">
      <div>${esc(l.name)} × ${l.qty}
        ${l.options.map((o) => `<div class="small text-muted">+ ${esc(o.name)}</div>`).join('')}</div>
      <div class="text-end"><div class="yen">${yen(lineTotal(l))}</div>
        <button class="btn btn-sm btn-outline-secondary" data-rm="${i}">削除</button></div>
    </div>`).join('') : '<div class="text-muted small">カートは空です</div>';
  const total = cart.reduce((s, l) => s + lineTotal(l), 0);
  $('#cartTotal').textContent = $('#barTotal').textContent = yen(total);
  $('#cartCount').textContent = cart.reduce((s, l) => s + l.qty, 0);
  $('#submitBtn').disabled = !cart.length || !(table > 0);
}
$('#cartList').onclick = (e) => {
  const b = e.target.closest('[data-rm]');
  if (b) { cart.splice(Number(b.dataset.rm), 1); renderCart(); }
};

$('#submitBtn').onclick = async () => {
  const btn = $('#submitBtn');
  btn.disabled = true;
  try {
    await api('/orders', {
      method: 'POST',
      body: {
        table, note: $('#note').value,
        items: cart.map((l) => ({ itemId: l.itemId, qty: l.qty, options: l.options.map((o) => o.name) })),
        receipt: { needed: $('#needReceipt').checked, name: $('#receiptName').value },
      },
    });
    cart = []; $('#note').value = '';
    renderCart();
    toast('ご注文を受け付けました', 'success');
    refresh();
  } catch (err) {
    toast(err.message, 'danger');
    refresh();
  } finally {
    btn.disabled = !cart.length;
  }
};

function renderOrders() {
  $('#orders').innerHTML = state.orders.length ? state.orders.map((o) => `
    <div class="card mb-2"><div class="card-body py-2">
      <small class="text-muted">${hhmm(o.createdAt)} のご注文</small>
      ${o.items.map((l) => `
        <div class="d-flex justify-content-between align-items-center">
          <span>${esc(l.name)} × ${l.qty}${l.options.length ? `<small class="text-muted"> (${l.options.map(esc).join(', ')})</small>` : ''}</span>
          <span class="badge ${STATUS_CLASS[l.status]}">${STATUS[l.status]}</span>
        </div>`).join('')}
    </div></div>`).join('') : '<div class="text-muted small">まだご注文はありません</div>';
  $('#tableTotal').textContent = yen(state.total);
}

// Pickup / thanks notices come from tables/{n}/notice.
function handleNotice() {
  const n = state.notice;
  const pickup = n?.type === 'pickup';
  $('#pickupBanner').hidden = !pickup;
  $('#thanksBanner').hidden = n?.type !== 'thanks';
  if (pickup && n.timestamp !== lastPickupTs) {
    lastPickupTs = n.timestamp; // re-notify (new timestamp) alerts again
    navigator.vibrate?.([400, 150, 400, 150, 400]);
    beep(3, 988);
  }
  if (n?.type === 'thanks') { cart = []; renderCart(); receiptTouched = false; }
}
const clearNotice = () => api(`/tables/${table}/notice/clear`, { method: 'POST' }).then(refresh);
$('#pickupOk').onclick = clearNotice;
$('#thanksOk').onclick = clearNotice;

function showAnnounce(text) {
  const el = $('#announce');
  el.innerHTML = `<div class="alert alert-info shadow text-center fw-bold mb-0">${esc(text)}</div>`;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 8000);
}

let callLock = false;
$('#callBtn').onclick = async () => {
  if (callLock || !confirm('店員を呼びますか？')) return;
  callLock = true;
  $('#callBtn').disabled = true;
  try { await api(`/tables/${table}/call`, { method: 'POST' }); toast('店員を呼びました。少々お待ちください', 'success'); } catch (e) { toast(e.message, 'danger'); }
  setTimeout(() => { callLock = false; $('#callBtn').disabled = false; }, 30000);
};

// Receipt request: saved on the table right away and again with the order.
let rTimer;
function saveReceipt() {
  receiptTouched = true;
  $('#receiptNameBox').hidden = !$('#needReceipt').checked;
  clearTimeout(rTimer);
  rTimer = setTimeout(() => api(`/tables/${table}/receipt`, { method: 'POST', body: { needed: $('#needReceipt').checked, name: $('#receiptName').value } }).catch(() => {}), 500);
}
$('#needReceipt').onchange = saveReceipt;
$('#receiptName').oninput = saveReceipt;

renderCart();
