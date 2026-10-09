// Minimal ESC/POS over TCP (port 9100). Epson-compatible kanji mode, Shift_JIS.
import net from 'node:net';
import iconv from 'iconv-lite';

const ESC = 0x1b, GS = 0x1d, FS = 0x1c;
const METHOD = { cash: '現金', paypay: 'PayPay', card: 'クレジットカード' };
const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP');

class Doc {
  constructor() { this.parts = [Buffer.from([ESC, 0x40, FS, 0x26, FS, 0x43, 0x01])]; }
  raw(...b) { this.parts.push(Buffer.from(b)); return this; }
  text(s = '') { this.parts.push(iconv.encode(s + '\n', 'Shift_JIS')); return this; }
  align(n) { return this.raw(ESC, 0x61, n); } // 0 left, 1 center, 2 right
  size(n) { return this.raw(GS, 0x21, n); } // 0x00 normal, 0x11 double w+h
  bold(on) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  cut() { this.parts.push(Buffer.from('\n\n\n')); return this.raw(GS, 0x56, 0x42, 0x00); }
  buffer() { return Buffer.concat(this.parts); }
}

// Display width: full-width chars count as 2 columns.
const width = (s) => [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0xff ? 2 : 1), 0);
const pair = (l, r, cols = 42) => l + ' '.repeat(Math.max(1, cols - width(l) - width(r))) + r;
const time = (ts) => new Date(ts).toLocaleString('ja-JP');

export function send(addr, buf) {
  const [host, port = '9100'] = String(addr).split(':');
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port: Number(port) }, () => sock.end(buf));
    sock.setTimeout(5000, () => { sock.destroy(); reject(new Error('プリンタ接続がタイムアウトしました')); });
    sock.on('error', reject);
    sock.on('close', resolve);
  });
}

// One slip per item line (no prices).
export function ticketBuffer(order) {
  const doc = new Doc();
  for (const l of order.items) {
    doc.align(1).size(0x11).bold(true).text(`${order.table}番テーブル`).size(0).bold(false)
      .text(time(order.createdAt)).align(0).text('-'.repeat(42))
      .size(0x11).bold(true).text(l.name).size(0).bold(false);
    for (const o of l.options) doc.text('  + ' + o.name);
    doc.size(0x11).text(`数量: ${l.qty}`).size(0);
    if (order.note) doc.text('-'.repeat(42)).text('備考: ' + order.note);
    doc.cut();
  }
  return doc.buffer();
}

export function receiptBuffer(sale, shop, kind) {
  const doc = new Doc();
  const isRyo = kind === 'ryoushuusho';
  doc.align(1).size(0x11).bold(true).text(isRyo ? '領収書' : 'レシート').size(0).bold(false).text(shop);
  doc.text(time(sale.closedAt)).text(`No.${sale.id}  テーブル ${sale.table}`).align(0);
  if (isRyo) doc.text(`宛名: ${sale.receipt?.name || ''} 様`);
  doc.text('-'.repeat(42));
  for (const l of sale.lines) {
    doc.text(l.name);
    for (const o of l.options) doc.text('  + ' + pair(o.name, o.price ? '+' + yen(o.price) : '', 38));
    doc.text(pair(`  ${yen(l.unit)} x ${l.qty}`, yen(l.amount)));
  }
  doc.text('-'.repeat(42)).text(pair('小計', yen(sale.subtotal)));
  if (sale.discountAmount) doc.text(pair('割引', '-' + yen(sale.discountAmount)));
  doc.size(0x11).bold(true).text(pair('合計', yen(sale.total), 21)).size(0).bold(false);
  doc.text(pair('お支払い', METHOD[sale.method]));
  if (isRyo) doc.text('').align(1).text('但し 飲食代として').text('上記正に領収いたしました');
  doc.align(1).text('ありがとうございました').cut();
  return doc.buffer();
}
