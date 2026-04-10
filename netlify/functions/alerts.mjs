import { ObjectId } from 'mongodb';
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
      case 'create':
        return await handleCreate(db, user, req);
      case 'list':
        return await handleList(db, user);
      case 'cancel':
        return await handleCancel(db, user, req);
      case 'history':
        return await handleHistory(db, user);
      default:
        return error('Invalid action', 400);
    }
  } catch (err) {
    if (err.message.includes('Authorization')) {
      return error('Unauthorized', 401);
    }
    console.error('Alerts error:', err.message, err.stack);
    return error('Server error: ' + err.message, 500);
  }
}

async function handleCreate(db, user, req) {
  const body = await req.json();
  const { symbol, name, targetPrice, condition, currency } = body;

  if (!symbol || !targetPrice || !condition) {
    return error('Missing required fields: symbol, targetPrice, condition');
  }

  if (!['above', 'below'].includes(condition)) {
    return error('Condition must be "above" or "below"');
  }

  const activeCount = await db
    .collection('alerts')
    .countDocuments({ uid: user.uid, status: 'active' });

  if (activeCount >= 10) {
    return error('Maximum of 10 active alerts reached. Cancel an existing alert to create a new one.');
  }

  const alert = {
    uid: user.uid,
    email: user.email,
    symbol: symbol.toUpperCase(),
    name: name || symbol,
    targetPrice: parseFloat(targetPrice),
    condition,
    currency: currency || 'USD',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastCheckedAt: null,
    lastCheckedPrice: null,
  };

  const result = await db.collection('alerts').insertOne(alert);

  return json({
    success: true,
    alert: { ...alert, _id: result.insertedId },
  });
}

async function handleList(db, user) {
  const alerts = await db
    .collection('alerts')
    .find({ uid: user.uid, status: 'active' })
    .sort({ createdAt: -1 })
    .toArray();

  return json({ success: true, alerts });
}

async function handleCancel(db, user, req) {
  const body = await req.json();
  const { alertId } = body;

  if (!alertId) {
    return error('Missing alertId');
  }

  const result = await db.collection('alerts').findOneAndUpdate(
    {
      _id: new ObjectId(alertId),
      uid: user.uid,
      status: 'active',
    },
    {
      $set: {
        status: 'cancelled',
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!result) {
    return error('Alert not found or already cancelled', 404);
  }

  return json({ success: true, alert: result });
}

async function handleHistory(db, user) {
  const history = await db
    .collection('alert_history')
    .find({ uid: user.uid })
    .sort({ triggeredAt: -1 })
    .limit(50)
    .toArray();

  return json({ success: true, history });
}
