const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set. Using an insecure default — set it before deploying for real.');
}

let data = db.load();
function persist() { db.save(data); }

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------------- auth helpers ---------------- */
function signToken(user) {
  return jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
}
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'Sign in required.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired — sign in again.' });
  }
}
function ownerRequired(req, res, next) {
  if (req.user.role !== 'owner') return res.status(403).json({ error: "Only the owner can do that." });
  next();
}

/* ---------------- SSE (live delivery alerts) ---------------- */
let sseClients = [];
function broadcast(event, payload) {
  const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  sseClients.forEach(res => res.write(line));
}
app.get('/api/events', authRequired, (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');
  sseClients.push(res);
  req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
});

/* ---------------- auth routes ---------------- */
app.post('/api/auth/login', (req, res) => {
  const { staffId, password } = req.body;
  const person = data.team.find(t => t.id === staffId);
  if (!person || !bcrypt.compareSync(password || '', person.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect password. Try again.' });
  }
  const token = signToken(person);
  res.json({ token, user: { id: person.id, name: person.name, role: person.role } });
});

app.get('/api/auth/me', authRequired, (req, res) => res.json({ user: req.user }));

/* ---------------- team routes ---------------- */
app.get('/api/team', authRequired, (req, res) => {
  res.json(data.team.map(t => ({ id: t.id, name: t.name, role: t.role })));
});
// Public list of names only, so the login screen can show who to sign in as
// without exposing anything else.
app.get('/api/team/public', (req, res) => {
  res.json(data.team.map(t => ({ id: t.id, name: t.name, role: t.role })));
});

app.post('/api/team', authRequired, ownerRequired, (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Name and password are required.' });
  if (data.team.length >= 10) return res.status(400).json({ error: 'Team limit reached (10 workers).' });
  const worker = { id: data.nextTeamId++, name: name.trim(), role: 'worker', passwordHash: bcrypt.hashSync(password, 10) };
  data.team.push(worker);
  persist();
  res.json({ id: worker.id, name: worker.name, role: worker.role });
});

app.post('/api/team/:id/reset-password', authRequired, ownerRequired, (req, res) => {
  const person = data.team.find(t => t.id === Number(req.params.id));
  if (!person) return res.status(404).json({ error: 'Not found.' });
  const fresh = req.body.password || Math.random().toString(36).slice(-8);
  person.passwordHash = bcrypt.hashSync(fresh, 10);
  persist();
  res.json({ newPassword: fresh });
});

app.delete('/api/team/:id', authRequired, ownerRequired, (req, res) => {
  const id = Number(req.params.id);
  const person = data.team.find(t => t.id === id);
  if (person && person.role === 'owner') return res.status(400).json({ error: "Can't remove the owner." });
  data.team = data.team.filter(t => t.id !== id);
  persist();
  res.json({ ok: true });
});

/* ---------------- catalog + stock routes ---------------- */
app.get('/api/catalog', (req, res) => {
  res.json(data.catalog.map(item => ({ ...item, stock: data.stock[item.id] ?? 0 })));
});

app.get('/api/stock/pending', authRequired, (req, res) => res.json(data.pendingStockChanges));

app.post('/api/stock/adjust', authRequired, ownerRequired, (req, res) => {
  const { itemId, delta } = req.body;
  if (!data.stock.hasOwnProperty(itemId) || !Number.isFinite(delta)) return res.status(400).json({ error: 'Invalid item or amount.' });
  data.stock[itemId] = Math.max(0, data.stock[itemId] + delta);
  persist();
  res.json({ itemId, stock: data.stock[itemId] });
});

app.post('/api/stock/propose', authRequired, (req, res) => {
  const { itemId, delta } = req.body;
  if (!data.stock.hasOwnProperty(itemId) || !Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: 'Invalid item or amount.' });
  const change = { id: data.nextPendingId++, itemId, delta, requestedBy: req.user.name };
  data.pendingStockChanges.push(change);
  persist();
  res.json(change);
});

app.post('/api/stock/pending/:id/approve', authRequired, ownerRequired, (req, res) => {
  const change = data.pendingStockChanges.find(p => p.id === Number(req.params.id));
  if (!change) return res.status(404).json({ error: 'Not found.' });
  data.stock[change.itemId] = Math.max(0, data.stock[change.itemId] + change.delta);
  data.pendingStockChanges = data.pendingStockChanges.filter(p => p.id !== change.id);
  persist();
  res.json({ itemId: change.itemId, stock: data.stock[change.itemId] });
});

app.post('/api/stock/pending/:id/reject', authRequired, ownerRequired, (req, res) => {
  data.pendingStockChanges = data.pendingStockChanges.filter(p => p.id !== Number(req.params.id));
  persist();
  res.json({ ok: true });
});

/* ---------------- order routes ---------------- */
app.get('/api/orders', authRequired, (req, res) => {
  res.json([...data.orders].sort((a, b) => b.id - a.id));
});

// Public — kiosks order without logging in.
app.post('/api/orders', (req, res) => {
  const { kioskName, items } = req.body;
  if (!kioskName || !kioskName.trim()) return res.status(400).json({ error: 'Kiosk name is required.' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Add at least one item.' });
  const cleanItems = items
    .filter(i => i && i.name && Number(i.qty) > 0)
    .map(i => ({ name: String(i.name).slice(0, 120), qty: Math.min(Number(i.qty), 9999) }));
  if (cleanItems.length === 0) return res.status(400).json({ error: 'Add at least one item.' });
  const order = {
    id: data.nextOrderId++,
    kioskName: kioskName.trim().slice(0, 120),
    items: cleanItems,
    status: 'received',
    createdAt: new Date().toISOString(),
  };
  data.orders.push(order);
  persist();
  res.json(order);
});

const VALID_STATUSES = ['received', 'preparing', 'outfordelivery', 'delivered'];
app.patch('/api/orders/:id/status', authRequired, (req, res) => {
  const order = data.orders.find(o => o.id === Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Not found.' });
  if (!VALID_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' });
  order.status = req.body.status;
  persist();
  if (order.status === 'delivered') {
    broadcast('order-delivered', { orderId: order.id, kioskName: order.kioskName });
  }
  res.json(order);
});

app.listen(PORT, () => {
  console.log(`Tumaini Shop server running on http://localhost:${PORT}`);
});
