import { openDb } from './client.js';

const path = process.env['DATABASE_URL'] ?? '/data/mosbot.db';
const { sqlite } = openDb(path);
sqlite.close();
console.warn(`bootstrap migrations applied to ${path}`);
