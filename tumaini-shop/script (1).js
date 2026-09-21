/* ---------------- API helper ---------------- */
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.session) headers['Authorization'] = 'Bearer ' + state.session.token;
  const res = await fetch(path, { ...opts, headers });
  let body = null;
  try { body = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error((body && body.error) || 'Something went wrong.');
  return body;
}

/* ---------------- State ---------------- */
const state = {
  view: 'kiosk',
  catalog: [],
  kioskName: '',
  cart: {},
  customItems: [],
  submittedOrder: null,

  loginTeamList: [],
  loginSelectedId: null,
  loginError: '',
  session: null, // {token, user:{id,name,role}}

  orders: [],
  pending: [],
  team: [],
  dashTab: 'orders',

  banner: null,
  bannerType: 'info',
  loading: false,
  pollHandle: null,
  lastSeenNotificationId: null,
};

function fmtStatus(s) {
  return { received: 'Order received', preparing: 'Preparing', outfordelivery: 'Out for delivery', delivered: 'Delivered' }[s];
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function setBanner(msg, type = 'info') { state.banner = msg; state.bannerType = type; }

async function run(fn) {
  try { await fn(); }
  catch (e) { setBanner(e.message, 'error'); }
  render();
}

/* ---------------- Startup ---------------- */
async function init() {
  const saved = localStorage.getItem('tumaini_session');
  if (saved) {
    try {
      state.session = JSON.parse(saved);
      await apiFetch('/api/auth/me'); // validate token
      startPolling();
    } catch { state.session = null; localStorage.removeItem('tumaini_session'); }
  }
  await run(loadCatalog);
}

async function loadCatalog() { state.catalog = await apiFetch('/api/catalog'); }

async function loadOrders() { state.orders = await apiFetch('/api/orders'); }

function startPolling() {
  stopPolling();
  state.pollHandle = setInterval(async () => {
    if (!state.session) return;
    try {
      const { last } = await apiFetch('/api/notifications');
      if (last && last.id !== state.lastSeenNotificationId) {
        state.lastSeenNotificationId = last.id;
        setBanner(`All staff notified: ${last.kioskName}'s order (#${last.orderId}) has been delivered.`);
        if (state.dashTab === 'orders') { await loadOrders(); }
        render();
      }
    } catch { /* a missed poll isn't worth interrupting the user over */ }
  }, 5000);
}
function stopPolling() {
  if (state.pollHandle) clearInterval(state.pollHandle);
  state.pollHandle = null;
}

/* ---------------- Render root ---------------- */
function render() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">
        <h1>Tumaini Shop</h1>
        <span class="tagline">Supplying kiosks, one order at a time</span>
      </div>
      <div class="view-toggle">
        <button class="${state.view === 'kiosk' ? 'active' : ''}" onclick="setView('kiosk')">Kiosk order</button>
        <button class="${state.view === 'staff' ? 'active' : ''}" onclick="setView('staff')">Staff dashboard</button>
      </div>
    </div>
    ${state.banner ? `<div class="banner ${state.bannerType === 'error' ? 'banner-error' : ''}"><span>${esc(state.banner)}</span><span class="btn-text" style="color:inherit" onclick="dismissBanner()">Dismiss</span></div>` : ''}
    <div id="view-root">${state.view === 'kiosk' ? renderKiosk() : (state.session ? renderDashboardShell() : renderLogin())}</div>
  `;
  if (state.view === 'staff' && state.session) hydrateDashboard();
}

function setView(v) {
  state.view = v;
  if (v === 'staff' && !state.session && state.loginTeamList.length === 0) {
    run(async () => { state.loginTeamList = await apiFetch('/api/team/public'); });
    return;
  }
  render();
}
function dismissBanner() { state.banner = null; render(); }

/* ---------------- Kiosk order view ---------------- */
function renderKiosk() {
  if (state.submittedOrder) {
    const o = state.submittedOrder;
    return `
      <div class="cart-panel confirm-box" style="max-width:460px;margin:40px auto;">
        <div class="display">Order #${o.id} sent to Tumaini Shop</div>
        <p class="muted">${esc(o.kioskName)} — we'll start preparing it shortly. A staff member will update the status as it moves.</p>
        <button class="btn btn-primary" style="margin-top:16px" onclick="newOrder()">Place another order</button>
      </div>`;
  }
  if (state.catalog.length === 0) return `<div class="loading-note">Loading catalog…</div>`;

  const categories = [...new Set(state.catalog.map(c => c.category))];
  const catalogHtml = categories.map(cat => `
    <div class="category">
      <h2>${esc(cat)}</h2>
      ${state.catalog.filter(i => i.category === cat).map(i => {
        const qty = state.cart[i.id] || 0;
        return `
        <div class="item-row">
          <div><span class="item-name">${esc(i.name)}</span><span class="item-unit">per ${esc(i.unit)}</span></div>
          <div class="stepper">
            <button onclick="changeQty('${i.id}',-1)" ${qty === 0 ? 'disabled' : ''}>−</button>
            <span class="qty">${qty}</span>
            <button onclick="changeQty('${i.id}',1)">+</button>
          </div>
        </div>`;
      }).join('')}
    </div>
  `).join('');

  const cartEntries = Object.entries(state.cart).filter(([, q]) => q > 0);
  const hasItems = cartEntries.length > 0 || state.customItems.length > 0;
  const cartHtml = (!hasItems) ? `<p class="cart-empty">No items added yet. Use the + buttons to build the order.</p>` : `
    ${cartEntries.map(([id, q]) => {
      const item = state.catalog.find(c => c.id === id);
      return `<div class="cart-line"><span><span class="qty-tag">${q}×</span>${esc(item.name)}</span><button class="remove" onclick="changeQty('${id}',-${q})">×</button></div>`;
    }).join('')}
    ${state.customItems.map((c, idx) => `
      <div class="cart-line"><span><span class="qty-tag">${c.qty}×</span>${esc(c.name)} <span class="muted" style="font-size:12px">(custom)</span></span><button class="remove" onclick="removeCustom(${idx})">×</button></div>
    `).join('')}
  `;

  return `
  <div class="kiosk-name-row">
    <div>
      <span class="field-label">Kiosk name</span>
      <input type="text" placeholder="e.g. Baraka Kiosk" value="${esc(state.kioskName)}" oninput="state.kioskName=this.value" />
    </div>
  </div>
  <div class="order-layout">
    <div>${catalogHtml}</div>
    <div class="cart-panel">
      <h2>Your order</h2>
      ${cartHtml}
      <hr class="divider">
      <span class="field-label">Need something not listed?</span>
      <div class="custom-add">
        <input type="text" id="customName" placeholder="Item name">
        <input type="number" id="customQty" placeholder="Qty" min="1" value="1">
        <button onclick="addCustom()">Add</button>
      </div>
      <div class="cart-total-line"><span>Items in order</span><span>${cartEntries.reduce((a, [, q]) => a + q, 0) + state.customItems.reduce((a, c) => a + c.qty, 0)}</span></div>
      <button class="btn btn-primary" style="width:100%;margin-top:14px" ${(!state.kioskName.trim() || !hasItems || state.loading) ? 'disabled' : ''} onclick="submitOrder()">${state.loading ? 'Sending…' : 'Submit order'}</button>
    </div>
  </div>
  `;
}

function changeQty(id, delta) {
  const cur = state.cart[id] || 0;
  state.cart[id] = Math.max(0, cur + delta);
  render();
}
function addCustom() {
  const name = document.getElementById('customName').value.trim();
  const qty = parseInt(document.getElementById('customQty').value) || 1;
  if (!name) return;
  state.customItems.push({ name, qty });
  render();
}
function removeCustom(idx) { state.customItems.splice(idx, 1); render(); }

function submitOrder() {
  run(async () => {
    state.loading = true; render();
    const items = Object.entries(state.cart).filter(([, q]) => q > 0).map(([id, q]) => ({ name: state.catalog.find(c => c.id === id).name, qty: q }));
    const custom = state.customItems.map(c => ({ name: c.name + ' (custom)', qty: c.qty }));
    const order = await apiFetch('/api/orders', { method: 'POST', body: JSON.stringify({ kioskName: state.kioskName.trim(), items: [...items, ...custom] }) });
    state.submittedOrder = order;
    state.cart = {}; state.customItems = [];
    state.loading = false;
  });
}
function newOrder() { state.submittedOrder = null; state.kioskName = ''; render(); }

/* ---------------- Staff login ---------------- */
function renderLogin() {
  if (state.loginTeamList.length === 0) return `<div class="loading-note">Loading staff list…</div>`;
  if (!state.loginSelectedId) {
    return `
    <div class="login-wrap">
      <h2>Staff sign-in</h2>
      <p class="muted">Select your profile, then enter your password.</p>
      <div class="login-options">
        ${state.loginTeamList.map(t => `
          <button onclick="selectLogin(${t.id})">${esc(t.name)}<span class="role">${t.role === 'owner' ? 'Owner — full access' : 'Worker'}</span></button>
        `).join('')}
      </div>
    </div>`;
  }
  const person = state.loginTeamList.find(t => t.id === state.loginSelectedId);
  return `
  <div class="login-wrap">
    <h2>Sign in as ${esc(person.name)}</h2>
    <p class="muted">${person.role === 'owner' ? 'Owner — full access' : 'Worker'}</p>
    <div style="text-align:left;max-width:260px;margin:0 auto;">
      <span class="field-label">Password</span>
      <input type="password" id="loginPassword" style="width:100%" autofocus onkeydown="if(event.key==='Enter')attemptLogin()">
      ${state.loginError ? `<p style="color:var(--rust);font-size:12.5px;margin-top:8px;">${esc(state.loginError)}</p>` : ''}
      <button class="btn btn-primary" style="width:100%;margin-top:16px" onclick="attemptLogin()">Sign in</button>
      <button class="btn-text" style="display:block;margin:14px auto 0;color:var(--ink-muted)" onclick="backToProfiles()">Choose a different profile</button>
    </div>
  </div>`;
}
function selectLogin(id) { state.loginSelectedId = id; state.loginError = ''; render(); }
function backToProfiles() { state.loginSelectedId = null; state.loginError = ''; render(); }

function attemptLogin() {
  run(async () => {
    const password = document.getElementById('loginPassword').value;
    try {
      const result = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ staffId: state.loginSelectedId, password }) });
      state.session = result;
      localStorage.setItem('tumaini_session', JSON.stringify(result));
      state.loginSelectedId = null;
      state.loginError = '';
      state.dashTab = 'orders';
      startPolling();
    } catch (e) {
      state.loginError = e.message;
    }
  });
}
function logout() {
  stopPolling();
  state.session = null;
  localStorage.removeItem('tumaini_session');
  state.loginTeamList = [];
  render();
  run(async () => { state.loginTeamList = await apiFetch('/api/team/public'); });
}

/* ---------------- Dashboard ---------------- */
function renderDashboardShell() {
  const isOwner = state.session.user.role === 'owner';
  const tabs = [['orders', 'Orders'], ['stock', 'Stock'], ...(isOwner ? [['team', 'Team']] : [])];
  return `
  <div class="dash-layout">
    <div>
      <div class="dash-user"><strong>${esc(state.session.user.name)}</strong><br>${isOwner ? 'Owner' : 'Worker'} · <a onclick="logout()">Switch profile</a></div>
      <div class="dash-nav">
        ${tabs.map(([k, label]) => `<button class="${state.dashTab === k ? 'active' : ''}" onclick="setDashTab('${k}')">${label}</button>`).join('')}
      </div>
    </div>
    <div id="dash-content"><div class="loading-note">Loading…</div></div>
  </div>`;
}
function setDashTab(t) { state.dashTab = t; render(); }

async function hydrateDashboard() {
  const isOwner = state.session.user.role === 'owner';
  try {
    if (state.dashTab === 'orders') state.orders = await apiFetch('/api/orders');
    if (state.dashTab === 'stock') { state.catalog = await apiFetch('/api/catalog'); state.pending = await apiFetch('/api/stock/pending'); }
    if (state.dashTab === 'team' && isOwner) state.team = await apiFetch('/api/team');
  } catch (e) { setBanner(e.message, 'error'); }
  const el = document.getElementById('dash-content');
  if (!el) return;
  if (state.dashTab === 'orders') el.innerHTML = renderOrdersTab();
  if (state.dashTab === 'stock') el.innerHTML = renderStockTab(isOwner);
  if (state.dashTab === 'team' && isOwner) el.innerHTML = renderTeamTab();
  if (state.banner) render();
}

function renderOrdersTab() {
  if (state.orders.length === 0) return `<div class="empty-state">No orders yet. New kiosk orders will appear here as they come in.</div>`;
  return `
  <table>
    <thead><tr><th>#</th><th>Kiosk</th><th>Items</th><th>Status</th><th></th></tr></thead>
    <tbody>
      ${state.orders.map(o => `
        <tr>
          <td class="order-num">${o.id}</td>
          <td>${esc(o.kioskName)}</td>
          <td class="items-summary">${o.items.map(i => `${i.qty}× ${esc(i.name)}`).join(', ')}</td>
          <td><span class="badge badge-${o.status.replace(/[^a-z]/g, '')}">${fmtStatus(o.status)}</span></td>
          <td>
            <select onchange="updateStatus(${o.id}, this.value)">
              ${['received', 'preparing', 'outfordelivery', 'delivered'].map(s => `<option value="${s}" ${o.status === s ? 'selected' : ''}>${fmtStatus(s)}</option>`).join('')}
            </select>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}
function updateStatus(id, status) {
  run(async () => {
    await apiFetch(`/api/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
    state.orders = await apiFetch('/api/orders');
  });
}

function renderStockTab(isOwner) {
  const stockRows = state.catalog.map(i => `
    <tr>
      <td>${esc(i.name)}</td>
      <td class="stock-qty">${i.stock} ${esc(i.unit)}s</td>
      <td>
        ${isOwner ? `
          <div class="stock-controls">
            <input type="number" id="adj-${i.id}" placeholder="±qty">
            <button class="btn btn-ghost" style="padding:5px 10px;font-size:12px" onclick="ownerAdjust('${i.id}')">Apply</button>
          </div>
        ` : `<span class="muted" style="font-size:12.5px">Owner-adjustable</span>`}
      </td>
    </tr>
  `).join('');

  const pendingHtml = state.pending.length === 0 ? `<div class="empty-state">No pending stock changes.</div>` : state.pending.map(p => {
    const item = state.catalog.find(c => c.id === p.itemId);
    return `
    <div class="pending-card">
      <div class="desc"><strong>${p.delta > 0 ? '+' : ''}${p.delta} ${esc(item.unit)}s</strong> of ${esc(item.name)} — proposed by ${esc(p.requestedBy)}</div>
      ${isOwner ? `<div class="actions">
        <button class="btn-primary" style="border:none" onclick="approvePending(${p.id})">Approve</button>
        <button class="btn-ghost" onclick="rejectPending(${p.id})">Reject</button>
      </div>` : `<span class="muted" style="font-size:12.5px">Awaiting owner approval</span>`}
    </div>`;
  }).join('');

  return `
    <h2 style="font-size:18px;margin-bottom:12px;">Current stock</h2>
    <table><thead><tr><th>Item</th><th>On hand</th><th></th></tr></thead><tbody>${stockRows}</tbody></table>

    ${!isOwner ? `
      <h2 style="font-size:18px;margin:26px 0 4px;">Propose a stock change</h2>
      <div class="propose-form">
        <div><span class="field-label">Item</span>
          <select id="proposeItem">${state.catalog.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select>
        </div>
        <div><span class="field-label">Change (+/-)</span><input type="number" id="proposeDelta" placeholder="e.g. 20 or -5"></div>
        <button class="btn btn-primary" onclick="proposeChange()">Submit for approval</button>
      </div>
    ` : ''}

    <h2 style="font-size:18px;margin:26px 0 12px;">Pending approvals</h2>
    ${pendingHtml}
  `;
}
function ownerAdjust(itemId) {
  const val = parseInt(document.getElementById('adj-' + itemId).value);
  if (!val) return;
  run(async () => {
    await apiFetch('/api/stock/adjust', { method: 'POST', body: JSON.stringify({ itemId, delta: val }) });
    state.catalog = await apiFetch('/api/catalog');
  });
}
function proposeChange() {
  const itemId = document.getElementById('proposeItem').value;
  const delta = parseInt(document.getElementById('proposeDelta').value);
  if (!delta) return;
  run(async () => {
    await apiFetch('/api/stock/propose', { method: 'POST', body: JSON.stringify({ itemId, delta }) });
    state.pending = await apiFetch('/api/stock/pending');
    setBanner('Stock change sent for owner approval.');
  });
}
function approvePending(id) {
  run(async () => {
    await apiFetch(`/api/stock/pending/${id}/approve`, { method: 'POST' });
    state.pending = await apiFetch('/api/stock/pending');
    state.catalog = await apiFetch('/api/catalog');
  });
}
function rejectPending(id) {
  run(async () => {
    await apiFetch(`/api/stock/pending/${id}/reject`, { method: 'POST' });
    state.pending = await apiFetch('/api/stock/pending');
  });
}

function renderTeamTab() {
  return `
  <h2 style="font-size:18px;margin-bottom:12px;">Team (${state.team.length}/10)</h2>
  ${state.team.map(t => `
    <div class="team-row">
      <div class="who"><strong>${esc(t.name)}</strong><span>${t.role === 'owner' ? 'Owner' : 'Worker'}</span></div>
      ${t.role !== 'owner' ? `<div style="display:flex;gap:14px;"><button class="btn-text" style="color:var(--forest-deep)" onclick="resetPassword(${t.id})">Reset password</button><button class="btn-text" onclick="removeWorker(${t.id})">Remove</button></div>` : ''}
    </div>
  `).join('')}
  ${state.team.length < 10 ? `
    <div class="add-worker">
      <input type="text" id="newWorkerName" placeholder="Worker name">
      <input type="text" id="newWorkerPassword" placeholder="Temporary password">
      <button class="btn btn-primary" onclick="addWorker()">Add worker</button>
    </div>
  ` : `<p class="muted" style="margin-top:14px;font-size:13px;">Team limit reached (10 workers).</p>`}
  `;
}
function addWorker() {
  const name = document.getElementById('newWorkerName').value.trim();
  const password = document.getElementById('newWorkerPassword').value.trim();
  if (!name || !password) { setBanner('Enter a name and a temporary password.', 'error'); render(); return; }
  run(async () => {
    await apiFetch('/api/team', { method: 'POST', body: JSON.stringify({ name, password }) });
    state.team = await apiFetch('/api/team');
    setBanner(`${name} added. Temporary password: ${password}`);
  });
}
function resetPassword(id) {
  run(async () => {
    const result = await apiFetch(`/api/team/${id}/reset-password`, { method: 'POST', body: JSON.stringify({}) });
    setBanner(`New password: ${result.newPassword}`);
  });
}
function removeWorker(id) {
  run(async () => {
    await apiFetch(`/api/team/${id}`, { method: 'DELETE' });
    state.team = await apiFetch('/api/team');
  });
}

init();
