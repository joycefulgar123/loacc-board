// End-to-end test: runs the real fetch script against a fake GHL API and checks the numbers.
// Usage: npm test
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOC = 'VOUsKOXpQktJ6Xr6DO66';

const ACQ = {
  id: 'acq', name: 'Acquisitions Manager Pipeline',
  stages: ['New Lead', 'Never Answered New Leads', 'Working', 'Appointment Set', 'Appointment Complete', 'Offer Sent',
    'Closed Won', 'Warm Going Cold', 'Nurture', 'Long Term Follow Up', 'Cold Leads', 'Closed Lost']
    .map((name, i) => ({ id: `st${i}`, name })),
};
const sid = (name) => ACQ.stages.find((s) => s.name === name).id;
const TXT = { id: 'txt', name: 'Texting Manager Pipeline', stages: [{ id: 'r0', name: 'Responded Leads' }] };

function opp(id, contactId, stage, createdAt, stageAt, tags = [], extra = {}) {
  return {
    id, name: extra.name || `Deal ${id}`, contactId, pipelineId: 'acq', pipelineStageId: sid(stage),
    status: extra.status || 'open', createdAt, lastStageChangeAt: stageAt, updatedAt: stageAt,
    lastStatusChangeAt: extra.statusAt || createdAt,
    contact: { id: contactId, name: 'Private Name', email: 'private@example.com', phone: '+15555550100', tags },
  };
}

function scenario(round) {
  const acqOpps = [
    opp('oA', 'cA', 'Appointment Set', '2026-09-10T16:00:00Z', '2026-10-02T03:00:00Z', ['rei survey lead', 'acq kpi | sent to frank']),
    opp('oB', 'cB', round === 1 ? 'Closed Won' : 'Closed Lost', '2026-10-05T15:00:00Z',
      round === 1 ? '2026-10-12T15:00:00Z' : '2026-10-13T15:00:00Z', ['seller-drip-list', 'acq kpi | sent to frank']),
    opp('oC', 'cC', 'New Lead', '2026-09-20T15:00:00Z', '2026-09-20T15:00:00Z', []),
    opp('oE', 'cE', 'Working', '2026-09-25T15:00:00Z', '2026-09-26T15:00:00Z', ['rei survey leads']),
    opp('oH', 'cH', 'Appointment Set', '2026-09-27T15:00:00Z', '2026-09-28T15:00:00Z', ['rei survey lead'], { name: 'DISQUALIFIED — Someone' }),
  ];
  const textingOpps = [{ id: 'tC', contactId: 'cC', pipelineId: 'txt' }];
  for (let i = 0; i < 150; i++) textingOpps.push({ id: `tf${i}`, contactId: `filler${i}`, pipelineId: 'txt' });
  const metaContacts = [
    { id: 'cA', dateAdded: '2026-09-10T15:00:00Z', tags: ['rei survey lead'] },
    { id: 'cH', dateAdded: '2026-09-27T15:00:00Z', tags: ['rei survey lead'] },
    ...(round === 1 ? [{ id: 'cD', dateAdded: '2026-10-03T15:00:00Z', tags: ['rei survey lead'] }] : []), // D deleted in round 2
  ];
  const events = [
    { id: 'e1', contactId: 'cA', calendarId: 'calAndrew', appointmentStatus: 'confirmed', dateAdded: '2026-09-29T15:00:00Z', startTime: '2026-10-01T12:00:00-05:00', deleted: false },
    { id: 'e2', contactId: 'cA', calendarId: 'calAndrew', appointmentStatus: 'cancelled', dateAdded: '2026-09-01T15:00:00Z', startTime: '2026-09-03T12:00:00-05:00', deleted: false },
    { id: 'e3', contactId: 'cF', calendarId: 'calAndrew', appointmentStatus: 'confirmed', dateAdded: '2026-09-29T18:00:00Z', startTime: '2026-10-02T12:00:00-05:00', deleted: false },
  ];
  const contacts = { cF: { id: 'cF', dateAdded: '2026-09-14T15:00:00Z', tags: ['il | 9.14.2026 campaign'] } };
  const tags = ['rei survey lead', 'rei survey leads', 'REI-Survey Lead', 'partial - survey not completed', 'seller-drip-list'];
  return { acqOpps, textingOpps, metaContacts, events, contacts, tags };
}

function startMock(data) {
  const log = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const chunk of req) body += chunk;
    log.push({ method: req.method, path: url.pathname, version: req.headers.version, auth: req.headers.authorization });
    const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401); return res.end('bad token'); }

    if (url.pathname === '/opportunities/pipelines') return send({ pipelines: [ACQ, TXT] });
    if (url.pathname === '/opportunities/search') {
      assert.equal(url.searchParams.get('location_id'), LOC);
      const list = url.searchParams.get('pipeline_id') === 'acq' ? data.acqOpps : data.textingOpps;
      const limit = Number(url.searchParams.get('limit'));
      const after = url.searchParams.get('startAfterId');
      const startIdx = after ? list.findIndex((o) => o.id === after) + 1 : 0;
      const page = list.slice(startIdx, startIdx + limit);
      const last = page[page.length - 1];
      return send({ opportunities: page, meta: { total: list.length, startAfterId: last?.id || null, startAfter: last ? 1 : null } });
    }
    if (url.pathname === '/contacts/search' && req.method === 'POST') {
      const b = JSON.parse(body);
      assert.equal(b.locationId, LOC);
      assert.equal(b.filters[0].value, 'rei survey lead');
      return send({ contacts: data.metaContacts.map((c) => ({ ...c, searchAfter: [1, c.id] })), total: data.metaContacts.length });
    }
    if (url.pathname === '/calendars/') {
      return send({ calendars: [{ id: 'calAndrew', name: "Andrew Graf's Personal Calendar" }, { id: 'other', name: 'On-Site Visit' }] });
    }
    if (url.pathname === '/calendars/events') {
      const s = Number(url.searchParams.get('startTime')), e = Number(url.searchParams.get('endTime'));
      const events = data.events.filter((ev) => { const t = Date.parse(ev.startTime); return t >= s && t < e; });
      return send({ events });
    }
    if (url.pathname.startsWith('/contacts/')) {
      const c = data.contacts[url.pathname.split('/')[2]];
      if (!c) { res.writeHead(404); return res.end('{}'); }
      return send({ contact: c });
    }
    if (url.pathname === `/locations/${LOC}/tags`) return send({ tags: data.tags.map((name) => ({ name })) });
    res.writeHead(404); res.end('not mocked');
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, log, port: server.address().port })));
}

async function runFetch(port, workdir) {
  // Run against a temp copy so the repo's real board.json isn't touched.
  await run('node', [path.join(workdir, 'scripts/fetch-ghl.mjs')], {
    env: { ...process.env, GHL_TOKEN: 'test-token', GHL_API_BASE: `http://127.0.0.1:${port}`, GHL_PAUSE_MS: '0' },
  });
  return JSON.parse(await fs.readFile(path.join(workdir, 'public/data/board.json'), 'utf8'));
}

const count = (board, step, from, to, source = 'all') =>
  board.records.filter((r) => (source === 'all' || r.s === source) && r.d[step] && r.d[step] >= from && r.d[step] <= to).length;

const work = await fs.mkdtemp(path.join(os.tmpdir(), 'loacc-test-'));
await fs.cp(path.join(ROOT, 'scripts'), path.join(work, 'scripts'), { recursive: true });
await fs.copyFile(path.join(ROOT, 'config.json'), path.join(work, 'config.json'));
await fs.mkdir(path.join(work, 'public/data'), { recursive: true });

// ---- Round 1 ----
let mock = await startMock(scenario(1));
const b1 = await runFetch(mock.port, work);
mock.server.close();

const byStr = JSON.stringify(b1);
for (const secret of ['Private Name', 'private@example.com', '5555550100', 'cA', 'test-token']) {
  assert.ok(!byStr.includes(`"${secret}"`) && !byStr.includes(secret === 'cA' ? '"cA"' : secret), `board.json leaked ${secret}`);
}
assert.ok(mock.log.every((l) => l.path.startsWith('/calendars') ? l.version === '2021-04-15' : l.version === '2021-07-28'), 'API version headers');
assert.equal(mock.log.filter((l) => l.path === '/opportunities/search').length, 3, 'paginates the 151-deal texting pipeline (2 pages) + acquisitions (1 page)');

assert.equal(b1.records.length, 7, 'seven lead records');
const src = Object.fromEntries(['meta', 'texting', 'other'].map((s) => [s, b1.records.filter((r) => r.s === s).length]));
assert.deepEqual(src, { meta: 3, texting: 3, other: 1 }, 'sources: Meta tag wins; texting by campaign tag, pipeline, or booked contact tags');

const sept = ['2026-09-01', '2026-09-30'], oct = ['2026-10-01', '2026-10-31'];
assert.deepEqual(
  ['lead', 'opp', 'appt', 'close'].map((s) => count(b1, s, ...sept)), [5, 4, 3, 0], 'September combined',
);
assert.deepEqual(
  ['lead', 'opp', 'appt', 'close'].map((s) => count(b1, s, ...oct)), [2, 1, 1, 1], 'October combined',
);
assert.deepEqual(['lead', 'opp', 'appt'].map((s) => count(b1, s, ...sept, 'meta')), [2, 2, 2], 'September Meta');
assert.deepEqual(['lead', 'appt', 'close'].map((s) => count(b1, s, ...oct, 'texting')), [1, 1, 1], 'October texting');
assert.equal(b1.records.every((r) => !('contract' in r.d)), true, 'contracts untracked');

// Timezone: a stage change at 03:00 UTC Oct 2 is Oct 1 in Chicago (A's calendar booking Sept 29 is earlier, so appt = Sept 29).
assert.deepEqual(b1.quality.metaTagVariants, ['REI-Survey Lead', 'rei survey leads'], 'flags tag look-alikes');
assert.equal(b1.quality.disqualifiedStillOpen, 1);
assert.equal(b1.quality.cancelledBookingsExcluded, 1);
assert.equal(b1.quality.otherSourceLeads, 1);
assert.equal(b1.quality.apptOnlyOnCalendar, 1, 'F booked but never in Appointment Set');
assert.equal(b1.quality.apptOnlyInStage, 2, 'H (Appointment Set) and B (Closed Won) have no booking');

// ---- Round 2: deal B slides back to Closed Lost, contact D deleted ----
mock = await startMock(scenario(2));
const b2 = await runFetch(mock.port, work);
mock.server.close();
assert.equal(b2.records.length, 7, 'deleted contact kept in history');
assert.equal(count(b2, 'close', ...oct), 1, 'a close is never un-counted when a deal moves backward');
assert.equal(b2.historyTrackedSince, b1.historyTrackedSince, 'history start preserved');

// Timezone check on a direct record: A with only a 03:00Z stage change.
const { localDate } = await import(path.join(ROOT, 'scripts/build.mjs'));
assert.equal(localDate('2026-10-02T03:00:00Z', 'America/Chicago'), '2026-10-01');

await fs.copyFile(path.join(work, 'public/data/board.json'), path.join(os.tmpdir(), 'loacc-sample-board.json'));
console.log('All tests passed.');
console.log('Sample board written to', path.join(os.tmpdir(), 'loacc-sample-board.json'));
