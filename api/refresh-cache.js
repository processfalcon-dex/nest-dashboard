/**
 * /api/refresh-cache
 * Called by Vercel cron nightly at midnight UTC to refresh the Glide data cache.
 * Secured with CRON_SECRET env var.
 */

import { writeFileSync } from 'fs';

const GLIDE_TOKEN = process.env.GLIDE_TOKEN;
const GLIDE_APP   = 'Tc2JYiVU5TBvWf9VaZJs';
const GLIDE_URL   = 'https://api.glideapp.io/api/function/queryTables';
const CACHE_PATH  = '/tmp/glide-cache.json';

const TABLES = {
  projects:        'native-table-slnGZlKQWqYv6en1oee1',
  scheduledWork:   'native-table-9DBHakVNiyCJ24SCuO9c',
  users:           'native-table-mP2H7PaDb3MW0gcfBwdr',
  inspectionFails: 'native-table-49597bd6-4d8b-4d0d-835f-fda4d4f6f5c6',
  payroll:         'native-table-nbZPLVUebuFf4Be6jKRc',
  contractors:     'native-table-O6GgiSELTGKhf46nikQF',
  tasks:           'native-table-efd62ae1-fc15-4a15-b451-9539501c3951',
  revisionLog:     'native-table-515b3351-47ce-48a6-aef6-2b967354a633',
};

async function fetchTable(tableId) {
  let rows = [];
  let cursor = undefined;
  while (true) {
    const body = { appID: GLIDE_APP, queries: [{ tableName: tableId, ...(cursor ? { startAt: cursor } : {}) }] };
    const resp = await fetch(GLIDE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GLIDE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Glide ${tableId}: ${resp.status}`);
    const data = await resp.json();
    const result = data[0] || {};
    rows = rows.concat(result.rows || []);
    cursor = result.next;
    if (!cursor) break;
  }
  return rows;
}

export default async function handler(req, res) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('[refresh-cache] Starting nightly Glide data refresh...');
    const entries = await Promise.all(
      Object.entries(TABLES).map(async ([key, tableId]) => {
        const rows = await fetchTable(tableId);
        console.log(`[refresh-cache] ${key}: ${rows.length} rows`);
        return [key, rows];
      })
    );
    const allData = Object.fromEntries(entries);
    const payload = { fetchedAt: new Date().toISOString(), data: allData };
    writeFileSync(CACHE_PATH, JSON.stringify(payload));
    const totalRows = Object.values(allData).reduce((s, r) => s + r.length, 0);
    console.log(`[refresh-cache] Done. ${totalRows} total rows cached.`);
    return res.status(200).json({ ok: true, fetchedAt: payload.fetchedAt, totalRows });
  } catch (err) {
    console.error('[refresh-cache] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
