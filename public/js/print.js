import { esc, hhmm, yen, METHOD } from './util.js';

// Print settings are per-device (stored in the browser).
export const getPrintSettings = () => ({
  mode: localStorage.getItem('printMode') || 'browser', // 'browser' | 'escpos'
  paper: localStorage.getItem('paper') || '80', // '80' | '58'
});
export const setPrintSetting = (k, v) => localStorage.setItem(k, v);

// Renders html into #printArea and calls window.print() (silent with Chrome --kiosk-printing).
export function printHtml(html, kind = 'ticket') {
  const { paper } = getPrintSettings();
  const area = document.getElementById('printArea');
  area.style.setProperty('--paper-w', paper === '58' ? '48mm' : '72mm');
  let style = document.getElementById('pageStyle');
  if (!style) { style = document.createElement('style'); style.id = 'pageStyle'; document.head.appendChild(style); }
  style.textContent = kind === 'report' ? '@page{size:A4;margin:15mm}' : `@page{size:${paper}mm auto;margin:0}`;
  area.innerHTML = html;
  return new Promise((resolve) => {
    window.addEventListener('afterprint', () => { area.innerHTML = ''; resolve(); }, { once: true });
    window.print();
  });
}

// One slip per item line, no prices.
export function ticketHtml(order, line) {
  return `<div class="ticket">
    <div class="t-head">${order.table}番テーブル</div>
    <div class="t-time">${hhmm(order.createdAt)} / #${order.id}</div>
    <div class="t-name">${esc(line.name)}</div>
    ${line.options.map((o) => `<div class="t-opt">+ ${esc(o.name)}</div>`).join('')}
    <div class="t-qty">数量: ${line.qty}</div>
    ${order.note ? `<div class="t-note">備考: ${esc(order.note)}</div>` : ''}
  </div>`;
}

// kind: 'receipt' (レシート) | 'ryoushuusho' (領収書 with addressee)
export function receiptHtml(sale, shop, kind = 'receipt') {
  const isRyo = kind === 'ryoushuusho';
  const d = new Date(sale.closedAt).toLocaleString('ja-JP');
  return `<div class="receipt">
    <div class="r-title">${isRyo ? '領収書' : 'レシート'}</div>
    <div class="r-center">${esc(shop)}</div>
    <div class="r-center">${d}</div>
    <div class="r-center">No.${sale.id} / テーブル ${sale.table}</div>
    ${isRyo ? `<div class="r-addressee">${esc(sale.receipt?.name || '')} 様</div>` : ''}
    <hr>
    ${sale.lines.map((l) => `
      <div>${esc(l.name)}</div>
      ${l.options.map((o) => `<div class="r-row r-opt"><span>+ ${esc(o.name)}</span><span>${o.price ? '+' + yen(o.price) : ''}</span></div>`).join('')}
      <div class="r-row"><span>&nbsp;&nbsp;${yen(l.unit)} × ${l.qty}</span><span>${yen(l.amount)}</span></div>`).join('')}
    <hr>
    <div class="r-row"><span>小計</span><span>${yen(sale.subtotal)}</span></div>
    ${sale.discountAmount ? `<div class="r-row"><span>割引${sale.discountType === 'percent' ? ` (${sale.discountValue}%)` : ''}</span><span>-${yen(sale.discountAmount)}</span></div>` : ''}
    <div class="r-row r-total"><span>合計</span><span>${yen(sale.total)}</span></div>
    <div class="r-row"><span>お支払い</span><span>${METHOD[sale.method]}</span></div>
    <div class="r-row"><span>（内消費税等）</span><span>${yen(Math.floor((sale.total * 10) / 110))}</span></div>
    ${isRyo ? '<hr><div class="r-center">但し 飲食代として</div><div class="r-center">上記正に領収いたしました</div>' : ''}
    <hr><div class="r-center">ありがとうございました</div>
  </div>`;
}

export function dailyHtml(r) {
  const row = (label, c, t) => `<tr><td>${label}</td><td class="num">${c}</td><td class="num">${yen(t)}</td></tr>`;
  return `<div class="report">
    <h2>${esc(r.shop)} 日次集計 ${r.date}</h2>
    <table>
      <tr><th>支払い方法</th><th>件数</th><th>金額</th></tr>
      ${row('現金', r.byMethod.cash.count, r.byMethod.cash.total)}
      ${row('クレジットカード', r.byMethod.card.count, r.byMethod.card.total)}
      ${row('PayPay', r.byMethod.paypay.count, r.byMethod.paypay.total)}
      ${row('合計', r.count, r.total)}
    </table><br>
    <table>
      <tr><td>会計件数</td><td class="num">${r.count}</td></tr>
      <tr><td>割引前合計</td><td class="num">${yen(r.subtotal)}</td></tr>
      <tr><td>割引合計</td><td class="num">${yen(r.discount)}</td></tr>
      <tr><td>領収書発行</td><td class="num">${r.receiptCount}</td></tr>
      <tr><td><b>売上合計</b></td><td class="num"><b>${yen(r.total)}</b></td></tr>
    </table>
    <p>出力日時: ${new Date().toLocaleString('ja-JP')}</p>
  </div>`;
}
