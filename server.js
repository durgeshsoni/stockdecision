const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

// MIME types
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png' };

// Simple cache (5 min TTL)
const cache = new Map();
function cached(key) { const e = cache.get(key); if (e && Date.now() - e.t < 300000) return e.d; cache.delete(key); return null; }
function setCache(key, data) { cache.set(key, { d: data, t: Date.now() }); }

// Fetch from Yahoo using Node's built-in fetch (handles gzip automatically)
async function yahooGet(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        redirect: 'follow',
    });
    return { status: res.status, text: await res.text() };
}

// Extract quoteSummary from Yahoo Finance page HTML
function extractQuoteSummary(html) {
    const regex = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
        const content = match[1];
        if (!content.includes('"quoteSummary"') && !content.includes('trailingPE')) continue;
        try {
            const outer = JSON.parse(content);
            const inner = typeof outer.body === 'string' ? JSON.parse(outer.body) : outer;
            if (inner.quoteSummary?.result?.[0]) return inner.quoteSummary.result[0];
        } catch { continue; }
    }
    return null;
}

const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const p = u.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');

    // --- API: /api/chart ---
    if (p === '/api/chart') {
        const symbol = u.searchParams.get('symbol');
        const range = u.searchParams.get('range') || '1y';
        const interval = u.searchParams.get('interval') || '1d';
        if (!symbol) { res.writeHead(400); res.end('{"error":"symbol required"}'); return; }

        const ck = `c:${symbol}:${range}:${interval}`;
        const cv = cached(ck);
        if (cv) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(cv); return; }

        try {
            // Try query2 first, fallback to query1
            let r = await yahooGet(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
            if (r.status === 429) {
                r = await yahooGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
            }
            if (r.status === 429) { res.writeHead(429); res.end('{"error":"Rate limit. Wait 1-2 min."}'); return; }
            setCache(ck, r.text);
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(r.text);
        } catch (e) { res.writeHead(500); res.end(JSON.stringify({error:e.message})); }
        return;
    }

    // --- API: /api/fundamentals ---
    if (p === '/api/fundamentals') {
        const symbol = u.searchParams.get('symbol');
        if (!symbol) { res.writeHead(400); res.end('{"error":"symbol required"}'); return; }

        const ck = `f:${symbol}`;
        const cv = cached(ck);
        if (cv) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(cv); return; }

        try {
            const r = await yahooGet(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`);
            const summary = extractQuoteSummary(r.text);
            const json = JSON.stringify(summary || {});
            setCache(ck, json);
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(json);
        } catch {
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end('{}');
        }
        return;
    }

    // --- API: /api/insights ---
    if (p === '/api/insights') {
        const symbol = u.searchParams.get('symbol');
        if (!symbol) { res.writeHead(400); res.end('{"error":"symbol required"}'); return; }

        const ck = `i:${symbol}`;
        const cv = cached(ck);
        if (cv) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(cv); return; }

        try {
            const r = await yahooGet(`https://query2.finance.yahoo.com/ws/insights/v2/finance/insights?symbol=${encodeURIComponent(symbol)}`);
            setCache(ck, r.text);
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end(r.text);
        } catch {
            res.writeHead(200, {'Content-Type':'application/json'});
            res.end('{}');
        }
        return;
    }

    // --- API: /api/ipo (proxy to Netlify function locally) ---
    if (p === '/api/ipo' || p === '/.netlify/functions/ipo') {
        const type = u.searchParams.get('type') || 'list';
        const name = u.searchParams.get('name') || '';
        res.setHeader('Content-Type', 'application/json');

        // For local dev, proxy to IPO data sources directly
        try {
            const ipoModule = await import('./netlify/functions/ipo.mjs');
            const mockReq = { method: 'GET', url: req.url };
            const result = await ipoModule.default(mockReq);
            res.writeHead(result.statusCode || 200);
            res.end(result.body || '{}');
        } catch (e) {
            // Fallback: return sample data for local dev
            const fallback = {
                upcoming: [
                    { companyName: 'Sample Tech IPO', priceBand: '₹300 - ₹320', gmp: '+45', openDate: 'Apr 10, 2026', closeDate: 'Apr 14, 2026', listingDate: 'Apr 17, 2026', ipoSize: '₹1,200 Cr', lotSize: '46', industry: 'Technology', category: 'upcoming' }
                ],
                ongoing: [],
                listed: [
                    { companyName: 'Sample Listed Co', priceBand: '₹150 - ₹160', gmp: '+20', openDate: 'Mar 28, 2026', closeDate: 'Apr 01, 2026', listingDate: 'Apr 04, 2026', ipoSize: '₹800 Cr', lotSize: '90', industry: 'Finance', category: 'listed' }
                ],
                total: 2, lastUpdated: new Date().toISOString(), source: 'local-fallback'
            };
            res.writeHead(200);
            res.end(JSON.stringify(fallback));
        }
        return;
    }

    // --- Static files (serve from public/) ---
    let fp = p === '/' ? '/index.html' : p;
    fp = path.join(__dirname, 'public', fp);
    try {
        const content = fs.readFileSync(fp);
        res.writeHead(200, {'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream'});
        res.end(content);
    } catch {
        res.writeHead(404); res.end('Not found');
    }
});

server.listen(PORT, () => console.log(`\n  AI Stock Analyzer Pro\n  Open: http://localhost:${PORT}\n`));
