// Pulls data from GoHighLevel (API v2) and writes public/data/board.json.
// Runs inside GitHub Actions. Needs the GHL_TOKEN environment variable
// (a Private Integration token, stored as a GitHub Actions secret).
// Logs counts only — never names, phones, emails or the token.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data', 'board.json');
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'config.json'), 'utf8'));

const TOKEN = process.env.GHL_TOKEN;
const LOCATION = process.env.GHL_LOCATION_ID || config.locationId;
const BASE = (process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com').replace(/\/$/, '');
const PAUSE_MS = Number(process.env.GHL_PAUSE_MS ?? 150); // stays well under GHL's burst limit

if (!TOKEN) {
  console.error('GHL_TOKEN is not set. Add it under GitHub > Settings > Secrets and variables > Actions.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ghl(pathname, { method = 'GET', query, body, version = '2021-07-28' } = {}) {
  const url = new URL(BASE + pathname);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  for (let attempt = 1; ; attempt++) {
    await sleep(PAUSE_MS);
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Version: version,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
      console.warn(`GHL ${res.status} on ${pathname}, retrying in ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    const text = (await res.text()).slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      throw new Error(`GHL refused ${pathname} (${res.status}). The token is wrong, expired, or missing a scope listed in SETUP.md. ${text}`);
    }
    throw new Error(`GHL ${method} ${pathname} failed (${res.status}): ${text}`);
  }
}

async function getPipelines() {
  const data = await ghl('/opportunities/pipelines', { query: { locationId: LOCATION } });
  return data.pipelines || [];
}

async function getPipelineOpps(pipelineId) {
  const all = [];
  let cursor = {};
  for (let page = 0; page < 500; page++) {
    const data = await ghl('/opportunities/search', {
      query: { location_id: LOCATION, pipeline_id: pipelineId, limit: 100, ...cursor },
    });
    const batch = data.opportunities || [];
    all.push(...batch);
    const meta = data.meta || {};
    if (batch.length < 100 || !meta.startAfterId) break;
    cursor = { startAfter: meta.startAfter, startAfterId: meta.startAfterId };
  }
  return all;
}

async function getContactsWithTag(tag) {
  const all = [];
  let searchAfter;
  for (let page = 0; page < 500; page++) {
    const data = await ghl('/contacts/search', {
      method: 'POST',
      body: {
        locationId: LOCATION,
        pageLimit: 100,
        filters: [{ field: 'tags', operator: 'contains', value: tag }],
        sort: [{ field: 'dateAdded', direction: 'asc' }],
        ...(searchAfter ? { searchAfter } : {}),
      },
    });
    const batch = data.contacts || [];
    all.push(...batch);
    if (batch.length < 100) break;
    searchAfter = batch[batch.length - 1].searchAfter;
    if (!searchAfter) break;
  }
  return all;
}

async function getCalendarEvents(calendarNames) {
  const { calendars = [] } = await ghl('/calendars/', { query: { locationId: LOCATION }, version: '2021-04-15' });
  const events = new Map();
  for (const name of calendarNames) {
    const cal = calendars.find((c) => c.name === name);
    if (!cal) throw new Error(`Calendar "${name}" not found in GHL. Check config.json.`);
    const DAY = 86400000;
    const end = Date.now() + 90 * DAY; // include bookings for future dates
    for (let start = Date.parse(`${config.dataStart}T00:00:00Z`) - 7 * DAY; start < end; start += 30 * DAY) {
      const data = await ghl('/calendars/events', {
        version: '2021-04-15',
        query: { locationId: LOCATION, calendarId: cal.id, startTime: start, endTime: Math.min(start + 30 * DAY, end) },
      });
      for (const e of data.events || []) events.set(e.id, e);
    }
  }
  return [...events.values()];
}

async function getLocationTags() {
  const data = await ghl(`/locations/${LOCATION}/tags`);
  return (data.tags || []).map((t) => t.name);
}

async function main() {
  console.log('Fetching pipelines…');
  const pipelines = await getPipelines();
  const acq = pipelines.find((p) => p.name === config.acquisitionsPipeline);
  const texting = pipelines.find((p) => p.name === config.textingPipeline);
  if (!acq) throw new Error(`Pipeline "${config.acquisitionsPipeline}" not found. Check config.json.`);
  if (!texting) throw new Error(`Pipeline "${config.textingPipeline}" not found. Check config.json.`);

  console.log('Fetching Acquisitions deals…');
  const acqOpps = await getPipelineOpps(acq.id);
  console.log(`  ${acqOpps.length} deals`);

  console.log('Fetching Texting Manager deals…');
  const textingOpps = await getPipelineOpps(texting.id);
  const textingContactIds = new Set(textingOpps.map((o) => o.contactId).filter(Boolean));
  console.log(`  ${textingOpps.length} deals`);

  console.log('Fetching Meta-tagged contacts…');
  const metaContacts = await getContactsWithTag(config.meta.tag);
  console.log(`  ${metaContacts.length} contacts`);

  console.log('Fetching calendar bookings…');
  const calendarEvents = await getCalendarEvents(config.appointment.calendars);
  console.log(`  ${calendarEvents.length} bookings`);

  // Contacts booked on the calendar that we haven't seen elsewhere: look them up for tags.
  const seen = new Set([...acqOpps.map((o) => o.contactId), ...metaContacts.map((c) => c.id)]);
  const extraContacts = new Map();
  for (const id of new Set(calendarEvents.map((e) => e.contactId).filter((id) => id && !seen.has(id)))) {
    try {
      const { contact } = await ghl(`/contacts/${id}`);
      if (contact) extraContacts.set(id, contact);
    } catch (err) {
      console.warn(`  Could not look up a booked contact: ${err.message.slice(0, 120)}`);
    }
  }

  console.log('Fetching tag list…');
  const locationTags = await getLocationTags();

  let previous = null;
  try { previous = JSON.parse(await fs.readFile(OUT, 'utf8')); } catch { /* first run */ }

  const board = buildBoard(
    { pipelines, acqOpps, textingContactIds, metaContacts, calendarEvents, extraContacts, locationTags },
    config, previous,
  );
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, `${JSON.stringify(board, null, 1)}\n`);

  const bySource = board.records.reduce((m, r) => ({ ...m, [r.s]: (m[r.s] || 0) + 1 }), {});
  console.log(`Wrote ${board.records.length} lead records`, bySource);
  if (board.quality.metaTagVariants.length) {
    console.log(`Tags that look like "${config.meta.tag}" but don't match:`, board.quality.metaTagVariants);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
