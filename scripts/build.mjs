// Turns raw GHL data into one small, anonymous record per contact:
//   { id, s: "meta" | "texting" | "other", d: { lead, opp, appt, contract, close } }
// Each date is the local calendar day (config.timezone) the contact first hit that step.
// No names, phones, emails or GHL IDs leave this file — only a one-way hash.

import { createHash } from 'node:crypto';

export const STEPS = ['lead', 'opp', 'appt', 'contract', 'close'];

export function localDate(iso, timezone) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export function hashId(locationId, contactId) {
  return createHash('sha256').update(`${locationId}:${contactId}`).digest('hex').slice(0, 16);
}

const earliest = (a, b) => (!a ? b : !b ? a : a < b ? a : b);

function normalizeTag(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

// Tags that look like the Meta tag but are not an exact match.
export function findTagVariants(allTags, exactTag) {
  const target = normalizeTag(exactTag);
  const words = exactTag.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return allTags
    .filter((t) => t !== exactTag)
    .filter((t) => {
      const n = normalizeTag(t);
      if (n === target) return true; // same letters, different spacing/case/punctuation
      if (levenshtein(n, target) <= 3) return true; // likely typo
      return words.every((w) => t.toLowerCase().includes(w)); // contains all the words
    })
    .sort();
}

function contactTags(opp) {
  return opp?.contact?.tags || opp?.relations?.find((r) => r.objectKey === 'contact')?.tags || [];
}

export function classifySource(tags, inTextingPipeline, config) {
  // The Meta tag wins: the texting team also works Meta leads, so texting
  // activity on a Meta lead must not turn it into a texting lead.
  if (tags.includes(config.meta.tag)) return 'meta';
  const tagHit = tags.some((t) => config.texting.tags.includes(t))
    || tags.some((t) => config.texting.tagContains.some((p) => t.toLowerCase().includes(p.toLowerCase())));
  if (inTextingPipeline || tagHit) return 'texting';
  return 'other';
}

/**
 * @param raw {
 *   pipelines, acqOpps, textingContactIds:Set, metaContacts, calendarEvents,
 *   extraContacts: Map(contactId -> contact), locationTags: string[]
 * }
 * @param previous  last board.json (or null) — keeps history GHL no longer shows
 * @param now       Date
 */
export function buildBoard(raw, config, previous, now = new Date()) {
  const tz = config.timezone;
  const acq = raw.pipelines.find((p) => p.name === config.acquisitionsPipeline);
  if (!acq) throw new Error(`Pipeline "${config.acquisitionsPipeline}" not found in GHL. Check config.json.`);

  const stageName = new Map(acq.stages.map((s) => [s.id, s.name]));
  const known = new Set(acq.stages.map((s) => s.name));
  const lists = {
    opp: config.opportunityStages,
    appt: config.appointment.stages,
    close: config.close.stages,
    contract: config.contracts.enabled ? config.contracts.stages : [],
  };
  for (const [k, names] of Object.entries(lists)) {
    for (const n of names) {
      if (!known.has(n)) throw new Error(`Stage "${n}" (${k}) is not in "${acq.name}". Check config.json.`);
    }
  }
  const today = localDate(now.toISOString(), tz);

  const byContact = new Map();
  const rec = (cid) => {
    if (!byContact.has(cid)) byContact.set(cid, { cid, tags: new Set(), d: {}, apptStage: false, apptCal: false });
    return byContact.get(cid);
  };
  const setDate = (r, step, iso) => { r.d[step] = earliest(r.d[step], localDate(iso, tz)); };

  // 1. Meta contacts (tag search). Lead date = when the contact was created.
  for (const c of raw.metaContacts) {
    if (!(c.tags || []).includes(config.meta.tag)) continue; // exact match only
    const r = rec(c.id);
    (c.tags || []).forEach((t) => r.tags.add(t));
    setDate(r, 'lead', c.dateAdded);
  }

  // 2. Acquisitions pipeline deals.
  const quality = { disqualifiedOpen: 0, cancelledBookings: 0 };
  for (const o of raw.acqOpps) {
    if (!o.contactId) continue;
    const r = rec(o.contactId);
    contactTags(o).forEach((t) => r.tags.add(t));
    setDate(r, 'lead', o.createdAt); // "sent to Acquisitions"

    const stage = stageName.get(o.pipelineStageId);
    const stageDate = o.lastStageChangeAt || o.updatedAt || o.createdAt;
    if (lists.opp.includes(stage)) setDate(r, 'opp', stageDate);
    if (lists.appt.includes(stage)) { setDate(r, 'appt', stageDate); r.apptStage = true; }
    if (lists.contract.includes(stage)) setDate(r, 'contract', stageDate);
    if (lists.close.includes(stage)) setDate(r, 'close', stageDate);
    if (config.close.countWonStatus && o.status === 'won') {
      setDate(r, 'close', o.lastStatusChangeAt || stageDate);
    }
    if (o.status === 'open' && /disqualified/i.test(o.name || '') && stage !== 'Closed Lost') {
      quality.disqualifiedOpen += 1;
    }
  }

  // 3. Calendar bookings (counted on the day they were booked).
  for (const e of raw.calendarEvents) {
    if (!e.contactId || e.deleted) continue;
    const status = (e.appointmentStatus || e.appoinmentStatus || '').toLowerCase();
    if (config.appointment.ignoreStatuses.includes(status)) { quality.cancelledBookings += 1; continue; }
    const r = rec(e.contactId);
    setDate(r, 'appt', e.dateAdded || e.startTime);
    r.apptCal = true;
  }
  for (const [cid, c] of raw.extraContacts || new Map()) {
    const r = byContact.get(cid);
    if (!r) continue;
    (c.tags || []).forEach((t) => r.tags.add(t));
    if (!r.d.lead) setDate(r, 'lead', c.dateAdded);
  }

  // 4. Contracts by tag (date = first day the tag was seen, kept in history).
  if (config.contracts.enabled) {
    for (const r of byContact.values()) {
      if (config.contracts.tags.some((t) => r.tags.has(t)) && !r.d.contract) r.d.contract = today;
    }
  }

  // 5. Build records, merging with history so nobody "un-reaches" a step.
  const prev = new Map((previous?.records || []).map((p) => [p.id, p]));
  const out = new Map();
  for (const r of byContact.values()) {
    const id = hashId(config.locationId, r.cid);
    const s = classifySource([...r.tags], raw.textingContactIds.has(r.cid), config);
    const old = prev.get(id);
    const d = {};
    for (const step of STEPS) d[step] = earliest(r.d[step] || null, old?.d?.[step] || null);
    out.set(id, { id, s, d, _cal: r.apptCal, _stage: r.apptStage });
  }
  for (const [id, old] of prev) if (!out.has(id)) out.set(id, { ...old }); // deleted in GHL: keep history

  // 6. Make each funnel consistent: reaching a later step implies the earlier ones,
  //    no later than the later step's date. Contracts are skipped while untracked.
  const chain = STEPS.filter((s) => s !== 'contract' || config.contracts.enabled);
  for (const r of out.values()) {
    if (!config.contracts.enabled) r.d.contract = null;
    for (let i = chain.length - 2; i >= 0; i--) {
      const later = r.d[chain[i + 1]];
      if (later) r.d[chain[i]] = earliest(r.d[chain[i]], later);
    }
    for (const step of STEPS) if (!r.d[step]) delete r.d[step];
  }

  const records = [...out.values()].filter((r) => r.d.lead);
  const apptOnlyCalendar = records.filter((r) => r._cal && !r._stage).length;
  const apptOnlyStage = records.filter((r) => r._stage && !r._cal).length;
  records.forEach((r) => { delete r._cal; delete r._stage; });
  records.sort((a, b) => (a.d.lead < b.d.lead ? -1 : a.d.lead > b.d.lead ? 1 : a.id < b.id ? -1 : 1));

  return {
    generatedAt: now.toISOString(),
    timezone: tz,
    weekStartsOn: 'Monday',
    dataStart: config.dataStart,
    historyTrackedSince: previous?.historyTrackedSince || today,
    contractsTracked: !!config.contracts.enabled,
    definitions: {
      lead: `Meta: contact tagged "${config.meta.tag}" (date added). Texting/other: deal created in "${config.acquisitionsPipeline}".`,
      opp: `Deal reached one of: ${config.opportunityStages.join(', ')}.`,
      appt: `Booked on ${config.appointment.calendars.join(', ')} (booking date, cancelled excluded) or deal reached: ${config.appointment.stages.join(', ')}.`,
      contract: config.contracts.enabled
        ? `Tagged ${config.contracts.tags.join(', ')}${config.contracts.stages.length ? ` or reached ${config.contracts.stages.join(', ')}` : ''}.`
        : 'Not tracked yet.',
      close: `Deal reached ${config.close.stages.join(', ')}${config.close.countWonStatus ? ' or was marked Won' : ''}.`,
    },
    records,
    quality: {
      metaTag: config.meta.tag,
      metaTagVariants: findTagVariants(raw.locationTags || [], config.meta.tag),
      otherSourceLeads: records.filter((r) => r.s === 'other').length,
      disqualifiedStillOpen: quality.disqualifiedOpen,
      cancelledBookingsExcluded: quality.cancelledBookings,
      apptOnlyOnCalendar: apptOnlyCalendar,
      apptOnlyInStage: apptOnlyStage,
    },
  };
}
