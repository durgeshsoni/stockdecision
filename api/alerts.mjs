// ===== Alerts API Route =====
import { ObjectId } from 'mongodb';
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

export default async function alertsHandler(req, res) {
    const { action } = req.query;

    try {
        const user = await verifyToken(req);
        const db = await getDb();

        switch (action) {
            case 'create':  return await handleCreate(db, user, req, res);
            case 'list':    return await handleList(db, user, res);
            case 'cancel':  return await handleCancel(db, user, req, res);
            case 'history': return await handleHistory(db, user, res);
            default:        return res.status(400).json({ error: 'Invalid action' });
        }
    } catch (err) {
        if (err.message.includes('Authorization')) return res.status(401).json({ error: 'Unauthorized' });
        console.error('Alerts error:', err.message);
        return res.status(500).json({ error: 'Server error: ' + err.message });
    }
}

async function handleCreate(db, user, req, res) {
    const { targetPrice, condition, currency } = req.body;
    const symbol = sanitizeSymbol(req.body.symbol);
    const name = sanitizeName(req.body.name) || symbol;
    if (!symbol || !targetPrice || !condition) return res.status(400).json({ error: 'Missing required fields: symbol, targetPrice, condition' });
    if (!['above', 'below'].includes(condition)) return res.status(400).json({ error: 'Condition must be "above" or "below"' });
    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) return res.status(400).json({ error: 'targetPrice must be a positive number' });
    const activeCount = await db.collection('alerts').countDocuments({ uid: user.uid, status: 'active' });
    if (activeCount >= 10) return res.status(400).json({ error: 'Maximum of 10 active alerts reached.' });
    const alert = {
        uid: user.uid, email: user.email, symbol, name,
        targetPrice: price, condition, currency: currency || 'USD',
        status: 'active', createdAt: new Date(), updatedAt: new Date(),
        lastCheckedAt: null, lastCheckedPrice: null,
    };
    const result = await db.collection('alerts').insertOne(alert);
    return res.json({ success: true, alert: { ...alert, _id: result.insertedId } });
}

async function handleList(db, user, res) {
    const alerts = await db.collection('alerts').find({ uid: user.uid, status: 'active' }).sort({ createdAt: -1 }).toArray();
    return res.json({ success: true, alerts });
}

async function handleCancel(db, user, req, res) {
    const { alertId } = req.body;
    if (!alertId) return res.status(400).json({ error: 'Missing alertId' });
    const result = await db.collection('alerts').findOneAndUpdate(
        { _id: new ObjectId(alertId), uid: user.uid, status: 'active' },
        { $set: { status: 'cancelled', updatedAt: new Date() } },
        { returnDocument: 'after' }
    );
    if (!result) return res.status(404).json({ error: 'Alert not found or already cancelled' });
    return res.json({ success: true, alert: result });
}

async function handleHistory(db, user, res) {
    const history = await db.collection('alert_history').find({ uid: user.uid }).sort({ triggeredAt: -1 }).limit(50).toArray();
    return res.json({ success: true, history });
}
