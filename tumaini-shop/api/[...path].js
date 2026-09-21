const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../lib/db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

const app = express();
app.use(cors());
app.use(express.json());

function signToken(user) {
  return jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
}
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
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

app.get('/api/notifications', authRequired, async (req, res) => {
  const data = await db.load();
  res.json({ last: data.lastNotification || null });
});

app.post('/api/auth/login', async (req, res) => {
  const data = await db.load();
  const { staffId, password } = req.body;
  const person = data.team.find(t => t.id === staffId);
  if (!person || !bcrypt.compareSync(password || '', person.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect password. Try again.' });
  }
  const token = signToken(person);
  res.json({ token, user: { id: person.id, name: person.name, role: person.role } });
});

app.get('/api/auth/me', authRequired, (req, res) => res.json({ user: req.user }));

app.get('/api/team', authRequired, async (req, res) => {
  const data = await db.load();
  res.json(data.team.map(t => ({ id: t.id, name: t.name, role: t.role })));
});
app.get('/api/team/public', async (req, res) => {
  const data = await db.load();
  res.json(data.team.map(t => ({ id: t.id, name: t.name, role: t.role })));
});

app.post('/api/team', authRequired, ownerRequired, async (req, res) => {
  const data = await db.load();
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ error: 'Name and password are required.' });
  if (data.team.length >= 10) return res.status(400).json({ error: 'Team limit reached (10 workers).' });
  const worker = { id: data.nextTeamId++, name: name.trim(), role: 'worker', passwordHash: bcrypt.hashSync(password, 10) };
  data.team.push(worker);
  await db.save(data);
  res.json({ id: worker.id, name: worker.name, role: worker.role });
});

app.post('/api/team/:id/reset-password', authRequired, ownerRequired, async (req, res) => {
  const data = await db.load();
  const person = data.team.find(t => t.id === Number(req.params.id));
  if (!person) return res.status(404).json({ error: 'Not found.' });
  const fresh = req.body.password || Math.random().toString(36).slice(-8);
  person.passwordHash = bcrypt.hashSync(fresh, 10);
  await db.save(data);
  res.json({ newPassword: fresh });
});

app.delete('/api/team/:id', authRequired, ownerRequired, async (req, res) => {
  const data = await db.load();
  const id = Number(req.params.id);
  const person = data.team.find(t => t.id === id);
  if (person && person.role === 'owner') return res.status(400).json({ error: "Can't remove the owner." });
  data.team = data.team.filter(t =>
