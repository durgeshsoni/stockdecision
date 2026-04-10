// ===== StockDecision — Express Server =====
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import { MongoClient, ObjectId } from 'mongodb';
import { Resend } from 'resend';

import yahooHandler from './api/yahoo.mjs';
import ipoHandler from './api/ipo.mjs';
import authHandler from './api/auth.mjs';
import userHandler from './api/user.mjs';
import alertsHandler from './api/alerts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3012;
const app = express();

// ===== Middleware =====
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ===== API Routes =====
app.all('/api/yahoo', yahooHandler);
app.all('/api/ipo', ipoHandler);
app.all('/api/auth', authHandler);
app.all('/api/user', userHandler);
app.all('/api/alerts', alertsHandler);

// ===== Serve Frontend =====
app.use(express.static(path.join(__dirname, 'public')));
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== Cron: Check Price Alerts Every 15 Minutes =====
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

async function getAlertDb() {
    const uri = process.env.MONGODB_URI;
    if (!uri) return null;
    const client = new MongoClient(uri, { maxPoolSize: 1, serverSelectionTimeoutMS: 5000 });
    await client.connect();
    return { client, db: client.db(process.env.MONGODB_DB_NAME || 'stock_analyzer') };
}

async function fetchStockPrice(symbol) {
    try {
        const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StockAlertBot/1.0)' }
        });
        if (!r.ok) return null;
        const data = await r.json();
        return data?.chart?.result?.[0]?.meta?.regularMarketPrice || null;
    } catch { return null; }
}

function buildAlertEmail(alert, currentPrice) {
    const conditionText = alert.condition === 'above' ? 'risen above' : 'fallen below';
    const cs = alert.currency === 'INR' ? '₹' : alert.currency === 'EUR' ? '€' : '$';
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f7fa;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fa;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
<tr><td style="background:linear-gradient(135deg,#1a73e8,#0d47a1);padding:32px 40px;text-align:center;">
<h1 style="color:#fff;margin:0;font-size:24px;">Price Alert Triggered</h1></td></tr>
<tr><td style="padding:40px;">
<p style="color:#333;font-size:16px;line-height:1.6;">Your alert for <strong>${alert.name} (${alert.symbol})</strong> has been triggered. Price has ${conditionText} your target.</p>
<table width="100%" style="background:#f8f9fb;border-radius:8px;margin-bottom:24px;"><tr><td style="padding:24px;">
<p style="margin:8px 0;color:#666;font-size:14px;">Stock: <strong style="color:#333;font-size:18px;">${alert.name}</strong></p>
<p style="margin:8px 0;color:#666;font-size:14px;">Target: <strong style="color:#333;font-size:18px;">${cs}${alert.targetPrice.toFixed(2)}</strong></p>
<p style="margin:8px 0;color:#666;font-size:14px;">Current Price: <strong style="color:#1a73e8;font-size:22px;">${cs}${currentPrice.toFixed(2)}</strong></p>
<p style="margin:8px 0;color:#666;font-size:14px;">Condition: <strong>Price ${alert.condition} ${cs}${alert.targetPrice.toFixed(2)}</strong></p>
</td></tr></table>
<div style="text-align:center;margin:32px 0;">
<a href="${APP_URL}" style="background:linear-gradient(135deg,#1a73e8,#0d47a1);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">View on StockDecision</a>
</div>
<p style="color:#999;font-size:12px;text-align:center;">This is an automated alert from StockDecision. Manage your alerts in your dashboard.</p>
</td></tr></table></td></tr></table></body></html>`;
}

async function checkAlerts() {
    if (!process.env.MONGODB_URI) return;
    let client;
    try {
        const conn = await getAlertDb();
        if (!conn) return;
        client = conn.client;
        const db = conn.db;

        const activeAlerts = await db.collection('alerts').find({ status: 'active' }).toArray();
        if (activeAlerts.length === 0) return;

        // Group by symbol
        const bySymbol = new Map();
        for (const alert of activeAlerts) {
            const list = bySymbol.get(alert.symbol) || [];
            list.push(alert);
            bySymbol.set(alert.symbol, list);
        }

        const symbols = Array.from(bySymbol.keys()).slice(0, 20);

        for (const symbol of symbols) {
            const currentPrice = await fetchStockPrice(symbol);
            if (currentPrice === null) continue;

            for (const alert of bySymbol.get(symbol)) {
                const triggered = alert.condition === 'above' ? currentPrice >= alert.targetPrice : currentPrice <= alert.targetPrice;
                const now = new Date();

                if (triggered) {
                    await db.collection('alerts').updateOne({ _id: alert._id }, { $set: { status: 'triggered', triggeredAt: now, triggeredPrice: currentPrice, lastCheckedAt: now, lastCheckedPrice: currentPrice, updatedAt: now } });
                    await db.collection('alert_history').insertOne({ uid: alert.uid, alertId: alert._id, symbol: alert.symbol, name: alert.name, targetPrice: alert.targetPrice, triggeredPrice: currentPrice, condition: alert.condition, currency: alert.currency, triggeredAt: now });

                    if (alert.email && resend) {
                        try {
                            await resend.emails.send({
                                from: process.env.RESEND_FROM_EMAIL || 'alerts@stockdecision.in',
                                to: alert.email,
                                subject: `Price Alert: ${alert.name} has ${alert.condition === 'above' ? 'risen above' : 'fallen below'} your target`,
                                html: buildAlertEmail(alert, currentPrice),
                            });
                        } catch (e) { console.error('Alert email failed:', e.message); }
                    }
                } else {
                    await db.collection('alerts').updateOne({ _id: alert._id }, { $set: { lastCheckedAt: now, lastCheckedPrice: currentPrice } });
                }
            }
        }
    } catch (err) {
        console.error('Alert check error:', err.message);
    } finally {
        if (client) { try { await client.close(); } catch { } }
    }
}

// Run every 15 minutes
cron.schedule('*/15 * * * *', () => {
    console.log('[Cron] Checking price alerts...');
    checkAlerts();
});

// ===== Start Server =====
app.listen(PORT, () => {
    console.log(`\n  ✦ StockDecision Server`);
    console.log(`  Open: http://localhost:${PORT}\n`);
});
