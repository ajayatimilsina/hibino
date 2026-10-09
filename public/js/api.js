// Shared fetch + WebSocket + staff PIN gate.
const KEY = 'staffToken';
export const getToken = () => sessionStorage.getItem(KEY) || '';

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers['x-token'] = t;
  const r = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path.startsWith('/s/')) {
    sessionStorage.removeItem(KEY);
    location.reload();
    throw new Error('unauthorized');
  }
  if (!r.ok) throw new Error(data.error || 'エラーが発生しました');
  return data;
}

// Auto-reconnecting WebSocket; token marks the socket as staff.
export function connect(onMsg) {
  const open = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${encodeURIComponent(getToken())}`);
    ws.onmessage = (e) => onMsg(JSON.parse(e.data));
    ws.onclose = () => setTimeout(open, 2000);
  };
  open();
}

// Blocks the page with a PIN prompt until a valid token exists.
export async function requireStaff() {
  if (getToken()) { await api('/s/ping'); return; }
  await new Promise((resolve) => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:3000;background:#3b1f0e;display:flex;align-items:center;justify-content:center';
    box.innerHTML = `
      <form class="card p-4" style="width:320px">
        <h5 class="mb-3">スタッフPIN</h5>
        <input type="password" inputmode="numeric" autocomplete="off" class="form-control form-control-lg mb-2" placeholder="PIN" autofocus>
        <div class="text-danger small mb-2" id="pinErr"></div>
        <button class="btn btn-primary w-100">ログイン</button>
      </form>`;
    document.body.appendChild(box);
    box.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('/login', { method: 'POST', body: { pin: box.querySelector('input').value } });
        sessionStorage.setItem(KEY, r.token);
        box.remove();
        resolve();
      } catch (err) {
        box.querySelector('#pinErr').textContent = err.message;
      }
    };
  });
}
