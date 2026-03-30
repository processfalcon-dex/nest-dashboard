/**
 * /api/glide-data
 * Server-side Glide data cache. Fetches all dashboard tables from Glide
 * and returns cached results. Cache is written to /tmp and refreshed by
 * the nightly cron (/api/refresh-cache). On cache miss, fetches live.
 *
 * This eliminates all browser-side queryTables calls — Glide Query API
 * usage drops from ~10 calls per page load to 10 calls per day.
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';

const GLIDE_TOKEN = process.env.GLIDE_TOKEN;
const GLIDE_APP   = 'Tc2JYiVU5TBvWf9VaZJs';
const GLIDE_URL   = 'https://api.glideapp.io/api/function/queryTables';
const CACHE_PATH  = '/tmp/glide-cache.json';

// All tables the dashboard needs
const TABLES = {
  projects:         'native-table-slnGZlKQWqYv6en1oee1',
  scheduledWork:    'native-table-9DBHakVNiyCJ24SCuO9c',
  users:            'native-table-mP2H7PaDb3MW0gcfBwdr',
  inspectionFails:  'native-table-49597bd6-4d8b-4d0d-835f-fda4d4f6f5c6',
  payroll:          'native-table-nbZPLVUebuFf4Be6jKRc',
  contractors:      'native-table-O6GgiSELTGKhf46nikQF',
  tasks:            'native-table-efd62ae1-fc15-4a15-b451-9539501c3951',
  revisionLog:      'native-table-515b3351-47ce-48a6-aef6-2b967354a633',
  funding:          'native-table-xTZOuwFnGRVnAduY5A8O',
};

async function fetchTable(tableId) {
  let rows = [];
  let cursor = undefined;

  while (true) {
    const body = {
      appID: GLIDE_APP,
      queries: [{
        tableName: tableId,
        ...(cursor ? { startAt: cursor } : {}),
      }],
    };

    const resp = await fetch(GLIDE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GLIDE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) throw new Error(`Glide fetch failed for ${tableId}: ${resp.status}`);

    const data = await resp.json();
    const result = data[0] || {};
    rows = rows.concat(result.rows || []);
    cursor = result.next;
    if (!cursor) break;
  }

  return rows;
}

async function fetchAllTables() {
  const entries = await Promise.all(
    Object.entries(TABLES).map(async ([key, tableId]) => {
      const rows = await fetchTable(tableId);
      return [key, rows];
    })
  );
  return Object.fromEntries(entries);
}

function readCache() {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    const raw = readFileSync(CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeCache(data) {
  const payload = { fetchedAt: new Date().toISOString(), data };
  writeFileSync(CACHE_PATH, JSON.stringify(payload));
  return payload;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const forceRefresh = req.query.refresh === '1';

  try {
    // Try cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = readCache();
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Cache-Age', Math.floor((Date.now() - new Date(cached.fetchedAt)) / 1000) + 's');
        return res.status(200).json(cached);
      }
    }

    // Cache miss — fetch live from Glide
    res.setHeader('X-Cache', 'MISS');
    const allData = await fetchAllTables();
    const payload = writeCache(allData);
    return res.status(200).json(payload);

  } catch (err) {
    console.error('[glide-data] Error:', err.message);

    // Return stale cache on error rather than failing
    const stale = readCache();
    if (stale) {
      res.setHeader('X-Cache', 'STALE');
      return res.status(200).json(stale);
    }

    return res.status(502).json({ error: 'Failed to fetch Glide data', detail: err.message });
  }
}
