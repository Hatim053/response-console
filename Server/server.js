require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" })); // generous limit since the whole category tree can be posted at once

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "response_console";
const COLLECTION_NAME = process.env.COLLECTION_NAME || "console_data";

// Everything lives in ONE document with a fixed _id, so every user reads/writes
// the exact same record. That's what makes "one user edits it, everyone sees it" work.
const DOC_ID = "main";

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI. Copy .env.example to .env and paste your connection string.");
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);
let collection;

async function start() {
  await client.connect();
  const db = client.db(DB_NAME);
  collection = db.collection(COLLECTION_NAME);
  console.log("Connected to MongoDB:", DB_NAME, "/", COLLECTION_NAME);

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

/**
 * GET /api/data
 * Called once when the page loads. Returns whatever was last saved.
 * If nothing has ever been saved, returns { data: null } so the frontend
 * can fall back to its own built-in defaults.
 */
app.get("/api/data", async (req, res) => {
  try {
    const doc = await collection.findOne({ _id: DOC_ID });
    res.json({ ok: true, data: doc ? doc.data : null, updatedAt: doc ? doc.updatedAt : null });
  } catch (err) {
    console.error("GET /api/data failed:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch data" });
  }
});

/**
 * POST /api/data
 * Body: { "data": <anything JSON-serializable> }
 * Overwrites the single shared document. Whatever object you send here
 * becomes what every other user gets back from GET /api/data.
 */
app.post("/api/data", async (req, res) => {
  try {
    const { data } = req.body;
    if (data === undefined) {
      return res.status(400).json({ ok: false, error: "Request body must include a 'data' field" });
    }

    await collection.updateOne(
      { _id: DOC_ID },
      { $set: { data, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/data failed:", err);
    res.status(500).json({ ok: false, error: "Failed to save data" });
  }
});

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});