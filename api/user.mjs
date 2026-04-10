// ===== User API Route =====
import { getDb } from '../lib/mongodb.mjs';
import { verifyToken } from '../lib/firebase-admin.mjs';

function sanitizeSymbol(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const s = raw.trim().toUpperCase().slice(0, 20);
    return /^[A-Z0-9.\-^]+$/.test(s) ? s : null;
}

function sanitizeName(raw) {
    if (!raw || typeof raw !== 'string') return null;
    return raw.trim().replace(/[<>"']/g, '').slice(0, 100) || null;
}

export default async function userHandler(req, res) {
    const { action } = req.query;

    try {
        const user = await verifyToken(req);
        const db = await getDb();

        switch (action) {
            case 'search':           return await handleSearch(db, user, req, res);
            case 'history':          return await handleHistory(db, user, res);
            case 'frequent':         return await handleFrequent(db, user, res);
            case 'watchlist':        return await handleWatchlist(db, user, res);
            case 'watchlist-add':    return await handleWatchlistAdd(db, user, req, res);
            case 'watchlist-remove': return await handleWatchlistRemove(db, user, req, res);
            case 'dashboard':        return await handleDashboard(db, user, res);
            default:                 return res.status(400).json({ error: 'Invalid action' });
        }
    } catch (err) {
        if (err.message.includes('Authorization')) return res.status(401).json({ error: 'Unauthorized' });
        console.error('User error:', err.message);
        return res.status(500).json({ error: 'Server error: ' + err.message });
    }
}

async function handleSearch(db, user, req, res) {
    const symbol = sanitizeSymbol(req.body.symbol);
    const name = sanitizeName(req.body.name) || symbol;
    if (!symbol) return res.status(400).json({ error: 'Missing or invalid field: symbol' });
    await db.collection('search_history').insertOne({ uid: user.uid, symbol, name, searchedAt: new Date() });
    return res.json({ success: true });
}

async function handleHistory(db, user, res) {
    const history = await db.collection('search_history').find({ uid: user.uid }).sort({ searchedAt: -1 }).limit(30).toArray();
    return res.json({ success: true, history });
}

async function handleFrequent(db, user, res) {
    const frequent = await db.collection('search_history').aggregate([
        { $match: { uid: user.uid } },
        { $group: { _id: '$symbol', name: { $last: '$name' }, count: { $sum: 1 }, lastSearched: { $max: '$searchedAt' } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, symbol: '$_id', name: 1, count: 1, lastSearched: 1 } },
    ]).toArray();
    return res.json({ success: true, frequent });
}

async function handleWatchlist(db, user, res) {
    const watchlist = await db.collection('watchlist').find({ uid: user.uid }).sort({ addedAt: -1 }).toArray();
    return res.json({ success: true, watchlist });
}

async function handleWatchlistAdd(db, user, req, res) {
    const symbol = sanitizeSymbol(req.body.symbol);
    const name = sanitizeName(req.body.name) || symbol;
    if (!symbol) return res.status(400).json({ error: 'Missing or invalid field: symbol' });
    const count = await db.collection('watchlist').countDocuments({ uid: user.uid });
    if (count >= 30) return res.status(400).json({ error: 'Maximum of 30 watchlist items reached.' });
    const existing = await db.collection('watchlist').findOne({ uid: user.uid, symbol });
    if (existing) return res.status(400).json({ error: 'Stock already in watchlist' });
    const item = { uid: user.uid, symbol, name, addedAt: new Date() };
    await db.collection('watchlist').insertOne(item);
    return res.json({ success: true, item });
}

async function handleWatchlistRemove(db, user, req, res) {
    const symbol = sanitizeSymbol(req.body.symbol);
    if (!symbol) return res.status(400).json({ error: 'Missing or invalid field: symbol' });
    const result = await db.collection('watchlist').deleteOne({ uid: user.uid, symbol });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Stock not found in watchlist' });
    return res.json({ success: true });
}

async function handleDashboard(db, user, res) {
    const [recentSearches, watchlist, activeAlerts, frequentStocks] = await Promise.all([
        db.collection('search_history').find({ uid: user.uid }).sort({ searchedAt: -1 }).limit(10).toArray(),
        db.collection('watchlist').find({ uid: user.uid }).sort({ addedAt: -1 }).toArray(),
        db.collection('alerts').find({ uid: user.uid, status: 'active' }).sort({ createdAt: -1 }).toArray(),
        db.collection('search_history').aggregate([
            { $match: { uid: user.uid } },
            { $group: { _id: '$symbol', name: { $last: '$name' }, count: { $sum: 1 }, lastSearched: { $max: '$searchedAt' } } },
            { $sort: { count: -1 } }, { $limit: 10 },
            { $project: { _id: 0, symbol: '$_id', name: 1, count: 1, lastSearched: 1 } },
        ]).toArray(),
    ]);
    return res.json({ success: true, dashboard: { recentSearches, watchlist, activeAlerts, frequentStocks } });
}
