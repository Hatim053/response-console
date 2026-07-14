require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "response_console";
const COLLECTION_NAME = process.env.COLLECTION_NAME || "console_data";
const HISTORY_COLLECTION = "response_history";

const DOC_ID = "main";

if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI. Copy .env.example to .env and paste your connection string.");
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);
let collection;
let historyCollection;

async function start() {
  await client.connect();
  const db = client.db(DB_NAME);
  collection = db.collection(COLLECTION_NAME);
  historyCollection = db.collection(HISTORY_COLLECTION);
  
  // Create index for faster history queries
  await historyCollection.createIndex({ userId: 1, createdAt: -1 });
  await historyCollection.createIndex({ createdAt: -1 });
  
  console.log("Connected to MongoDB:", DB_NAME, "/", COLLECTION_NAME);

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

// ==================== MAIN DATA ====================
app.get("/api/data", async (req, res) => {
  try {
    const doc = await collection.findOne({ _id: DOC_ID });
    res.json({ ok: true, data: doc ? doc.data : null, updatedAt: doc ? doc.updatedAt : null });
  } catch (err) {
    console.error("GET /api/data failed:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch data" });
  }
});

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

// ==================== DISPOSITION ENDPOINTS ====================
// Get disposition for a specific response
app.get("/api/disposition/:responseId", async (req, res) => {
  try {
    const { responseId } = req.params;
    const doc = await collection.findOne({ _id: DOC_ID });
    
    if (!doc || !doc.data) {
      return res.json({ ok: true, disposition: null });
    }
    
    // Find the response with this ID
    let foundDisposition = null;
    for (const cat of doc.data) {
      for (const resp of cat.responses) {
        if (resp.id === responseId) {
          foundDisposition = resp.disposition || null;
          break;
        }
      }
      if (foundDisposition !== null) break;
    }
    
    res.json({ ok: true, disposition: foundDisposition });
  } catch (err) {
    console.error("GET /api/disposition failed:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch disposition" });
  }
});

// Update disposition for a specific response
app.post("/api/disposition/:responseId", async (req, res) => {
  try {
    const { responseId } = req.params;
    const { disposition } = req.body;
    
    // Get current data
    const doc = await collection.findOne({ _id: DOC_ID });
    if (!doc || !doc.data) {
      return res.status(404).json({ ok: false, error: "No data found" });
    }
    
    let found = false;
    const data = doc.data;
    
    // Find and update the response
    for (const cat of data) {
      for (const resp of cat.responses) {
        if (resp.id === responseId) {
          resp.disposition = disposition;
          found = true;
          break;
        }
      }
      if (found) break;
    }
    
    if (!found) {
      return res.status(404).json({ ok: false, error: "Response not found" });
    }
    
    // Save back to database
    await collection.updateOne(
      { _id: DOC_ID },
      { $set: { data, updatedAt: new Date().toISOString() } }
    );
    
    res.json({ ok: true, disposition });
  } catch (err) {
    console.error("POST /api/disposition failed:", err);
    res.status(500).json({ ok: false, error: "Failed to update disposition" });
  }
});

// ==================== HISTORY / TRACKING ENDPOINTS ====================
// Save a generated response to history
app.post("/api/history", async (req, res) => {
  try {
    const { userId, responseId, title, category, categoryCode, template, fields, language, status, disposition } = req.body;
    
    const historyEntry = {
      userId: userId || "anonymous",
      responseId,
      title,
      category,
      categoryCode,
      template,
      fields: fields || {},
      language: language || "en",
      status: status || "fresh",
      disposition: disposition || null,
      createdAt: new Date().toISOString()
    };
    
    const result = await historyCollection.insertOne(historyEntry);
    res.json({ ok: true, id: result.insertedId });
  } catch (err) {
    console.error("POST /api/history failed:", err);
    res.status(500).json({ ok: false, error: "Failed to save history" });
  }
});

// Get history for a specific user
app.get("/api/history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;
    
    const history = await historyCollection
      .find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
    
    const total = await historyCollection.countDocuments({ userId });
    
    res.json({ 
      ok: true, 
      history,
      total,
      limit,
      skip
    });
  } catch (err) {
    console.error("GET /api/history failed:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch history" });
  }
});

// Get all history (for admin/debugging)
app.get("/api/history/all", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const history = await historyCollection
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    
    res.json({ ok: true, history });
  } catch (err) {
    console.error("GET /api/history/all failed:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch history" });
  }
});

// Delete a history entry
app.delete("/api/history/:id", async (req, res) => {
  try {
    const { id } = req.params;
    // For MongoDB ObjectId
    const { ObjectId } = require("mongodb");
    const result = await historyCollection.deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ ok: false, error: "History entry not found" });
    }
    
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/history failed:", err);
    res.status(500).json({ ok: false, error: "Failed to delete history" });
  }
});

// Clear all history for a user
app.delete("/api/history/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await historyCollection.deleteMany({ userId });
    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error("DELETE /api/history/user failed:", err);
    res.status(500).json({ ok: false, error: "Failed to clear history" });
  }
});

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});