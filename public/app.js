/* LOACC Board — reads data/board.json and does all period math in the browser. */
(() => {
  'use strict';

  const STEPS = [
    { key: 'lead', label: 'Leads', color: '--s1' },
    { key: 'opp', label: 'Opportunities', color: '--s2' },
    { key: 'appt', label: 'Appointments', color: '--s3' },
    { key: 'contract', label: 'Contracts', color: '--s4' },
    { key: 'close', label: 'Closed', color: '--s5' },
  ];
  const TREND_LEN = { week: 12, month: 12, quarter: 8, year: 4 };
  const UNIT_WORD = { week: 'week', month: 'month', quarter: 'quarter', year: 'year' };

  const state = { source: 'all', unit: 'month', offset: 0, samePoint: true };
  let board = null;
  let charts = [];

  // ---------- dates (all as 'YYYY-MM-DD' strings in the board's timezone) ----------
  const toDate = (s) => new Date(`${s}T00:00:00Z`);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fmt(d); };
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

  function periodStart(s, unit) {
    const d = toDate(s);
    if (unit === 'week') { const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); }
    else if (unit === 'month') d.setUTCDate(1);
    else if (unit === 'quarter') { d.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3, 1); }
    else d.setUTCMonth(0, 1);
    return fmt(d);
  }
  function shift(start, unit, n) {
    if (unit === 'week') return addDays(start, 7 * n);
    const d = toDate(start);
    const months = unit === 'month' ? 1 : unit === 'quarter' ? 3 : 12;
    d.setUTCMonth(d.getUTCMonth() + months * n, 1);
    return fmt(d);
  }
  const periodEnd = (start, unit) => addDays(shift(start, unit, 1), -1);

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function label(start, unit, short = false) {
    const d = toDate(start);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    if (unit === 'week') {
      const a = `${MONTHS[m]} ${d.getUTCDate()}`;
      return short ? a : `Week of ${a}, ${y}`;
    }
    if (unit === 'month') return short ? `${MONTHS[m]} ’${String(y).slice(2)}` : `${MONTHS[m]} ${y}`;
    if (unit === 'quarter') return short ? `Q${m / 3 + 1} ’${String(y).slice(2)}` : `Q${m / 3 + 1} ${y}`;
    return String(y);
  }
  const shortDay = (s) => { const d = toDate(s); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };

  function today() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: board.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  // ---------- counting ----------
  const contractsOn = () => board.contractsTracked;
  const activeSteps = () => STEPS.filter((s) => s.key !== 'contract' || contractsOn());
  const records = () => board.records.filter((r) => state.source === 'all' || r.s === state.source);

  function counts(from, to) {
    const out = Object.fromEntries(STEPS.map((s) => [s.key, 0]));
    for (const r of records()) {
      for (const s of STEPS) { const v = r.d[s.key]; if (v && v >= from && v <= to) out[s.key] += 1; }
    }
    return out;
  }
  function rateDefs() {
    const a = activeSteps();
    const defs = [];
    for (let i = 0; i < a.length - 1; i++) {
      defs.push({ id: `${a[i].key}-${a[i + 1].key}`, from: a[i].key, to: a[i + 1].key, label: `${a[i].label} → ${a[i + 1].label}` });
    }
    defs.push({ id: 'overall', from: 'lead', to: 'close', label: 'Overall: Leads → Closed', overall: true });
    return defs;
  }
  const rate = (c, d) => (c[d.from] ? c[d.to] / c[d.from] : null);

  // ---------- periods in view ----------
  function windows() {
    const t = today();
    const curStart = shift(periodStart(t, state.unit), state.unit, state.offset);
    const curFullEnd = periodEnd(curStart, state.unit);
    const isCurrent = state.offset === 0;
    const curEnd = isCurrent ? t : curFullEnd;
    const prevStart = shift(curStart, state.unit, -1);
    const prevFullEnd = periodEnd(prevStart, state.unit);
    let prevEnd = prevFullEnd;
    if (isCurrent && state.samePoint) {
      const elapsed = daysBetween(curStart, t);
      prevEnd = addDays(prevStart, elapsed);
      if (prevEnd > prevFullEnd) prevEnd = prevFullEnd;
    }
    return { curStart, curEnd, curFullEnd, prevStart, prevEnd, prevFullEnd, isCurrent, t };
  }

  // ---------- formatting ----------
  const pct = (v, digits = 1) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`);
  const num = (v) => v.toLocaleString('en-US');
  function deltaHTML(cur, prev, kind) {
    if (cur == null || prev == null) return '<p class="delta flat">No comparison yet</p>';
    if (kind === 'rate') {
      const pts = (cur - prev) * 100;
      const cls = Math.abs(pts) < 0.05 ? 'flat' : pts > 0 ? 'up' : 'down';
      const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '■';
      return `<p class="delta ${cls}">${arrow} ${pts > 0 ? '+' : ''}${pts.toFixed(1)} pts</p>`;
    }
    const diff = cur - prev;
    const cls = diff === 0 ? 'flat' : diff > 0 ? 'up' : 'down';
    const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '■';
    const p = prev === 0 ? (cur === 0 ? '0%' : 'new') : `${diff > 0 ? '+' : ''}${((diff / prev) * 100).toFixed(1)}%`;
    return `<p class="delta ${cls}">${arrow} ${diff > 0 ? '+' : ''}${num(diff)} (${p})</p>`;
  }
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------- render ----------
  function render() {
    const w = windows();
    const cur = counts(w.curStart, w.curEnd);
    const prev = counts(w.prevStart, w.prevEnd);
    const prevWord = `last ${UNIT_WORD[state.unit]}`;

    document.getElementById('periodLabel').textContent = label(w.curStart, state.unit);
    document.getElementById('next').disabled = state.offset >= 0;
    document.getElementById('prev').disabled = shift(w.curStart, state.unit, -1) < periodStart(board.dataStart, state.unit);
    document.getElementById('samePoint').disabled = !w.isCurrent;

    const curRange = `${shortDay(w.curStart)}–${shortDay(w.curEnd)}`;
    const prevRange = `${shortDay(w.prevStart)}–${shortDay(w.prevEnd)}`;
    let note = `Showing ${curRange} vs ${prevRange}.`;
    if (w.isCurrent && !state.samePoint) note += ` This ${UNIT_WORD[state.unit]} isn't over yet, so it's being compared to a full ${UNIT_WORD[state.unit]}.`;
    if (w.prevStart < board.dataStart) note += ` Tracking starts ${shortDay(board.dataStart)}, ${board.dataStart.slice(0, 4)}, so the earlier period is partial or empty.`;
    document.getElementById('compareNote').textContent = note;

    // metric cards
    document.getElementById('metricCards').innerHTML = STEPS.map((s) => {
      if (s.key === 'contract' && !contractsOn()) {
        return `<div class="card muted"><p class="label">${s.label}</p><p class="value">Not tracked yet</p><p class="prev">Turn on in config.json once contracts are tagged in GHL.</p></div>`;
      }
      return `<div class="card"><p class="label">${s.label}</p><p class="value">${num(cur[s.key])}</p>
        <p class="prev">${num(prev[s.key])} ${prevWord}</p>${deltaHTML(cur[s.key], prev[s.key])}</div>`;
    }).join('');

    // rate cards
    document.getElementById('rateCards').innerHTML = rateDefs().map((d) => {
      const rc = rate(cur, d), rp = rate(prev, d);
      return `<div class="card${d.overall ? ' overall' : ''}"><p class="label">${esc(d.label)}</p><p class="value">${pct(rc)}</p>
        <p class="prev">${pct(rp)} ${prevWord}</p>${deltaHTML(rc, rp, 'rate')}</div>`;
    }).join('');

    renderFunnel(cur);
    renderTrends();
    renderQuality();
  }

  function renderFunnel(cur) {
    const steps = activeSteps();
    const max = Math.max(1, ...steps.map((s) => cur[s.key]));
    const ramp = ['--ramp-1', '--ramp-2', '--ramp-3', '--ramp-4', '--ramp-5'];
    let worst = null;
    for (let i = 1; i < steps.length; i++) {
      const r = cur[steps[i - 1].key] ? cur[steps[i].key] / cur[steps[i - 1].key] : null;
      if (r != null && (worst == null || r < worst.r)) worst = { i, r };
    }
    const html = steps.map((s, i) => {
      const v = cur[s.key];
      const w = (v / max) * 84; // leave room for the number after the bar
      const bar = `<div class="fbar" style="width:${w}%;background:${css(ramp[i])}"></div>`;
      const val = `<span class="fval" style="left:calc(${w}% + 8px)">${num(v)}</span>`;
      let step = '';
      if (i > 0) {
        const prevV = cur[steps[i - 1].key];
        const r = prevV ? v / prevV : null;
        const lost = prevV ? Math.max(0, prevV - v) : 0;
        step = `<p class="fstep${worst && worst.i === i ? ' worst' : ''}">${pct(r, 0)} moved on from ${steps[i - 1].label.toLowerCase()}${lost ? ` · ${num(lost)} didn't` : ''}</p>`;
      }
      return `${step}<div class="frow"><span class="fname">${s.label}</span><div class="fbar-track">${bar}${val}</div></div>`;
    }).join('');
    document.getElementById('funnel').innerHTML = html;
    document.getElementById('dropNote').textContent = worst
      ? `Biggest drop this period: ${steps[worst.i - 1].label} → ${steps[worst.i].label} (${pct(worst.r, 0)} moved on).`
      : 'Not enough activity in this period to compare steps.';
  }

  function trendPeriods() {
    const w = windows();
    const first = periodStart(board.dataStart, state.unit);
    const list = [];
    for (let i = TREND_LEN[state.unit] - 1; i >= 0; i--) {
      const s = shift(w.curStart, state.unit, -i);
      if (s < first) continue;
      const fullEnd = periodEnd(s, state.unit);
      list.push({ start: s, end: fullEnd > w.t ? w.t : fullEnd, partial: fullEnd > w.t });
    }
    return list;
  }

  function baseOptions(yFormat) {
    const text = css('--text-2'), grid = css('--grid');
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${yFormat(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: text, font: { size: 11 }, maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: text, font: { size: 11 }, precision: 0, callback: yFormat } },
      },
    };
  }

  // Draws each line's name at its last point so the chart doesn't rely on color alone.
  const endLabels = {
    id: 'endLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      const placed = [];
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        let idx = ds.data.length - 1;
        while (idx >= 0 && ds.data[idx] == null) idx--;
        if (idx < 0 || meta.hidden) return;
        const pt = meta.data[idx];
        let y = pt.y;
        while (placed.some((p) => Math.abs(p - y) < 13)) y += 13;
        placed.push(y);
        ctx.save();
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillStyle = css('--text-2');
        ctx.textAlign = 'right';
        ctx.fillText(ds.short, pt.x - 6, y - 7);
        ctx.restore();
      });
    },
  };

  function renderTrends() {
    charts.forEach((c) => c.destroy());
    charts = [];
    const periods = trendPeriods();
    const labels = periods.map((p) => label(p.start, state.unit, true) + (p.partial ? '*' : ''));
    const data = periods.map((p) => counts(p.start, p.end));
    const hasChart = typeof window.Chart !== 'undefined';

    // small multiples — one chart per metric
    const box = document.getElementById('multiples');
    box.innerHTML = STEPS.map((s) => `<div class="panel"><h3>${s.label}</h3>${
      s.key === 'contract' && !contractsOn() ? '<div class="na">Not tracked yet</div>' : `<div class="mini"><canvas id="m-${s.key}" aria-label="${s.label} per period"></canvas></div>`
    }</div>`).join('');
    if (hasChart) {
      for (const s of STEPS) {
        if (s.key === 'contract' && !contractsOn()) continue;
        const color = css(s.color);
        const opts = baseOptions((v) => num(v));
        opts.scales.x.ticks.maxTicksLimit = 6;
        charts.push(new Chart(document.getElementById(`m-${s.key}`), {
          type: 'bar',
          data: {
            labels,
            datasets: [{
              label: s.label, data: data.map((c) => c[s.key]),
              backgroundColor: periods.map((p, i) => (i === periods.length - 1 ? color : `${color}99`)),
              borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 28,
            }],
          },
          options: opts,
        }));
      }
    }

    // conversion rates over time
    const defs = rateDefs();
    if (hasChart) {
      const colors = ['--s1', '--s2', '--s3', '--s4', '--s5'];
      charts.push(new Chart(document.getElementById('rateChart'), {
        type: 'line',
        data: {
          labels,
          datasets: defs.map((d, i) => ({
            label: d.label,
            short: d.overall ? 'Overall' : d.label.replace('Opportunities', 'Opps').replace('Appointments', 'Appts').replace('Contracts', 'Contr.'),
            data: data.map((c) => rate(c, d)),
            borderColor: css(d.overall ? '--text' : colors[i]),
            backgroundColor: css(d.overall ? '--text' : colors[i]),
            borderWidth: 2, borderDash: d.overall ? [5, 4] : [], pointRadius: 3, pointHoverRadius: 5, spanGaps: true, tension: 0,
          })),
        },
        options: (() => {
          const o = baseOptions((v) => (v == null ? '—' : `${Math.round(v * 100)}%`));
          o.plugins.legend = { display: true, position: 'bottom', labels: { color: css('--text-2'), boxWidth: 12, boxHeight: 2, font: { size: 11 } } };
          o.layout = { padding: { top: 14 } };
          return o;
        })(),
        plugins: [endLabels],
      }));
    }

    // table view
    const rows = data.map((c, i) => `<tr><td>${esc(labels[i])}</td>${activeSteps().map((s) => `<td>${num(c[s.key])}</td>`).join('')}${defs.map((d) => `<td>${pct(rate(c, d))}</td>`).join('')}</tr>`).join('');
    document.getElementById('trendTable').innerHTML =
      `<thead><tr><th>Period</th>${activeSteps().map((s) => `<th>${s.label}</th>`).join('')}${defs.map((d) => `<th>${esc(d.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody>`;
  }

  function renderQuality() {
    const q = board.quality;
    const items = [];
    items.push(q.metaTagVariants.length
      ? `<strong>${q.metaTagVariants.length} tag(s) look like <code>${esc(q.metaTag)}</code> but don't match exactly</strong> and are <em>not</em> counted as Meta leads: ${q.metaTagVariants.map((t) => `<code>${esc(t)}</code>`).join(', ')}. Merge them into the exact tag in GHL.`
      : `No misspelled versions of <code>${esc(q.metaTag)}</code> found.`);
    if (q.otherSourceLeads) items.push(`<strong>${num(q.otherSourceLeads)} lead(s) have no source</strong> — not Meta-tagged and no texting campaign tag. They count in Combined only.`);
    if (q.apptOnlyOnCalendar) items.push(`<strong>${num(q.apptOnlyOnCalendar)} booking(s) on the calendar</strong> whose deal was never moved to Appointment Set.`);
    if (q.apptOnlyInStage) items.push(`<strong>${num(q.apptOnlyInStage)} deal(s) at Appointment Set or later</strong> with no booking on the tracked calendar.`);
    if (q.disqualifiedStillOpen) items.push(`<strong>${num(q.disqualifiedStillOpen)} open deal(s) named "DISQUALIFIED"</strong> are still in an active stage. Move them to Closed Lost so they stop inflating the funnel.`);
    if (q.cancelledBookingsExcluded) items.push(`${num(q.cancelledBookingsExcluded)} cancelled booking(s) were left out.`);
    document.getElementById('quality').innerHTML = items.map((i) => `<li>${i}</li>`).join('');

    const defs = board.definitions;
    document.getElementById('defs').innerHTML = STEPS.map((s) => `<dt>${s.label}</dt><dd>${esc(defs[s.key] || '')}</dd>`).join('');
  }

  // ---------- controls ----------
  function wireSeg(id, key, after) {
    const el = document.getElementById(id);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      state[key] = b.dataset.v;
      if (after) after();
      save(); render();
    });
  }
  function save() {
    try { localStorage.setItem('loacc-view', JSON.stringify({ source: state.source, unit: state.unit, samePoint: state.samePoint })); } catch { /* private mode */ }
  }
  function restore() {
    try {
      const v = JSON.parse(localStorage.getItem('loacc-view') || '{}');
      if (['all', 'meta', 'texting'].includes(v.source)) state.source = v.source;
      if (TREND_LEN[v.unit]) state.unit = v.unit;
      if (typeof v.samePoint === 'boolean') state.samePoint = v.samePoint;
    } catch { /* ignore */ }
    for (const [id, key] of [['source', 'source'], ['unit', 'unit']]) {
      document.querySelectorAll(`#${id} button`).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === state[key])));
    }
    document.getElementById('samePoint').checked = state.samePoint;
  }

  async function init() {
    try {
      const res = await fetch('data/board.json', { cache: 'no-store' });
      board = await res.json();
    } catch {
      document.querySelector('main').innerHTML = '<div class="empty">Couldn\'t load the data file. Try refreshing.</div>';
      return;
    }
    if (!board.records || !board.generatedAt) {
      document.getElementById('updated').textContent = 'No data yet';
      document.querySelector('main').innerHTML = '<div class="empty"><strong>No data yet.</strong><br>Run the “Refresh LOACC data” workflow in GitHub (Actions tab), wait for it to finish, then reload this page.</div>';
      return;
    }
    const when = new Date(board.generatedAt).toLocaleString('en-US', { timeZone: board.timezone, dateStyle: 'medium', timeStyle: 'short' });
    document.getElementById('updated').textContent = `Updated ${when} (Central)`;

    restore();
    wireSeg('source', 'source');
    wireSeg('unit', 'unit', () => { state.offset = 0; });
    document.getElementById('prev').addEventListener('click', () => { state.offset -= 1; render(); });
    document.getElementById('next').addEventListener('click', () => { if (state.offset < 0) { state.offset += 1; render(); } });
    document.getElementById('samePoint').addEventListener('change', (e) => { state.samePoint = e.target.checked; save(); render(); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
