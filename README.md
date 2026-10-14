# LOACC Board

A funnel dashboard for 606 Home Buyers. It shows **L**eads → **O**pportunities → **A**ppointments → **C**ontracts → **C**losed, using data pulled from GoHighLevel. Setup steps are in **[SETUP.md](SETUP.md)**.

## How the numbers are calculated

All the rules below come from `config.json`, so you can change them without touching code.

### Who counts as a lead, and from which source

| Source | A lead is… | Lead date |
|---|---|---|
| **Meta** | A contact with the tag `rei survey lead` (exact match) | The day the contact was added |
| **Texting** | A deal created in the **Acquisitions Manager Pipeline** (meaning it was handed to Acquisitions) for a contact who came from SMS marketing | The day the deal was created |
| **Other** | A deal in the Acquisitions pipeline with no Meta tag and no texting signal | The day the deal was created |

- **Combined** = Meta + Texting + Other, with each person counted once.
- **The Meta tag always wins.** Your texting team also works Meta leads, so a Meta lead that gets texted is still counted as Meta, not Texting. This prevents double-counting.
- **How a contact is recognized as "from SMS marketing":** any of these:
  - The contact is in the Texting Manager Pipeline.
  - It has the tag `seller-drip-list` or `src-mass-text`.
  - It has any tag containing the word `campaign` (for example `acq | 10.12.2026 | campaign` or `il | 9.21.2026 campaign`).
- **Why the tag is lowercase:** GHL stores every tag in lowercase, so the tag you think of as "REI Survey Lead" is actually `rei survey lead`. Any tag that *looks* similar but isn't an exact match (for example `rei survey leads`) is **not counted**. Those tags are listed under **Data clean-up** on the dashboard so you can merge them.

### The five steps

| Step | Counted when… | Date used |
|---|---|---|
| **Leads** | See above | See above |
| **Opportunities** | The deal reaches **Working** or a later stage: Appointment Set, Appointment Complete, Offer Sent, Closed Won, Warm Going Cold, Nurture, or Long Term Follow Up | The day it moved into that stage |
| **Appointments** | Either a booking on **Andrew Graf's Personal Calendar** (cancelled bookings excluded) **or** the deal reaching **Appointment Set** or later (Appointment Complete, Offer Sent, Closed Won) | Whichever happened first. For bookings, that's the day the booking was *made*, not the day of the call. |
| **Contracts** | **Not tracked yet.** Turn this on in `config.json` once contracts are tagged `contract-signed` or have their own stage. | The first day the robot sees the tag or stage |
| **Closed** | The deal reaches **Closed Won** or is marked **Won** | The day it moved there |

These rules always apply:

- **Each person counts once per step,** no matter how many deals or bookings they have.
- **Reaching a later step counts every earlier step too.** If a deal jumps straight from New Lead to Appointment Set, it also counts as an Opportunity on that same day.
- **Nobody is ever "un-counted."** If a deal at Appointment Set later slides to Cold Leads or Closed Lost, the appointment still counts in the period it happened. The robot remembers each person's history in `public/data/board.json`. This is necessary because GHL's API only reports a deal's *current* stage, not its full history.
- **Deals created before the dashboard went live** were dated using the last time their stage changed. That's a close approximation. From launch day on, dates are exact to within the 3-hour refresh. The page shows when tracking started.

### Timeframes and comparisons

- Dates are in **Chicago time** (`America/Chicago`). **Weeks start on Monday**, matching your weekly campaign launches. Quarters are calendar quarters (Jan–Mar and so on).
- Each step is counted **in the period it happened.** A September lead that books in October is a September lead and an October appointment.
- **"Compare to the same point last period"** (on by default) compares like with like. On Oct 14, for example, it compares Oct 1–14 with Sep 1–14. Turn it off to compare against the full previous period.
- History starts on **Aug 24, 2026**, when these pipelines were created. Comparisons that reach back before that date show partial or empty earlier periods.

### Conversion rates

Each rate is **(people who reached the next step in the period) ÷ (people who reached the current step in the same period)**.

- **Leads → Opportunities:** Opportunities ÷ Leads
- **Opportunities → Appointments:** Appointments ÷ Opportunities
- **Appointments → Closed:** Closed ÷ Appointments. When Contracts are turned on, this splits into Appointments → Contracts and Contracts → Closed.
- **Overall:** Closed ÷ Leads

Because each step is counted in the period it happened, a short period (like one week) can show a rate above 100%. For example, 2 appointments from last week's leads could close this week, even if only 1 new appointment was booked. Monthly and quarterly views smooth this out. The rate change ("+5.6 pts") is the difference in percentage points.

### Data clean-up panel

The dashboard flags these problems so your GHL data stays trustworthy:

- **Look-alike tags:** tags that resemble the Meta tag but aren't exact
- **Leads with no source:** they count in Combined only
- **Bookings on Andrew's calendar** whose deal was never moved to Appointment Set, and the reverse
- **Open deals named "DISQUALIFIED"** that are still sitting in an active stage
- **Cancelled bookings** that were excluded

## Branding

Colors come straight from the 606 logo: sky blue `#7ebadf` (the Chicago-flag blue), star red `#c52a2c`, and the cream background `#fcf8f6`. Buttons and links use a deeper shade of the same blue (`#1f5e84`) so white text stays readable. The heading font is Fredoka (Google Fonts), chosen to match the logo's rounded lettering. Chart colors start from the brand blue and were checked for color-blind readability in light and dark mode. Red and green stay reserved for up/down changes. All colors are defined at the top of `public/styles.css`.

## Privacy and security

- The GHL token is stored **only** as the GitHub Actions secret `GHL_TOKEN`. It never appears in the code, the data file, or the website.
- The token only needs **read-only** scopes. The dashboard cannot change anything in GHL.
- `board.json` contains no names, phone numbers, emails, or addresses. Each lead is stored as a one-way scrambled ID plus the dates it reached each step.
- The **repo stays private**. The **website is public**: anyone with the link can see the funnel numbers (counts, dates and sources, no personal details). It is hidden from search engines. To require a login later, see SETUP.md, Step 7.

## Files

| File | What it does |
|---|---|
| `config.json` | Business rules: pipeline, stage, tag, and calendar names |
| `scripts/fetch-ghl.mjs` | Pulls data from the GHL API v2 (run by the GitHub Action) |
| `scripts/build.mjs` | Turns the raw data into the anonymous records described above |
| `public/index.html`, `app.js`, `styles.css` | The dashboard itself: plain HTML/JS with Chart.js from cdnjs |
| `public/brand/` | 606 Home Buyers logo (background removed), favicon and app icon |
| `public/data/board.json` | The data file the dashboard reads. Updated by the robot; don't edit it by hand. |
| `.github/workflows/refresh-data.yml` | Runs the robot every 3 hours and on demand |
| `vercel.json` | Hosting settings: no build step, no caching of the data, hidden from search engines |
| `tests/run-tests.mjs` | Runs the script against a fake GHL to check the math (`npm test`) |

## For developers

- No dependencies are needed. Use Node 20 or newer.
- `npm test` checks pagination, source rules, timezone handling, history merging, and that no personal data leaks into the output.
- To run the robot locally: `GHL_TOKEN=... npm run fetch`
- To preview the site: `npx serve public` (or any static file server), then open the page.
