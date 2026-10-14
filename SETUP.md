# LOACC Board — Setup Guide

This guide is written for someone who doesn't write code. Plan on about 45 minutes. You only do it once.

**What you're setting up**

```
GoHighLevel ──(every 3 hours)──► GitHub Action ──► data file in your private repo
                                                          │
                                         Vercel rebuilds the site automatically
                                                          ▼
                                       LOACC Board (public link)
```

- **GitHub** stores the code and runs a small robot (a "GitHub Action") every 3 hours. The robot reads your GHL data and saves a data file.
- **Vercel** hosts the dashboard at a public link. Anyone with the link can view it; the GitHub repo itself stays private.
- **The GHL token** is the robot's key to your GHL account. It is stored only as a GitHub secret. It is never in the code, never on the website, and never visible to viewers.

**What you need**

- Admin access to the **606 Home Buyers LLC** sub-account in GHL
- A GitHub account (free is fine): https://github.com/signup
- A Vercel account: https://vercel.com/signup. Sign up with **"Continue with GitHub"**, which makes step 5 easier.

---

## Step 1 — Get the GHL token

1. In GHL, switch to the **606 Home Buyers LLC** sub-account. Use the main one, not "Dispo".
2. Go to **Settings → Private Integrations**.
   - If you don't see it, it may need to be turned on under **Settings → Labs**.
3. Click **Create new Integration**.
   - Name: `LOACC Board`
   - Description: `Read-only access for the reporting dashboard`
4. Turn on **only these read-only scopes**:

   | Scope | Why it's needed |
   |---|---|
   | View Contacts (`contacts.readonly`) | Find Meta leads by tag |
   | View Opportunities (`opportunities.readonly`) | Read the pipeline stages |
   | View Calendars (`calendars.readonly`) | Find Andrew's calendar |
   | View Calendar Events (`calendars/events.readonly`) | Count bookings |
   | View Tags (`locations/tags.readonly`) | Check for misspelled Meta tags |

   Do **not** turn on any "edit", "write", or "delete" scopes. The dashboard never changes anything in GHL.
5. Click create, then **copy the token right away**. GHL only shows it once. Paste it somewhere private for the next 10 minutes, such as a note you'll delete afterwards. Don't put it in email or Slack.

## Step 2 — Create the private GitHub repo

1. Go to https://github.com/new.
2. Repository name: `loacc-board`.
3. Choose **Private**. This is important, because the data file lives in the repo.
4. Leave everything else unticked and click **Create repository**.

## Step 3 — Upload the files

1. On the new repo's page, click **uploading an existing file**.
2. Unzip `loacc-board.zip` on your computer.
3. Open the unzipped folder, select **everything inside it**, and drag it into the browser window.
   - The `.github` folder is hidden on some computers. On a Mac, press **Cmd + Shift + .** in Finder to show hidden files. On Windows, go to **View → Show → Hidden items**. That folder must be uploaded, or the data will never refresh.
4. Click **Commit changes**.
5. Check that you can see `.github/workflows/refresh-data.yml` in the repo. If it's missing, use **Add file → Create new file**, type `.github/workflows/refresh-data.yml` as the name, paste in the contents of that file from the zip, and commit.

## Step 4 — Store the token as a secret

1. In the repo, go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**.
   - Name: `GHL_TOKEN` (exactly this)
   - Secret: paste the token from Step 1
3. Click **Add secret**. GitHub will never show it again, not even to you. That's expected.
4. Delete the note where you temporarily saved the token.

## Step 5 — Run the robot once

1. In the repo, click the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
2. Click **Refresh LOACC data** on the left, then **Run workflow → Run workflow**.
3. Wait 1–3 minutes for the green check mark.
   - If you see a red ✗, click into it and read the last few lines. "GHL refused" means the token is wrong or a scope from Step 1 is missing. "not found" means a pipeline, stage, or calendar name in `config.json` doesn't match GHL.
4. Go back to the **Code** tab and open `public/data/board.json`. It should now be full of entries like `"s":"meta"` with dates. You will **not** see any names, phones, or emails, because the robot strips those out.

From now on, the robot runs every 3 hours on its own.

## Step 6 — Put it on Vercel

1. In Vercel, click **Add New… → Project**.
2. Find `loacc-board` in the list and click **Import**. If it isn't listed, click **Adjust GitHub App Permissions** and give Vercel access to that repo.
3. Leave **Framework Preset** as **Other**. Don't change the build settings, because `vercel.json` already handles them.
4. Click **Deploy**. In under a minute you'll get a link like `loacc-board.vercel.app`.

## Step 7 — Check it's public (and decide if you want it that way)

The dashboard is set up as a **public website**: anyone with the link can see it, with no login. The page is hidden from Google and other search engines, but the link itself works for anyone you send it to, or anyone they forward it to.

1. In the project, go to **Settings → Deployment Protection**.
2. Make sure it says **Standard Protection** (the default) or is turned off. Standard Protection only locks preview links; your main `….vercel.app` link stays public.
3. Open your main link in a private/incognito window. You should see the dashboard straight away, with no login screen.

**If you ever want to lock it later,** change the scope in that same screen to **All Deployments** and pick **Vercel Authentication** (each person logs in) or **Password Protection** (one shared password, a paid add-on). Note that Vercel's free **Hobby** plan is meant for personal, non-commercial use; for business use, Vercel expects a **Pro** plan.

## You're done

- The dashboard updates about 1–2 minutes after each robot run, every 3 hours.
- To refresh on demand, go to GitHub → **Actions → Refresh LOACC data → Run workflow**.

## Changing things later

All business rules live in **`config.json`**. Edit it on GitHub by opening the file and clicking the pencil icon. The next robot run picks up the change.

| To do this | Change this in `config.json` |
|---|---|
| Start counting **Contracts** | `"contracts": { "enabled": true, ... }`. Then add the `contract-signed` tag in GHL whenever a contract is signed, or list a pipeline stage under `"stages"`. |
| Switch to the new **LOACC pipelines** later | Change `"acquisitionsPipeline"` and every stage name to match the new pipeline exactly |
| Add another calendar (e.g. "On-Site Visit") | Add its exact name to `"appointment" → "calendars"` |
| Count a stage as an Opportunity or Appointment | Add its exact name to `"opportunityStages"` or `"appointment" → "stages"` |
| Mark more tags as texting campaigns | Add them to `"texting" → "tags"` |

Names must match GHL **exactly**. If one doesn't, the robot stops with a clear error instead of quietly showing wrong numbers.

## Keeping the token safe

- GHL recommends **rotating the token every 90 days**. In GHL, go to **Private Integrations → your integration → Rotate and expire this token later**. Then paste the new token into the GitHub secret (Step 4: click `GHL_TOKEN`, then **Update**). The old token keeps working for 7 days, so nothing breaks while you do this.
- If you ever think the token leaked, use **Rotate and expire this token now** instead.
- Never paste the token into `config.json`, any code file, a GitHub issue, or chat.

## Costs to expect

- **GitHub:** free for a private repo. Each robot run takes about a minute, which keeps you well inside the free monthly Actions minutes.
- **Vercel:** Pro plan, plus $20/month if you choose Password Protection. Check https://vercel.com/pricing for current numbers.
- **GHL:** no extra cost.
