import { getDb } from '../lib/mongodb.mjs';
import { verifyToken } from '../lib/firebase-admin.mjs';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    const user = await verifyToken(req);
    const db = await getDb();

    switch (action) {
      case 'login':
        return await handleLogin(db, user, req);
      case 'profile':
        return await handleProfile(db, user);
      case 'update':
        return await handleUpdate(db, user, req);
      case 'delete':
        return await handleDelete(db, user);
      default:
        return error('Invalid action', 400);
    }
  } catch (err) {
    if (err.message.includes('Authorization')) {
      return error('Unauthorized', 401);
    }
    console.error('Auth error:', err);
    return error('Internal server error', 500);
  }
}

async function handleLogin(db, user, req) {
  const now = new Date();

  const result = await db.collection('users').findOneAndUpdate(
    { uid: user.uid },
    {
      $set: {
        email: user.email,
        name: user.name,
        picture: user.picture,
        phone: user.phone,
        lastLoginAt: now,
        updatedAt: now,
      },
      $setOnInsert: {
        uid: user.uid,
        createdAt: now,
        preferences: {
          defaultMode: 'basic',
          emailAlerts: true,
        },
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  return json({ success: true, user: result });
}

async function handleProfile(db, user) {
  const profile = await db.collection('users').findOne({ uid: user.uid });

  if (!profile) {
    return error('User not found', 404);
  }

  return json({ success: true, user: profile });
}

async function handleUpdate(db, user, req) {
  const body = await req.json();
  const updates = {};

  if (body.defaultMode !== undefined) {
    updates['preferences.defaultMode'] = body.defaultMode;
  }
  if (body.emailAlerts !== undefined) {
    updates['preferences.emailAlerts'] = body.emailAlerts;
  }

  if (Object.keys(updates).length === 0) {
    return error('No valid fields to update');
  }

  updates.updatedAt = new Date();

  const result = await db.collection('users').findOneAndUpdate(
    { uid: user.uid },
    { $set: updates },
    { returnDocument: 'after' }
  );

  if (!result) {
    return error('User not found', 404);
  }

  return json({ success: true, user: result });
}

async function handleDelete(db, user) {
  const uid = user.uid;

  await Promise.all([
    db.collection('users').deleteOne({ uid }),
    db.collection('alerts').deleteMany({ uid }),
    db.collection('alert_history').deleteMany({ uid }),
    db.collection('search_history').deleteMany({ uid }),
    db.collection('watchlist').deleteMany({ uid }),
  ]);

  return json({ success: true, message: 'Account and all data deleted' });
}
