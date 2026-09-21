# Tumaini Shop

A B2B ordering system: kiosks place orders without logging in, and Tumaini
Shop staff manage orders, stock, and their team from a password-protected
dashboard.

This is a real, self-contained app — Node/Express backend, a JSON-file
database (no external database service required), and a plain HTML/CSS/JS
frontend served by the same server. It's ready to run locally or deploy to
a host of your choice.

## What's included

- `server.js` — the API (auth, orders, stock, team)
- `db.js` — persistent JSON-file datastore (`data/db.json`, created on first run)
- `public/` — the frontend (served automatically by the server)
- Live delivery alerts to every signed-in staff member via Server-Sent Events

## Run it locally

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
JWT_SECRET=some-long-random-string npm start
```

Then open **http://localhost:3000**.

On first run it creates `data/db.json` and seeds three staff logins (printed
in the terminal too):

| Name | Role | Password |
|---|---|---|
| Grace Wanjiru | Owner | `tumaini2024` |
| Peter Otieno | Worker | `worker123` |
| Mary Achieng | Worker | `worker456` |

**Change these** — sign in as the owner, open the Team tab, and reset each
password (or remove the demo workers and add your real staff) before anyone
outside your household uses it.

## Deploying it

Any host that runs a Node.js app will work. Two easy free/cheap options:

### Render or Railway
1. Push this folder to a GitHub repo.
2. Create a new Web Service (Render) or Project (Railway) from that repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add an environment variable `JWT_SECRET` set to a long random string —
   both platforms have a place for this in their dashboard.
5. Deploy. Your app gets a public HTTPS URL automatically.

### A VPS (e.g. a $5/month DigitalOcean or Hetzner box)
1. Install Node.js 18+ on the server.
2. Copy this folder over (`git clone` or `scp`).
3. `npm install --omit=dev`
4. Run it with a process manager so it survives reboots/crashes:
   ```bash
   npm install -g pm2
   JWT_SECRET=your-secret pm2 start server.js --name tumaini-shop
   pm2 save
   ```
5. Put it behind Nginx or Caddy for HTTPS (Caddy will get you a free
   certificate automatically with a one-line config pointing at
   `localhost:3000`).

## Important before real use

- **Set `JWT_SECRET`** to a long random value wherever you deploy — don't
  leave the built-in default in place.
- **Change the seeded passwords** (see table above).
- **Back up `data/db.json`** periodically — it's the entire database. If
  your host wipes the filesystem on redeploy (some free tiers do), you'll
  need either a persistent disk/volume, or to migrate this to a proper
  database (Postgres/MySQL) — the route logic in `server.js` is small
  enough to adapt when you're ready to scale past one shop's worth of
  traffic.
- Orders, stock, and team data all live in that one file — for a single
  kiosk supplier this is genuinely fine; if Tumaini Shop grows into
  multiple branches or high order volume, that's the point to move to a
  real database.

## How the pieces fit together

- Kiosks visit the site and order — no account needed (`POST /api/orders`).
- Staff sign in with a name + password (`POST /api/auth/login`), which
  returns a token the frontend stores and sends with every request.
- The owner role can adjust stock directly, approve/reject stock changes
  workers propose, and add/remove/reset staff.
- When any staff member marks an order "Delivered," every other signed-in
  staff member sees a live notification banner immediately (via
  `/api/events`), without refreshing the page.
