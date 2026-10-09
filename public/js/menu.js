import { api, requireStaff } from './api.js';
import { $, esc, yen, navBar, toast } from './util.js';

await requireStaff();
navBar('menu');

let items = [];
let editingId = null;
const modal = new bootstrap.Modal($('#editModal'));

async function load() {
  const d = await api('/s/menu');
  items = d.items;
  $('#cats').innerHTML = d.categories.map((c) => `<option value="${esc(c)}">`).join('');
  $('#rows').innerHTML = items.map((m) => `
    <tr class="${m.soldOut || m.stock <= 0 ? 'table-secondary' : ''}">
      <td>${m.id}</td><td>${esc(m.name)}</td><td>${esc(m.category)}</td><td class="text-end yen">${yen(m.price)}</td>
      <td class="small">${m.options.map((o) => `${esc(o.name)} +${yen(o.price)}`).join('<br>')}</td>
      <td><div class="form-check form-switch"><input class="form-check-input" type="checkbox" data-sold="${m.id}" ${m.soldOut ? 'checked' : ''}></div></td>
      <td class="text-end text-nowrap">
        <button class="btn btn-sm btn-outline-primary" data-edit="${m.id}">編集</button>
        <button class="btn btn-sm btn-outline-danger" data-del="${m.id}">削除</button></td>
    </tr>`).join('');
}

function optRow(o = { name: '', price: 0 }) {
  const div = document.createElement('div');
  div.className = 'input-group input-group-sm mb-1';
  div.innerHTML = `<input class="form-control o-name" placeholder="名前" maxlength="60" value="${esc(o.name)}">
    <input class="form-control o-price" type="number" style="max-width:110px" placeholder="¥" value="${o.price}">
    <button type="button" class="btn btn-outline-danger">×</button>`;
  div.querySelector('button').onclick = () => div.remove();
  $('#opts').appendChild(div);
}
$('#addOpt').onclick = () => optRow();

function openForm(m) {
  editingId = m?.id ?? null;
  $('#formTitle').textContent = m ? `編集: ${m.name}` : '新規追加';
  $('#fId').value = m?.id ?? Math.max(79, ...items.map((i) => i.id)) + 1;
  $('#fId').readOnly = !!m;
  $('#fName').value = m?.name ?? '';
  $('#fCat').value = m?.category ?? '';
  $('#fPrice').value = m?.price ?? 0;
  $('#fStock').value = m?.stock ?? 30;
  $('#fSold').checked = !!m?.soldOut;
  $('#opts').innerHTML = '';
  (m?.options ?? []).forEach(optRow);
  modal.show();
}
$('#addBtn').onclick = () => openForm(null);

$('#form').onsubmit = async (e) => {
  e.preventDefault();
  const body = {
    id: $('#fId').value, name: $('#fName').value, category: $('#fCat').value, price: $('#fPrice').value,
    stock: $('#fStock').value, soldOut: $('#fSold').checked,
    options: [...document.querySelectorAll('#opts > div')].map((d) => ({ name: d.querySelector('.o-name').value, price: d.querySelector('.o-price').value })),
  };
  try {
    await api(editingId === null ? '/s/menu' : `/s/menu/${editingId}`, { method: editingId === null ? 'POST' : 'PUT', body });
    modal.hide();
    toast('保存しました', 'success');
    load();
  } catch (err) { toast(err.message, 'danger'); }
};

$('#rows').onclick = async (e) => {
  const ed = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  if (ed) openForm(items.find((m) => m.id === Number(ed.dataset.edit)));
  if (del) {
    const m = items.find((x) => x.id === Number(del.dataset.del));
    if (confirm(`「${m.name}」を削除しますか？`)) { await api(`/s/menu/${m.id}`, { method: 'DELETE' }); load(); }
  }
};
$('#rows').onchange = async (e) => {
  const t = e.target.closest('[data-sold]');
  if (t) { await api(`/s/menu/${t.dataset.sold}/soldout`, { method: 'PATCH', body: { soldOut: t.checked } }); load(); }
};

load();
