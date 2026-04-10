// ===== Auth API Route =====
import { getDb } from '../lib/mongodb.mjs';
import { verifyToken } from '../lib/firebase-admin.mjs';

export default async function authHandler(req, res) {
    const { action } = req.query;

    try {
        const user = await verifyToken(req);
        const db = await getDb();

        switch (action) {
            case 'login':   return await handleLogin(db, user, req, res);
            case 'profile': return await handleProfile(db, user, res);
            case 'update':  return await handleUpdate(db, user, req, res);
            case 'delete':  return await handleDelete(db, user, res);
            default:        return res.status(400).json({ error: 'Invalid action' });
        }
    } catch (err) {
        if (err.message.includes('Authorization')) return res.status(401).json({ error: 'Unauthorized' });
        console.error('Auth error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

async function handleLogin(db, user, req, res) {
    const now = new Date();
    const result = await db.collection('users').findOneAndUpdate(
        { uid: user.uid },
        {
            $set: { email: user.email, name: user.name, picture: user.picture, phone: user.phone, lastLoginAt: now, updatedAt: now },
            $setOnInsert: { uid: user.uid, createdAt: now, preferences: { defaultMode: 'basic', emailAlerts: true } },
        },
        { upsert: true, returnDocument: 'after' }
    );
    return res.json({ success: true, user: result });
}

async function handleProfile(db, user, res) {
    const profile = await db.collection('users').findOne({ uid: user.uid });
    if (!profile) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, user: profile });
}

async function handleUpdate(db, user, req, res) {
    const body = req.body;
    const updates = {};
    if (body.defaultMode !== undefined) updates['preferences.defaultMode'] = body.defaultMode;
    if (body.emailAlerts !== undefined) updates['preferences.emailAlerts'] = body.emailAlerts;
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
    updates.updatedAt = new Date();
    const result = await db.collection('users').findOneAndUpdate({ uid: user.uid }, { $set: updates }, { returnDocument: 'after' });
    if (!result) return res.status(404).json({ error: 'User not found' });
    return res.json({ success: true, user: result });
}

async function handleDelete(db, user, res) {
    const uid = user.uid;
    await Promise.all([
        db.collection('users').deleteOne({ uid }),
        db.collection('alerts').deleteMany({ uid }),
        db.collection('alert_history').deleteMany({ uid }),
        db.collection('search_history').deleteMany({ uid }),
        db.collection('watchlist').deleteMany({ uid }),
    ]);
    return res.json({ success: true, message: 'Account and all data deleted' });
}
