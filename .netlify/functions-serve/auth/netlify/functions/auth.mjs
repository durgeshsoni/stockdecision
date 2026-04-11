
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


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

// netlify/functions/auth.mjs
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
      case "login":
        return await handleLogin(db, user, req);
      case "profile":
        return await handleProfile(db, user);
      case "update":
        return await handleUpdate(db, user, req);
      case "delete":
        return await handleDelete(db, user);
      default:
        return error("Invalid action", 400);
    }
  } catch (err) {
    if (err.message.includes("Authorization")) {
      return error("Unauthorized", 401);
    }
    console.error("Auth error:", err);
    return error("Internal server error", 500);
  }
}
async function handleLogin(db, user, req) {
  const now = /* @__PURE__ */ new Date();
  const result = await db.collection("users").findOneAndUpdate(
    { uid: user.uid },
    {
      $set: {
        email: user.email,
        name: user.name,
        picture: user.picture,
        phone: user.phone,
        lastLoginAt: now,
        updatedAt: now
      },
      $setOnInsert: {
        uid: user.uid,
        createdAt: now,
        preferences: {
          defaultMode: "basic",
          emailAlerts: true
        }
      }
    },
    { upsert: true, returnDocument: "after" }
  );
  return json({ success: true, user: result });
}
async function handleProfile(db, user) {
  const profile = await db.collection("users").findOne({ uid: user.uid });
  if (!profile) {
    return error("User not found", 404);
  }
  return json({ success: true, user: profile });
}
async function handleUpdate(db, user, req) {
  const body = await req.json();
  const updates = {};
  if (body.defaultMode !== void 0) {
    updates["preferences.defaultMode"] = body.defaultMode;
  }
  if (body.emailAlerts !== void 0) {
    updates["preferences.emailAlerts"] = body.emailAlerts;
  }
  if (Object.keys(updates).length === 0) {
    return error("No valid fields to update");
  }
  updates.updatedAt = /* @__PURE__ */ new Date();
  const result = await db.collection("users").findOneAndUpdate(
    { uid: user.uid },
    { $set: updates },
    { returnDocument: "after" }
  );
  if (!result) {
    return error("User not found", 404);
  }
  return json({ success: true, user: result });
}
async function handleDelete(db, user) {
  const uid = user.uid;
  await Promise.all([
    db.collection("users").deleteOne({ uid }),
    db.collection("alerts").deleteMany({ uid }),
    db.collection("alert_history").deleteMany({ uid }),
    db.collection("search_history").deleteMany({ uid }),
    db.collection("watchlist").deleteMany({ uid })
  ]);
  return json({ success: true, message: "Account and all data deleted" });
}
export {
  handler as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9saWIvbW9uZ29kYi5tanMiLCAibmV0bGlmeS9saWIvZmlyZWJhc2UtYWRtaW4ubWpzIiwgIm5ldGxpZnkvZnVuY3Rpb25zL2F1dGgubWpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgeyBNb25nb0NsaWVudCB9IGZyb20gJ21vbmdvZGInO1xuXG5sZXQgY2FjaGVkQ2xpZW50ID0gbnVsbDtcbmxldCBjYWNoZWREYiA9IG51bGw7XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXREYigpIHtcbiAgaWYgKGNhY2hlZENsaWVudCAmJiBjYWNoZWREYikge1xuICAgIHJldHVybiBjYWNoZWREYjtcbiAgfVxuXG4gIGNvbnN0IHVyaSA9IHByb2Nlc3MuZW52Lk1PTkdPREJfVVJJO1xuICBpZiAoIXVyaSkge1xuICAgIHRocm93IG5ldyBFcnJvcignTU9OR09EQl9VUkkgZW52aXJvbm1lbnQgdmFyaWFibGUgaXMgbm90IHNldCcpO1xuICB9XG5cbiAgY29uc3QgY2xpZW50ID0gbmV3IE1vbmdvQ2xpZW50KHVyaSwge1xuICAgIG1heFBvb2xTaXplOiAxLFxuICAgIHNlcnZlclNlbGVjdGlvblRpbWVvdXRNUzogNTAwMCxcbiAgfSk7XG5cbiAgYXdhaXQgY2xpZW50LmNvbm5lY3QoKTtcblxuICBjb25zdCBkYk5hbWUgPSBwcm9jZXNzLmVudi5NT05HT0RCX0RCX05BTUUgfHwgJ3N0b2NrX2FuYWx5emVyJztcbiAgY29uc3QgZGIgPSBjbGllbnQuZGIoZGJOYW1lKTtcblxuICBjYWNoZWRDbGllbnQgPSBjbGllbnQ7XG4gIGNhY2hlZERiID0gZGI7XG5cbiAgcmV0dXJuIGRiO1xufVxuIiwgImltcG9ydCBhZG1pbiBmcm9tICdmaXJlYmFzZS1hZG1pbic7XG5cbmZ1bmN0aW9uIGluaXRGaXJlYmFzZSgpIHtcbiAgaWYgKGFkbWluLmFwcHMubGVuZ3RoID4gMCkgcmV0dXJuO1xuXG4gIGNvbnN0IHByb2plY3RJZCA9IHByb2Nlc3MuZW52LkZJUkVCQVNFX1BST0pFQ1RfSUQ7XG4gIGNvbnN0IGNsaWVudEVtYWlsID0gcHJvY2Vzcy5lbnYuRklSRUJBU0VfQ0xJRU5UX0VNQUlMO1xuICBjb25zdCBwcml2YXRlS2V5QjY0ID0gcHJvY2Vzcy5lbnYuRklSRUJBU0VfUFJJVkFURV9LRVk7XG5cbiAgaWYgKCFwcm9qZWN0SWQgfHwgIWNsaWVudEVtYWlsIHx8ICFwcml2YXRlS2V5QjY0KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdGaXJlYmFzZSBlbnYgdmFycyBtaXNzaW5nOiAnICtcbiAgICAgICghcHJvamVjdElkID8gJ0ZJUkVCQVNFX1BST0pFQ1RfSUQgJyA6ICcnKSArXG4gICAgICAoIWNsaWVudEVtYWlsID8gJ0ZJUkVCQVNFX0NMSUVOVF9FTUFJTCAnIDogJycpICtcbiAgICAgICghcHJpdmF0ZUtleUI2NCA/ICdGSVJFQkFTRV9QUklWQVRFX0tFWSAnIDogJycpKTtcbiAgfVxuXG4gIGxldCBwcml2YXRlS2V5O1xuICB0cnkge1xuICAgIHByaXZhdGVLZXkgPSBCdWZmZXIuZnJvbShwcml2YXRlS2V5QjY0LCAnYmFzZTY0JykudG9TdHJpbmcoJ3V0Zi04Jyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICAvLyBNYXliZSBpdCdzIG5vdCBiYXNlNjQsIHRyeSByYXdcbiAgICBwcml2YXRlS2V5ID0gcHJpdmF0ZUtleUI2NC5yZXBsYWNlKC9cXFxcbi9nLCAnXFxuJyk7XG4gIH1cblxuICBhZG1pbi5pbml0aWFsaXplQXBwKHtcbiAgICBjcmVkZW50aWFsOiBhZG1pbi5jcmVkZW50aWFsLmNlcnQoeyBwcm9qZWN0SWQsIGNsaWVudEVtYWlsLCBwcml2YXRlS2V5IH0pLFxuICB9KTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeVRva2VuKHJlcSkge1xuICBpbml0RmlyZWJhc2UoKTtcbiAgY29uc3QgYXV0aEhlYWRlciA9IHJlcS5oZWFkZXJzLmdldCgnYXV0aG9yaXphdGlvbicpIHx8ICcnO1xuICBjb25zdCBtYXRjaCA9IGF1dGhIZWFkZXIubWF0Y2goL15CZWFyZXJcXHMrKC4rKSQvaSk7XG4gIGlmICghbWF0Y2gpIHRocm93IG5ldyBFcnJvcignTWlzc2luZyBvciBpbnZhbGlkIEF1dGhvcml6YXRpb24gaGVhZGVyJyk7XG5cbiAgY29uc3QgZGVjb2RlZCA9IGF3YWl0IGFkbWluLmF1dGgoKS52ZXJpZnlJZFRva2VuKG1hdGNoWzFdKTtcbiAgcmV0dXJuIHtcbiAgICB1aWQ6IGRlY29kZWQudWlkLFxuICAgIGVtYWlsOiBkZWNvZGVkLmVtYWlsIHx8IG51bGwsXG4gICAgbmFtZTogZGVjb2RlZC5uYW1lIHx8IG51bGwsXG4gICAgcGljdHVyZTogZGVjb2RlZC5waWN0dXJlIHx8IG51bGwsXG4gICAgcGhvbmU6IGRlY29kZWQucGhvbmVfbnVtYmVyIHx8IG51bGwsXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBvcHRpb25hbFZlcmlmeVRva2VuKHJlcSkge1xuICB0cnkge1xuICAgIGNvbnN0IGF1dGhIZWFkZXIgPSByZXEuaGVhZGVycy5nZXQoJ2F1dGhvcml6YXRpb24nKSB8fCAnJztcbiAgICBpZiAoIWF1dGhIZWFkZXIpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBhd2FpdCB2ZXJpZnlUb2tlbihyZXEpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuIiwgImltcG9ydCB7IGdldERiIH0gZnJvbSAnLi4vbGliL21vbmdvZGIubWpzJztcbmltcG9ydCB7IHZlcmlmeVRva2VuIH0gZnJvbSAnLi4vbGliL2ZpcmViYXNlLWFkbWluLm1qcyc7XG5cbmNvbnN0IENPUlNfSEVBREVSUyA9IHtcbiAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uJyxcbiAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbn07XG5cbmZ1bmN0aW9uIGpzb24oZGF0YSwgc3RhdHVzID0gMjAwKSB7XG4gIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoZGF0YSksIHsgc3RhdHVzLCBoZWFkZXJzOiBDT1JTX0hFQURFUlMgfSk7XG59XG5cbmZ1bmN0aW9uIGVycm9yKG1lc3NhZ2UsIHN0YXR1cyA9IDQwMCkge1xuICByZXR1cm4ganNvbih7IGVycm9yOiBtZXNzYWdlIH0sIHN0YXR1cyk7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZXIocmVxKSB7XG4gIGlmIChyZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKG51bGwsIHsgc3RhdHVzOiAyMDQsIGhlYWRlcnM6IENPUlNfSEVBREVSUyB9KTtcbiAgfVxuXG4gIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxLnVybCk7XG4gIGNvbnN0IGFjdGlvbiA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KCdhY3Rpb24nKTtcblxuICB0cnkge1xuICAgIGNvbnN0IHVzZXIgPSBhd2FpdCB2ZXJpZnlUb2tlbihyZXEpO1xuICAgIGNvbnN0IGRiID0gYXdhaXQgZ2V0RGIoKTtcblxuICAgIHN3aXRjaCAoYWN0aW9uKSB7XG4gICAgICBjYXNlICdsb2dpbic6XG4gICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVMb2dpbihkYiwgdXNlciwgcmVxKTtcbiAgICAgIGNhc2UgJ3Byb2ZpbGUnOlxuICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlUHJvZmlsZShkYiwgdXNlcik7XG4gICAgICBjYXNlICd1cGRhdGUnOlxuICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlVXBkYXRlKGRiLCB1c2VyLCByZXEpO1xuICAgICAgY2FzZSAnZGVsZXRlJzpcbiAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZURlbGV0ZShkYiwgdXNlcik7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gZXJyb3IoJ0ludmFsaWQgYWN0aW9uJywgNDAwKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGlmIChlcnIubWVzc2FnZS5pbmNsdWRlcygnQXV0aG9yaXphdGlvbicpKSB7XG4gICAgICByZXR1cm4gZXJyb3IoJ1VuYXV0aG9yaXplZCcsIDQwMSk7XG4gICAgfVxuICAgIGNvbnNvbGUuZXJyb3IoJ0F1dGggZXJyb3I6JywgZXJyKTtcbiAgICByZXR1cm4gZXJyb3IoJ0ludGVybmFsIHNlcnZlciBlcnJvcicsIDUwMCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlTG9naW4oZGIsIHVzZXIsIHJlcSkge1xuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuXG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiLmNvbGxlY3Rpb24oJ3VzZXJzJykuZmluZE9uZUFuZFVwZGF0ZShcbiAgICB7IHVpZDogdXNlci51aWQgfSxcbiAgICB7XG4gICAgICAkc2V0OiB7XG4gICAgICAgIGVtYWlsOiB1c2VyLmVtYWlsLFxuICAgICAgICBuYW1lOiB1c2VyLm5hbWUsXG4gICAgICAgIHBpY3R1cmU6IHVzZXIucGljdHVyZSxcbiAgICAgICAgcGhvbmU6IHVzZXIucGhvbmUsXG4gICAgICAgIGxhc3RMb2dpbkF0OiBub3csXG4gICAgICAgIHVwZGF0ZWRBdDogbm93LFxuICAgICAgfSxcbiAgICAgICRzZXRPbkluc2VydDoge1xuICAgICAgICB1aWQ6IHVzZXIudWlkLFxuICAgICAgICBjcmVhdGVkQXQ6IG5vdyxcbiAgICAgICAgcHJlZmVyZW5jZXM6IHtcbiAgICAgICAgICBkZWZhdWx0TW9kZTogJ2Jhc2ljJyxcbiAgICAgICAgICBlbWFpbEFsZXJ0czogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgICB7IHVwc2VydDogdHJ1ZSwgcmV0dXJuRG9jdW1lbnQ6ICdhZnRlcicgfVxuICApO1xuXG4gIHJldHVybiBqc29uKHsgc3VjY2VzczogdHJ1ZSwgdXNlcjogcmVzdWx0IH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVQcm9maWxlKGRiLCB1c2VyKSB7XG4gIGNvbnN0IHByb2ZpbGUgPSBhd2FpdCBkYi5jb2xsZWN0aW9uKCd1c2VycycpLmZpbmRPbmUoeyB1aWQ6IHVzZXIudWlkIH0pO1xuXG4gIGlmICghcHJvZmlsZSkge1xuICAgIHJldHVybiBlcnJvcignVXNlciBub3QgZm91bmQnLCA0MDQpO1xuICB9XG5cbiAgcmV0dXJuIGpzb24oeyBzdWNjZXNzOiB0cnVlLCB1c2VyOiBwcm9maWxlIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVVcGRhdGUoZGIsIHVzZXIsIHJlcSkge1xuICBjb25zdCBib2R5ID0gYXdhaXQgcmVxLmpzb24oKTtcbiAgY29uc3QgdXBkYXRlcyA9IHt9O1xuXG4gIGlmIChib2R5LmRlZmF1bHRNb2RlICE9PSB1bmRlZmluZWQpIHtcbiAgICB1cGRhdGVzWydwcmVmZXJlbmNlcy5kZWZhdWx0TW9kZSddID0gYm9keS5kZWZhdWx0TW9kZTtcbiAgfVxuICBpZiAoYm9keS5lbWFpbEFsZXJ0cyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgdXBkYXRlc1sncHJlZmVyZW5jZXMuZW1haWxBbGVydHMnXSA9IGJvZHkuZW1haWxBbGVydHM7XG4gIH1cblxuICBpZiAoT2JqZWN0LmtleXModXBkYXRlcykubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIGVycm9yKCdObyB2YWxpZCBmaWVsZHMgdG8gdXBkYXRlJyk7XG4gIH1cblxuICB1cGRhdGVzLnVwZGF0ZWRBdCA9IG5ldyBEYXRlKCk7XG5cbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGIuY29sbGVjdGlvbigndXNlcnMnKS5maW5kT25lQW5kVXBkYXRlKFxuICAgIHsgdWlkOiB1c2VyLnVpZCB9LFxuICAgIHsgJHNldDogdXBkYXRlcyB9LFxuICAgIHsgcmV0dXJuRG9jdW1lbnQ6ICdhZnRlcicgfVxuICApO1xuXG4gIGlmICghcmVzdWx0KSB7XG4gICAgcmV0dXJuIGVycm9yKCdVc2VyIG5vdCBmb3VuZCcsIDQwNCk7XG4gIH1cblxuICByZXR1cm4ganNvbih7IHN1Y2Nlc3M6IHRydWUsIHVzZXI6IHJlc3VsdCB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlRGVsZXRlKGRiLCB1c2VyKSB7XG4gIGNvbnN0IHVpZCA9IHVzZXIudWlkO1xuXG4gIGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICBkYi5jb2xsZWN0aW9uKCd1c2VycycpLmRlbGV0ZU9uZSh7IHVpZCB9KSxcbiAgICBkYi5jb2xsZWN0aW9uKCdhbGVydHMnKS5kZWxldGVNYW55KHsgdWlkIH0pLFxuICAgIGRiLmNvbGxlY3Rpb24oJ2FsZXJ0X2hpc3RvcnknKS5kZWxldGVNYW55KHsgdWlkIH0pLFxuICAgIGRiLmNvbGxlY3Rpb24oJ3NlYXJjaF9oaXN0b3J5JykuZGVsZXRlTWFueSh7IHVpZCB9KSxcbiAgICBkYi5jb2xsZWN0aW9uKCd3YXRjaGxpc3QnKS5kZWxldGVNYW55KHsgdWlkIH0pLFxuICBdKTtcblxuICByZXR1cm4ganNvbih7IHN1Y2Nlc3M6IHRydWUsIG1lc3NhZ2U6ICdBY2NvdW50IGFuZCBhbGwgZGF0YSBkZWxldGVkJyB9KTtcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7QUFBQSxTQUFTLG1CQUFtQjtBQUU1QixJQUFJLGVBQWU7QUFDbkIsSUFBSSxXQUFXO0FBRWYsZUFBc0IsUUFBUTtBQUM1QixNQUFJLGdCQUFnQixVQUFVO0FBQzVCLFdBQU87QUFBQSxFQUNUO0FBRUEsUUFBTSxNQUFNLFFBQVEsSUFBSTtBQUN4QixNQUFJLENBQUMsS0FBSztBQUNSLFVBQU0sSUFBSSxNQUFNLDZDQUE2QztBQUFBLEVBQy9EO0FBRUEsUUFBTSxTQUFTLElBQUksWUFBWSxLQUFLO0FBQUEsSUFDbEMsYUFBYTtBQUFBLElBQ2IsMEJBQTBCO0FBQUEsRUFDNUIsQ0FBQztBQUVELFFBQU0sT0FBTyxRQUFRO0FBRXJCLFFBQU0s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
