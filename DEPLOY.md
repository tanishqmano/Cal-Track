# Putting the tracker on the internet

Right now the app runs on your Mac and your phone reaches it over your Wi-Fi.
To log food anywhere, two things have to move off the Mac: the **log** (into
MongoDB) and the **app** (onto Render).

Do them in that order. Each step is verifiable on its own, so if something
breaks you know which half broke.

---

## 1. Move the log into MongoDB

1. Make a free cluster at <https://www.mongodb.com/cloud/atlas> (M0, no card).
2. **Database Access** → add a user, note the password.
3. **Network Access** → add `0.0.0.0/0`. This allows connections from anywhere,
   which is what a hosted app needs; the database password is what protects it.
4. **Connect → Drivers** → copy the URI. It looks like:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

   Replace `<db_password>` with the real password. If the password has symbols
   like `@` or `/`, percent-encode them (`@` → `%40`).
5. Add it to `.env`:

   ```
   MONGODB_URI=mongodb+srv://...
   ```
6. Restart: `node server.js`

The startup banner tells you whether it worked. On the first run against an
empty database it also carries your existing `data/state.json` over:

```
Imported data/state.json into MongoDB (now rev 1).
Log:       MongoDB macro-tracker.logs  (rev 1, updated ...) — shared by every device
```

`data/state.json` is left untouched as a backup. Nothing else changes — the app
behaves exactly as before, it just keeps the log somewhere else.

---

## 2. Set a passphrase

Skipping this puts your food log **and your API key** in reach of anyone who
finds the URL. `/api/parse` spends your API key for whoever calls it, so
an open instance is a bill waiting to happen.

```
PASSPHRASE=some words you will remember
```

Restart and reload. Each device asks once, then remembers. The banner confirms:

```
Access:    passphrase required for the log and the API proxy
```

To lock every device out again (a phone was lost, say), change the passphrase
and restart. All devices will ask for the new one.

---

## 3. Put the app on Render

Render deploys from a Git repository, so the code needs to be on GitHub first.

```sh
git init
git add .
git commit -m "Macro tracker"
git remote add origin https://github.com/YOUR-NAME/macro-tracker.git
git push -u origin main
```

`.gitignore` already keeps `.env`, `data/` and `node_modules/` out, so no
secrets go up.

Then on <https://render.com>:

1. **New → Blueprint**, pick the repo. `render.yaml` fills in the build and
   start commands.
2. Render asks for the values marked `sync: false`. Paste in:
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL` (whatever your `.env` uses)
   - `MONGODB_URI`
   - `PASSPHRASE`
3. Deploy. You get a URL like `https://macro-tracker-xxxx.onrender.com`.

Open it, enter the passphrase, and your days are there — they came from Mongo,
not from the browser.

### What to expect on the free plan

- **It sleeps.** After ~15 minutes idle the instance stops, and the next request
  takes 30–60 seconds to wake it. Logging breakfast means waiting a moment on
  the first message of the day.
- **The disk is temporary.** Anything written to `data/` disappears on restart.
  This is why step 1 comes first.
- Sleeping costs nothing and loses nothing — the log is in Mongo.

---

## Checking it worked

```sh
# Should say auth:true, authed:false — the gate is up.
curl https://YOUR-APP.onrender.com/api/health

# Should be 401 without the passphrase.
curl -o /dev/null -w '%{http_code}\n' https://YOUR-APP.onrender.com/api/state

# Should be 200 with it.
curl -o /dev/null -w '%{http_code}\n' \
  -H 'x-macro-pass: your passphrase' https://YOUR-APP.onrender.com/api/state
```

If the first one says `auth:false`, `PASSPHRASE` did not reach the instance —
check the environment variables in the Render dashboard and redeploy.

---

## Going back

Nothing here is one-way. Remove `MONGODB_URI` from `.env` and the app returns to
`data/state.json`; remove `PASSPHRASE` and the gate disappears. The Mac keeps
working on your Wi-Fi whether or not Render is running.
