# Response Console Backend

A tiny Express + MongoDB backend with exactly two APIs:

- `GET /api/data` — called once when a user opens the page. Returns whatever was last saved (or `null` if nothing's been saved yet).
- `POST /api/data` — called whenever a user adds/changes something. Overwrites the single shared record, so the next `GET` (by anyone, any tab, any device) sees the update.

Everything is stored in **one document** in MongoDB, so there's no per-user split — one shared source of truth.

## 1. Setup

```bash
cd response-console-backend
npm install
cp .env.example .env
```

Open `.env` and paste your real connection string:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster-url>/?retryWrites=true&w=majority
```

## 2. Run it

```bash
npm start
```

You should see:
```
Connected to MongoDB: response_console / console_data
Server running on http://localhost:3000
```

## 3. Deploy it

This is a plain Node/Express app, so it runs as-is on Render, Railway, Fly.io, a VPS, etc.
Just set `MONGODB_URI` (and optionally `PORT`) as environment variables on whichever host you use — don't commit your real `.env` file.

## 4. Wire it into your frontend HTML

Two things to add to your existing `Response Console` page:

**a) On page load — fetch the shared data:**

```js
const API_BASE = "https://your-backend-url.com"; // change this after you deploy

async function loadSharedData() {
  try {
    const res = await fetch(`${API_BASE}/api/data`);
    const json = await res.json();
    if (json.ok && json.data) {
      // json.data is whatever was last saved via POST — e.g. your CATEGORIES array.
      // Replace your local CATEGORIES with it before calling init():
      CATEGORIES.length = 0;
      CATEGORIES.push(...json.data);
    }
  } catch (err) {
    console.error("Could not load shared data, using local defaults:", err);
  }
  init(); // your existing init() call — move it here instead of calling it at the bottom of the script
}

loadSharedData();
```

**b) Whenever data changes (e.g. after adding/editing a response) — save it back:**

```js
async function saveSharedData() {
  try {
    await fetch(`${API_BASE}/api/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: CATEGORIES })
    });
  } catch (err) {
    console.error("Could not save shared data:", err);
  }
}
```

Call `saveSharedData()` right after whatever action mutates `CATEGORIES` in your app (e.g. after a new response template is added). Every other open tab will pick it up the next time it calls `loadSharedData()` (page load/refresh).

## Notes

- No auth is included — anyone with the URL can read/write. Add an API key check in `server.js` if this needs to be locked down.
- If you want *live* updates without a refresh (not just "next visit"), that needs polling or WebSockets — let me know if you want that added.