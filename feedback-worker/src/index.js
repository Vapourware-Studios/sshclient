// Relays in-app feedback to Discord. Stateless by design: nothing is stored
// here, the client never talks to Discord directly (the webhook URL is a
// Worker secret), and the only "storage" is the built-in rate limiters.

const CATEGORY_LABELS = {
  bug: '🐛 Bug report',
  idea: '💡 Idea',
  other: '💬 Feedback',
};
const CATEGORY_COLORS = {
  bug: 0xed4245,
  idea: 0x5865f2,
  other: 0x99aaab,
};

const MAX_MESSAGE_LEN = 4000;
const MAX_FIELD_LEN = 200;
const MAX_BODY_BYTES = 20_000;

// Whitelisted diagnostic keys only — anything else in the payload is
// dropped rather than forwarded blindly into the Discord message.
const DIAGNOSTIC_KEYS = [
  'appVersion',
  'platform',
  'osVersion',
  'arch',
  'electronVersion',
  'chromeVersion',
  'nodeVersion',
  'locale',
  'packaged',
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function clean(value, maxLen) {
  return String(value ?? '').trim().slice(0, maxLen);
}

function isValidEmail(value) {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('ok');
    }

    if (request.method !== 'POST' || url.pathname !== '/feedback') {
      return jsonResponse({ error: 'not found' }, 404);
    }

    const contentLength = Number(request.headers.get('content-length') || '0');
    if (contentLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'payload too large' }, 413);
    }

    // Reject before touching Discord: cheapest checks first.
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const ipLimit = await env.FEEDBACK_LIMITER_IP.limit({ key: ip });
    if (!ipLimit.success) {
      return jsonResponse({ error: 'Too many requests — slow down.' }, 429);
    }
    const globalLimit = await env.FEEDBACK_LIMITER_GLOBAL.limit({ key: 'global' });
    if (!globalLimit.success) {
      return jsonResponse({ error: 'Feedback is temporarily rate-limited, try again shortly.' }, 429);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid JSON' }, 400);
    }

    const message = clean(body.message, MAX_MESSAGE_LEN);
    if (!message) {
      return jsonResponse({ error: 'message is required' }, 400);
    }

    const category = Object.hasOwn(CATEGORY_LABELS, body.category) ? body.category : 'other';

    let contactEmail = '';
    if (body.contactEmail) {
      contactEmail = clean(body.contactEmail, 320);
      if (contactEmail && !isValidEmail(contactEmail)) {
        return jsonResponse({ error: 'invalid contact email' }, 400);
      }
    }

    const fields = [];
    if (body.includeDiagnostics && body.diagnostics && typeof body.diagnostics === 'object') {
      for (const key of DIAGNOSTIC_KEYS) {
        const value = body.diagnostics[key];
        if (value === undefined || value === null || value === '') continue;
        fields.push({ name: key, value: clean(value, MAX_FIELD_LEN), inline: true });
      }
    }
    if (contactEmail) {
      fields.push({ name: 'Contact', value: contactEmail, inline: true });
    }
    // Country only, never the raw IP — enough to spot region-specific bugs
    // (proxy configs, locale issues) without being invasive.
    if (request.cf?.country) {
      fields.push({ name: 'Region', value: request.cf.country, inline: true });
    }

    const embed = {
      title: CATEGORY_LABELS[category],
      description: message,
      color: CATEGORY_COLORS[category],
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: 'sshclient feedback' },
    };

    const discordRes = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'SSH Client Feedback',
        embeds: [embed],
        // Feedback text is user-controlled — never let it ping @everyone,
        // @here, or a role.
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!discordRes.ok) {
      return jsonResponse({ error: 'failed to deliver feedback' }, 502);
    }

    return jsonResponse({ ok: true });
  },
};
