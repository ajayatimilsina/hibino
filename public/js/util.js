export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const yen = (n) => '¥' + Number(n || 0).toLocaleString('ja-JP');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const hhmm = (ts) => new Date(ts).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const STATUS = { new: '受付', cooking: '調理中', ready: '完成（カウンターへ）', served: '提供済み' };
export const STATUS_CLASS = { new: 'bg-secondary', cooking: 'bg-warning text-dark', ready: 'bg-success', served: 'bg-primary' };
export const METHOD = { cash: '現金', paypay: 'PayPay', card: 'クレジットカード' };

// ---- audio (browsers require a user gesture first) ----
let ctx;
export function enableAudio() {
  ctx ??= new (window.AudioContext || window.webkitAudioContext)();
  ctx.resume();
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch { /* speech not supported */ }
  document.dispatchEvent(new Event('audio-enabled'));
}
export const audioReady = () => !!ctx && ctx.state === 'running';
export function autoEnableAudio() {
  for (const ev of ['click', 'keydown', 'touchstart']) document.addEventListener(ev, enableAudio, { once: true });
}
export function beep(times = 3, freq = 880) {
  if (!ctx) return;
  for (let i = 0; i < times; i++) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime + i * 0.3;
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.start(t); o.stop(t + 0.25);
  }
}
export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  speechSynthesis.speak(u);
}

export function toast(msg, type = 'dark') {
  const el = document.createElement('div');
  el.className = `alert alert-${type} shadow position-fixed bottom-0 end-0 m-3`;
  el.style.zIndex = 4000;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export function navBar(active) {
  const links = [['kds', 'kds.html', 'キッチン'], ['pos', 'pos.html', 'レジ'], ['menu', 'menu.html', 'メニュー管理'], ['inventory', 'inventory.html', '棚卸'], ['finance', 'finance.html', '収支']];
  $('#nav').innerHTML = `<nav class="nav nav-staff p-2 gap-1">${links
    .map(([k, h, t]) => `<a class="nav-link ${k === active ? 'active' : ''}" href="${h}">${t}</a>`).join('')}</nav>`;
}
