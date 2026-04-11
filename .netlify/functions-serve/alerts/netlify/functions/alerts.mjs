
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/alerts.mjs
import { ObjectId } from "mongodb";

// netlify/lib/mongodb.mjs
import { MongoClient } from "mongodb";
var cachedClient = null;
var cachedDb = null;
async function getDb() {
  if (cachedClient && cachedDb) {
    return cachedDb;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }
  const client = new MongoClient(uri, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5e3
  });
  await client.connect();
  const dbName = process.env.MONGODB_DB_NAME || "stock_analyzer";
  const db = client.db(dbName);
  cachedClient = client;
  cachedDb = db;
  return db;
}

// netlify/lib/firebase-admin.mjs
import admin from "firebase-admin";
function initFirebase() {
  if (admin.apps.length > 0) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyB64 = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKeyB64) {
    throw new Error("Firebase env vars missing: " + (!projectId ? "FIREBASE_PROJECT_ID " : "") + (!clientEmail ? "FIREBASE_CLIENT_EMAIL " : "") + (!privateKeyB64 ? "FIREBASE_PRIVATE_KEY " : ""));
  }
  let privateKey;
  try {
    privateKey = Buffer.from(privateKeyB64, "base64").toString("utf-8");
  } catch (e) {
    privateKey = privateKeyB64.replace(/\\n/g, "\n");
  }
  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey })
  });
}
async function verifyToken(req) {
  initFirebase();
  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("Missing or invalid Authorization header");
  const decoded = await admin.auth().verifyIdToken(match[1]);
  return {
    uid: decoded.uid,
    email: decoded.email || null,
    name: decoded.name || null,
    picture: decoded.picture || null,
    phone: decoded.phone_number || null
  };
}

// netlify/functions/alerts.mjs
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}
function error(message, status = 400) {
  return json({ error: message }, status);
}
async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  try {
    const user = await verifyToken(req);
    const db = await getDb();
    switch (action) {
      case "create":
        return await handleCreate(db, user, req);
      case "list":
        return await handleList(db, user);
      case "cancel":
        return await handleCancel(db, user, req);
      case "history":
        return await handleHistory(db, user);
      default:
        return error("Invalid action", 400);
    }
  } catch (err) {
    if (err.message.includes("Authorization")) {
      return error("Unauthorized", 401);
    }
    console.error("Alerts error:", err.message, err.stack);
    return error("Server error: " + err.message, 500);
  }
}
async function handleCreate(db, user, req) {
  const body = await req.json();
  const { symbol, name, targetPrice, condition, currency } = body;
  if (!symbol || !targetPrice || !condition) {
    return error("Missing required fields: symbol, targetPrice, condition");
  }
  if (!["above", "below"].includes(condition)) {
    return error('Condition must be "above" or "below"');
  }
  const activeCount = await db.collection("alerts").countDocuments({ uid: user.uid, status: "active" });
  if (activeCount >= 10) {
    return error("Maximum of 10 active alerts reached. Cancel an existing alert to create a new one.");
  }
  const alert = {
    uid: user.uid,
    email: user.email,
    symbol: symbol.toUpperCase(),
    name: name || symbol,
    targetPrice: parseFloat(targetPrice),
    condition,
    currency: currency || "USD",
    status: "active",
    createdAt: /* @__PURE__ */ new Date(),
    updatedAt: /* @__PURE__ */ new Date(),
    lastCheckedAt: null,
    lastCheckedPrice: null
  };
  const result = await db.collection("alerts").insertOne(alert);
  return json({
    success: true,
    alert: { ...alert, _id: result.insertedId }
  });
}
async function handleList(db, user) {
  const alerts = await db.collection("alerts").find({ uid: user.uid, status: "active" }).sort({ createdAt: -1 }).toArray();
  return json({ success: true, alerts });
}
async function handleCancel(db, user, req) {
  const body = await req.json();
  const { alertId } = body;
  if (!alertId) {
    return error("Missing alertId");
  }
  const result = await db.collection("alerts").findOneAndUpdate(
    {
      _id: new ObjectId(alertId),
      uid: user.uid,
      status: "active"
    },
    {
      $set: {
        status: "cancelled",
        updatedAt: /* @__PURE__ */ new Date()
      }
    },
    { returnDocument: "after" }
  );
  if (!result) {
    return error("Alert not found or already cancelled", 404);
  }
  return json({ success: true, alert: result });
}
async function handleHistory(db, user) {
  const history = await db.collection("alert_history").find({ uid: user.uid }).sort({ triggeredAt: -1 }).limit(50).toArray();
  return json({ success: true, history });
}
export {
  handler as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvYWxlcnRzLm1qcyIsICJuZXRsaWZ5L2xpYi9tb25nb2RiLm1qcyIsICJuZXRsaWZ5L2xpYi9maXJlYmFzZS1hZG1pbi5tanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7IE9iamVjdElkIH0gZnJvbSAnbW9uZ29kYic7XG5pbXBvcnQgeyBnZXREYiB9IGZyb20gJy4uL2xpYi9tb25nb2RiLm1qcyc7XG5pbXBvcnQgeyB2ZXJpZnlUb2tlbiB9IGZyb20gJy4uL2xpYi9maXJlYmFzZS1hZG1pbi5tanMnO1xuXG5jb25zdCBDT1JTX0hFQURFUlMgPSB7XG4gICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbicsXG4gICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG59O1xuXG5mdW5jdGlvbiBqc29uKGRhdGEsIHN0YXR1cyA9IDIwMCkge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KGRhdGEpLCB7IHN0YXR1cywgaGVhZGVyczogQ09SU19IRUFERVJTIH0pO1xufVxuXG5mdW5jdGlvbiBlcnJvcihtZXNzYWdlLCBzdGF0dXMgPSA0MDApIHtcbiAgcmV0dXJuIGpzb24oeyBlcnJvcjogbWVzc2FnZSB9LCBzdGF0dXMpO1xufVxuXG5leHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBoYW5kbGVyKHJlcSkge1xuICBpZiAocmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShudWxsLCB7IHN0YXR1czogMjA0LCBoZWFkZXJzOiBDT1JTX0hFQURFUlMgfSk7XG4gIH1cblxuICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcS51cmwpO1xuICBjb25zdCBhY3Rpb24gPSB1cmwuc2VhcmNoUGFyYW1zLmdldCgnYWN0aW9uJyk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCB1c2VyID0gYXdhaXQgdmVyaWZ5VG9rZW4ocmVxKTtcbiAgICBjb25zdCBkYiA9IGF3YWl0IGdldERiKCk7XG5cbiAgICBzd2l0Y2ggKGFjdGlvbikge1xuICAgICAgY2FzZSAnY3JlYXRlJzpcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUNyZWF0ZShkYiwgdXNlciwgcmVxKTtcbiAgICAgIGNhc2UgJ2xpc3QnOlxuICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlTGlzdChkYiwgdXNlcik7XG4gICAgICBjYXNlICdjYW5jZWwnOlxuICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlQ2FuY2VsKGRiLCB1c2VyLCByZXEpO1xuICAgICAgY2FzZSAnaGlzdG9yeSc6XG4gICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVIaXN0b3J5KGRiLCB1c2VyKTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBlcnJvcignSW52YWxpZCBhY3Rpb24nLCA0MDApO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgaWYgKGVyci5tZXNzYWdlLmluY2x1ZGVzKCdBdXRob3JpemF0aW9uJykpIHtcbiAgICAgIHJldHVybiBlcnJvcignVW5hdXRob3JpemVkJywgNDAxKTtcbiAgICB9XG4gICAgY29uc29sZS5lcnJvcignQWxlcnRzIGVycm9yOicsIGVyci5tZXNzYWdlLCBlcnIuc3RhY2spO1xuICAgIHJldHVybiBlcnJvcignU2VydmVyIGVycm9yOiAnICsgZXJyLm1lc3NhZ2UsIDUwMCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQ3JlYXRlKGRiLCB1c2VyLCByZXEpIHtcbiAgY29uc3QgYm9keSA9IGF3YWl0IHJlcS5qc29uKCk7XG4gIGNvbnN0IHsgc3ltYm9sLCBuYW1lLCB0YXJnZXRQcmljZSwgY29uZGl0aW9uLCBjdXJyZW5jeSB9ID0gYm9keTtcblxuICBpZiAoIXN5bWJvbCB8fCAhdGFyZ2V0UHJpY2UgfHwgIWNvbmRpdGlvbikge1xuICAgIHJldHVybiBlcnJvcignTWlzc2luZyByZXF1aXJlZCBmaWVsZHM6IHN5bWJvbCwgdGFyZ2V0UHJpY2UsIGNvbmRpdGlvbicpO1xuICB9XG5cbiAgaWYgKCFbJ2Fib3ZlJywgJ2JlbG93J10uaW5jbHVkZXMoY29uZGl0aW9uKSkge1xuICAgIHJldHVybiBlcnJvcignQ29uZGl0aW9uIG11c3QgYmUgXCJhYm92ZVwiIG9yIFwiYmVsb3dcIicpO1xuICB9XG5cbiAgY29uc3QgYWN0aXZlQ291bnQgPSBhd2FpdCBkYlxuICAgIC5jb2xsZWN0aW9uKCdhbGVydHMnKVxuICAgIC5jb3VudERvY3VtZW50cyh7IHVpZDogdXNlci51aWQsIHN0YXR1czogJ2FjdGl2ZScgfSk7XG5cbiAgaWYgKGFjdGl2ZUNvdW50ID49IDEwKSB7XG4gICAgcmV0dXJuIGVycm9yKCdNYXhpbXVtIG9mIDEwIGFjdGl2ZSBhbGVydHMgcmVhY2hlZC4gQ2FuY2VsIGFuIGV4aXN0aW5nIGFsZXJ0IHRvIGNyZWF0ZSBhIG5ldyBvbmUuJyk7XG4gIH1cblxuICBjb25zdCBhbGVydCA9IHtcbiAgICB1aWQ6IHVzZXIudWlkLFxuICAgIGVtYWlsOiB1c2VyLmVtYWlsLFxuICAgIHN5bWJvbDogc3ltYm9sLnRvVXBwZXJDYXNlKCksXG4gICAgbmFtZTogbmFtZSB8fCBzeW1ib2wsXG4gICAgdGFyZ2V0UHJpY2U6IHBhcnNlRmxvYXQodGFyZ2V0UHJpY2UpLFxuICAgIGNvbmRpdGlvbixcbiAgICBjdXJyZW5jeTogY3VycmVuY3kgfHwgJ1VTRCcsXG4gICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCksXG4gICAgdXBkYXRlZEF0OiBuZXcgRGF0ZSgpLFxuICAgIGxhc3RDaGVja2VkQXQ6IG51bGwsXG4gICAgbGFzdENoZWNrZWRQcmljZTogbnVsbCxcbiAgfTtcblxuICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYi5jb2xsZWN0aW9uKCdhbGVydHMnKS5pbnNlcnRPbmUoYWxlcnQpO1xuXG4gIHJldHVybiBqc29uKHtcbiAgICBzdWNjZXNzOiB0cnVlLFxuICAgIGFsZXJ0OiB7IC4uLmFsZXJ0LCBfaWQ6IHJlc3VsdC5pbnNlcnRlZElkIH0sXG4gIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVMaXN0KGRiLCB1c2VyKSB7XG4gIGNvbnN0IGFsZXJ0cyA9IGF3YWl0IGRiXG4gICAgLmNvbGxlY3Rpb24oJ2FsZXJ0cycpXG4gICAgLmZpbmQoeyB1aWQ6IHVzZXIudWlkLCBzdGF0dXM6ICdhY3RpdmUnIH0pXG4gICAgLnNvcnQoeyBjcmVhdGVkQXQ6IC0xIH0pXG4gICAgLnRvQXJyYXkoKTtcblxuICByZXR1cm4ganNvbih7IHN1Y2Nlc3M6IHRydWUsIGFsZXJ0cyB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlQ2FuY2VsKGRiLCB1c2VyLCByZXEpIHtcbiAgY29uc3QgYm9keSA9IGF3YWl0IHJlcS5qc29uKCk7XG4gIGNvbnN0IHsgYWxlcnRJZCB9ID0gYm9keTtcblxuICBpZiAoIWFsZXJ0SWQpIHtcbiAgICByZXR1cm4gZXJyb3IoJ01pc3NpbmcgYWxlcnRJZCcpO1xuICB9XG5cbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGIuY29sbGVjdGlvbignYWxlcnRzJykuZmluZE9uZUFuZFVwZGF0ZShcbiAgICB7XG4gICAgICBfaWQ6IG5ldyBPYmplY3RJZChhbGVydElkKSxcbiAgICAgIHVpZDogdXNlci51aWQsXG4gICAgICBzdGF0dXM6ICdhY3RpdmUnLFxuICAgIH0sXG4gICAge1xuICAgICAgJHNldDoge1xuICAgICAgICBzdGF0dXM6ICdjYW5jZWxsZWQnLFxuICAgICAgICB1cGRhdGVkQXQ6IG5ldyBEYXRlKCksXG4gICAgICB9LFxuICAgIH0sXG4gICAgeyByZXR1cm5Eb2N1bWVudDogJ2FmdGVyJyB9XG4gICk7XG5cbiAgaWYgKCFyZXN1bHQpIHtcbiAgICByZXR1cm4gZXJyb3IoJ0FsZXJ0IG5vdCBmb3VuZCBvciBhbHJlYWR5IGNhbmNlbGxlZCcsIDQwNCk7XG4gIH1cblxuICByZXR1cm4ganNvbih7IHN1Y2Nlc3M6IHRydWUsIGFsZXJ0OiByZXN1bHQgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZUhpc3RvcnkoZGIsIHVzZXIpIHtcbiAgY29uc3QgaGlzdG9yeSA9IGF3YWl0IGRiXG4gICAgLmNvbGxlY3Rpb24oJ2FsZXJ0X2hpc3RvcnknKVxuICAgIC5maW5kKHsgdWlkOiB1c2VyLnVpZCB9KVxuICAgIC5zb3J0KHsgdHJpZ2dlcmVkQXQ6IC0xIH0pXG4gICAgLmxpbWl0KDUwKVxuICAgIC50b0FycmF5KCk7XG5cbiAgcmV0dXJuIGpzb24oeyBzdWNjZXNzOiB0cnVlLCBoaXN0b3J5IH0pO1xufVxuIiwgImltcG9ydCB7IE1vbmdvQ2xpZW50IH0gZnJvbSAnbW9uZ29kYic7XG5cbmxldCBjYWNoZWRDbGllbnQgPSBudWxsO1xubGV0IGNhY2hlZERiID0gbnVsbDtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldERiKCkge1xuICBpZiAoY2FjaGVkQ2xpZW50ICYmIGNhY2hlZERiKSB7XG4gICAgcmV0dXJuIGNhY2hlZERiO1xuICB9XG5cbiAgY29uc3QgdXJpID0gcHJvY2Vzcy5lbnYuTU9OR09EQl9VUkk7XG4gIGlmICghdXJpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdNT05HT0RCX1VSSSBlbnZpcm9ubWVudCB2YXJpYWJsZSBpcyBub3Qgc2V0Jyk7XG4gIH1cblxuICBjb25zdCBjbGllbnQgPSBuZXcgTW9uZ29DbGllbnQodXJpLCB7XG4gICAgbWF4UG9vbFNpemU6IDEsXG4gICAgc2VydmVyU2VsZWN0aW9uVGltZW91dE1TOiA1MDAwLFxuICB9KTtcblxuICBhd2FpdCBjbGllbnQuY29ubmVjdCgpO1xuXG4gIGNvbnN0IGRiTmFtZSA9IHByb2Nlc3MuZW52Lk1PTkdPREJfREJfTkFNRSB8fCAnc3RvY2tfYW5hbHl6ZXInO1xuICBjb25zdCBkYiA9IGNsaWVudC5kYihkYk5hbWUpO1xuXG4gIGNhY2hlZENsaWVudCA9IGNsaWVudDtcbiAgY2FjaGVkRGIgPSBkYjtcblxuICByZXR1cm4gZGI7XG59XG4iLCAiaW1wb3J0IGFkbWluIGZyb20gJ2ZpcmViYXNlLWFkbWluJztcblxuZnVuY3Rpb24gaW5pdEZpcmViYXNlKCkge1xuICBpZiAoYWRtaW4uYXBwcy5sZW5ndGggPiAwKSByZXR1cm47XG5cbiAgY29uc3QgcHJvamVjdElkID0gcHJvY2Vzcy5lbnYuRklSRUJBU0VfUFJPSkVDVF9JRDtcbiAgY29uc3QgY2xpZW50RW1haWwgPSBwcm9jZXNzLmVudi5GSVJFQkFTRV9DTElFTlRfRU1BSUw7XG4gIGNvbnN0IHByaXZhdGVLZXlCNjQgPSBwcm9jZXNzLmVudi5GSVJFQkFTRV9QUklWQVRFX0tFWTtcblxuICBpZiAoIXByb2plY3RJZCB8fCAhY2xpZW50RW1haWwgfHwgIXByaXZhdGVLZXlCNjQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZpcmViYXNlIGVudiB2YXJzIG1pc3Npbmc6ICcgK1xuICAgICAgKCFwcm9qZWN0SWQgPyAnRklSRUJBU0VfUFJPSkVDVF9JRCAnIDogJycpICtcbiAgICAgICghY2xpZW50RW1haWwgPyAnRklSRUJBU0VfQ0xJRU5UX0VNQUlMICcgOiAnJykgK1xuICAgICAgKCFwcml2YXRlS2V5QjY0ID8gJ0ZJUkVCQVNFX1BSSVZBVEVfS0VZICcgOiAnJykpO1xuICB9XG5cbiAgbGV0IHByaXZhdGVLZXk7XG4gIHRyeSB7XG4gICAgcHJpdmF0ZUtleSA9IEJ1ZmZlci5mcm9tKHByaXZhdGVLZXlCNjQsICdiYXNlNjQnKS50b1N0cmluZygndXRmLTgnKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIC8vIE1heWJlIGl0J3Mgbm90IGJhc2U2NCwgdHJ5IHJhd1xuICAgIHByaXZhdGVLZXkgPSBwcml2YXRlS2V5QjY0LnJlcGxhY2UoL1xcXFxuL2csICdcXG4nKTtcbiAgfVxuXG4gIGFkbWluLmluaXRpYWxpemVBcHAoe1xuICAgIGNyZWRlbnRpYWw6IGFkbWluLmNyZWRlbnRpYWwuY2VydCh7IHByb2plY3RJZCwgY2xpZW50RW1haWwsIHByaXZhdGVLZXkgfSksXG4gIH0pO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5VG9rZW4ocmVxKSB7XG4gIGluaXRGaXJlYmFzZSgpO1xuICBjb25zdCBhdXRoSGVhZGVyID0gcmVxLmhlYWRlcnMuZ2V0KCdhdXRob3JpemF0aW9uJykgfHwgJyc7XG4gIGNvbnN0IG1hdGNoID0gYXV0aEhlYWRlci5tYXRjaCgvXkJlYXJlclxccysoLispJC9pKTtcbiAgaWYgKCFtYXRjaCkgdGhyb3cgbmV3IEVycm9yKCdNaXNzaW5nIG9yIGludmFsaWQgQXV0aG9yaXphdGlvbiBoZWFkZXInKTtcblxuICBjb25zdCBkZWNvZGVkID0gYXdhaXQgYWRtaW4uYXV0aCgpLnZlcmlmeUlkVG9rZW4obWF0Y2hbMV0pO1xuICByZXR1cm4ge1xuICAgIHVpZDogZGVjb2RlZC51aWQsXG4gICAgZW1haWw6IGRlY29kZWQuZW1haWwgfHwgbnVsbCxcbiAgICBuYW1lOiBkZWNvZGVkLm5hbWUgfHwgbnVsbCxcbiAgICBwaWN0dXJlOiBkZWNvZGVkLnBpY3R1cmUgfHwgbnVsbCxcbiAgICBwaG9uZTogZGVjb2RlZC5waG9uZV9udW1iZXIgfHwgbnVsbCxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG9wdGlvbmFsVmVyaWZ5VG9rZW4ocmVxKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgYXV0aEhlYWRlciA9IHJlcS5oZWFkZXJzLmdldCgnYXV0aG9yaXphdGlvbicpIHx8ICcnO1xuICAgIGlmICghYXV0aEhlYWRlcikgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIGF3YWl0IHZlcmlmeVRva2VuKHJlcSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7O0FBQUEsU0FBUyxnQkFB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
