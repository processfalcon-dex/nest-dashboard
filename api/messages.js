/**
 * /api/messages?user=[email]
 * Looks up ops member's Discord channel ID from Glide, then fetches last 10 messages via Discord API.
 * Used by the Nest dashboard ops widget.
 */

const FERRIS_BOT_TOKEN = process.env.FERRIS_BOT_TOKEN;
const GLIDE_TOKEN = process.env.GLIDE_TOKEN;
const GLIDE_APP = 'Tc2JYiVU5TBvWf9VaZJs';
const GLIDE_USERS_TABLE = 'native-table-mP2H7PaDb3MW0gcfBwdr';

// Glide field mappings
const FIELD_EMAIL = 'iwVVI';
const FIELD_MEMBER_DISCORD_CHANNEL = 'qLxFY';

export default async function handler(req, res) {
  // CORS — Glide WebView and dash.processfalcon.com both need this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { user } = req.query;
  if (!user) return res.status(400).json({ error: 'user (email) parameter required' });

  try {
    // Step 1: Look up user's Discord channel ID from Glide
    const glideResp = await fetch('https://api.glideapp.io/api/function/queryTables', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GLIDE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        appID: GLIDE_APP,
        queries: [{ tableName: GLIDE_USERS_TABLE }],
      }),
    });

    if (!glideResp.ok) {
      return res.status(502).json({ error: 'Failed to query Glide users table' });
    }

    const glideData = await glideResp.json();
    const rows = (glideData[0] || {}).rows || [];

    const userRow = rows.find(
      (r) => (r[FIELD_EMAIL] || '').toLowerCase() === user.toLowerCase()
    );

    if (!userRow) {
      return res.status(404).json({ error: `No user found for email: ${user}` });
    }

    const channelId = userRow[FIELD_MEMBER_DISCORD_CHANNEL];
    if (!channelId) {
      return res.status(404).json({ error: `User found but no Discord channel assigned: ${user}` });
    }

    // Step 2: Fetch last 10 messages from Discord channel via bot API
    const discordResp = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=10`,
      {
        headers: {
          Authorization: `Bot ${FERRIS_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!discordResp.ok) {
      const err = await discordResp.text();
      return res.status(502).json({ error: `Discord API error: ${err}` });
    }

    const messages = await discordResp.json();

    // Return clean payload — no need to expose raw Discord objects to the widget
    const payload = messages.map((m) => ({
      id: m.id,
      content: m.content,
      author: m.author?.username || 'Unknown',
      authorId: m.author?.id,
      timestamp: m.timestamp,
      isBot: m.author?.bot || false,
    }));

    return res.status(200).json({
      channelId,
      messages: payload,
      fetchedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[messages API] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
