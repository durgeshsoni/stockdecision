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
      case 'search':
        return await handleSearch(db, user, req);
      case 'history':
        return await handleHistory(db, user);
      case 'frequent':
        return await handleFrequent(db, user);
      case 'watchlist':
        return await handleWatchlist(db, user);
      case 'watchlist-add':
        return await handleWatchlistAdd(db, user, req);
      case 'watchlist-remove':
        return await handleWatchlistRemove(db, user, req);
      case 'dashboard':
        return await handleDashboard(db, user);
      default:
        return error('Invalid action', 400);
    }
  } catch (err) {
    if (err.message.includes('Authorization')) {
      return error('Unauthorized', 401);
    }
    console.error('User error:', err.message, err.stack);
    return error('Server error: ' + err.message, 500);
  }
}

async function handleSearch(db, user, req) {
  const body = await req.json();
  const { symbol, name } = body;

  if (!symbol) {
    return error('Missing required field: symbol');
  }

  await db.collection('search_history').insertOne({
    uid: user.uid,
    symbol: symbol.toUpperCase(),
    name: name || symbol,
    searchedAt: new Date(),
  });

  return json({ success: true });
}

async function handleHistory(db, user) {
  const history = await db
    .collection('search_history')
    .find({ uid: user.uid })
    .sort({ searchedAt: -1 })
    .limit(30)
    .toArray();

  return json({ success: true, history });
}

async function handleFrequent(db, user) {
  const frequent = await db
    .collection('search_history')
    .aggregate([
      { $match: { uid: user.uid } },
      {
        $group: {
          _id: '$symbol',
          name: { $last: '$name' },
          count: { $sum: 1 },
          lastSearched: { $max: '$searchedAt' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
      {
        $project: {
          _id: 0,
          symbol: '$_id',
          name: 1,
          count: 1,
          lastSearched: 1,
        },
      },
    ])
    .toArray();

  return json({ success: true, frequent });
}

async function handleWatchlist(db, user) {
  const watchlist = await db
    .collection('watchlist')
    .find({ uid: user.uid })
    .sort({ addedAt: -1 })
    .toArray();

  return json({ success: true, watchlist });
}

async function handleWatchlistAdd(db, user, req) {
  const body = await req.json();
  const { symbol, name } = body;

  if (!symbol) {
    return error('Missing required field: symbol');
  }

  const upperSymbol = symbol.toUpperCase();

  const count = await db
    .collection('watchlist')
    .countDocuments({ uid: user.uid });

  if (count >= 30) {
    return error('Maximum of 30 watchlist items reached. Remove an item to add a new one.');
  }

  const existing = await db
    .collection('watchlist')
    .findOne({ uid: user.uid, symbol: upperSymbol });

  if (existing) {
    return error('Stock already in watchlist');
  }

  const item = {
    uid: user.uid,
    symbol: upperSymbol,
    name: name || symbol,
    addedAt: new Date(),
  };

  await db.collection('watchlist').insertOne(item);

  return json({ success: true, item });
}

async function handleWatchlistRemove(db, user, req) {
  const body = await req.json();
  const { symbol } = body;

  if (!symbol) {
    return error('Missing required field: symbol');
  }

  const result = await db.collection('watchlist').deleteOne({
    uid: user.uid,
    symbol: symbol.toUpperCase(),
  });

  if (result.deletedCount === 0) {
    return error('Stock not found in watchlist', 404);
  }

  return json({ success: true });
}

async function handleDashboard(db, user) {
  const [recentSearches, watchlist, activeAlerts, frequentStocks] =
    await Promise.all([
      db
        .collection('search_history')
        .find({ uid: user.uid })
        .sort({ searchedAt: -1 })
        .limit(10)
        .toArray(),

      db
        .collection('watchlist')
        .find({ uid: user.uid })
        .sort({ addedAt: -1 })
        .toArray(),

      db
        .collection('alerts')
        .find({ uid: user.uid, status: 'active' })
        .sort({ createdAt: -1 })
        .toArray(),

      db
        .collection('search_history')
        .aggregate([
          { $match: { uid: user.uid } },
          {
            $group: {
              _id: '$symbol',
              name: { $last: '$name' },
              count: { $sum: 1 },
              lastSearched: { $max: '$searchedAt' },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
          {
            $project: {
              _id: 0,
              symbol: '$_id',
              name: 1,
              count: 1,
              lastSearched: 1,
            },
          },
        ])
        .toArray(),
    ]);

  return json({
    success: true,
    dashboard: {
      recentSearches,
      watchlist,
      activeAlerts,
      frequentStocks,
    },
  });
}
