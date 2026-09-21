// Simple JSON-file datastore. No native bindings, no external DB service —
// works on any Node host. For higher traffic, swap this for Postgres/MySQL
// later without changing the route logic much (same shape of data).
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const DEFAULT_CATALOG = [
  { id: 'oil', name: 'Cooking oil (2L)', unit: 'bottle', category: 'Groceries' },
  { id: 'unga', name: 'Maize flour (Unga) 2kg', unit: 'bag', category: 'Groceries' },
  { id: 'sugar', name: 'Sugar 1kg', unit: 'packet', category: 'Groceries' },
  { id: 'rice', name: 'Rice (Pishori) 2kg', unit: 'bag', category: 'Groceries' },
  { id: 'tea', name: 'Tea leaves 250g', unit: 'packet', category: 'Groceries' },
  { id: 'salt', name: 'Salt 1kg', unit: 'packet', category: 'Groceries' },
  { id: 'barsoap', name: 'Bar soap', unit: 'piece', category: 'Household' },
  { id: 'bathsoap', name: 'Bathing soap', unit: 'piece', category: 'Household' },
  { id: 'matches', name: 'Matchboxes', unit: 'box', category: 'Household' },
  { id: 'soda', name: 'Soda crate (assorted)', unit: 'crate', category: 'Beverages' },
  { id: 'milk', name: 'Milk 500ml', unit: 'packet', category: 'Beverages' },
  { id: 'bread', name: 'Bread', unit: 'loaf', category: 'Bakery' },
];

const DEFAULT_STOCK = {
  oil: 40, unga: 25, sugar: 60, rice: 18, tea: 30, salt: 22,
  barsoap: 50, bathsoap: 15, matches: 70, soda: 12, milk: 35, bread: 8,
};

function seedTeam() {
  return [
    { id: 1, name: 'Grace Wanjiru', role: 'owner', passwordHash: bcrypt.hashSync('tumaini2024', 10) },
    { id: 2, name: 'Peter Otieno', role: 'worker', passwordHash: bcrypt.hashSync('worker123', 10) },
    { id: 3, name: 'Mary Achieng', role: 'worker', passwordHash: bcrypt.hashSync('worker456', 10) },
  ];
}

function defaultData() {
  return {
    catalog: DEFAULT_CATALOG,
    stock: { ...DEFAULT_STOCK },
    team: seedTeam(),
    nextTeamId: 4,
    orders: [],
    nextOrderId: 1,
    pendingStockChanges: [],
    nextPendingId: 1,
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const data = defaultData();
    save(data);
    console.log('Created new database at', DB_PATH);
    console.log('Seeded staff logins — CHANGE THESE before real use:');
    console.log('  Owner:  Grace Wanjiru / tumaini2024');
    console.log('  Worker: Peter Otieno  / worker123');
    console.log('  Worker: Mary Achieng  / worker456');
    return data;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function save(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = { load, save };
