// ===== IPO Analyzer API Route =====
import { getDb } from '../lib/mongodb.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ===== Process-level L1 cache (faster than MongoDB, survives DB outages) =====
const memCache = new Map(); // key → { data, cachedAt }

function memCacheGet(key, ttlMs) {
    const entry = memCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > ttlMs) { memCache.delete(key); return null; }
    return entry.data;
}

function memCacheSet(key, data) {
    memCache.set(key, { data, cachedAt: Date.now() });
}

// ===== Fetch helper with timeout + retry =====
async function fetchWithRetry(url, options = {}, retries = 2, timeoutMs = 10000) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
            if (!res.ok && attempt < retries) {
                await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
                continue;
            }
            return res;
        } catch (e) {
            if (attempt === retries) throw e;
            await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
    }
}

// ===== Zerodha IPO Scraper (Primary Source) =====
async function fetchIPOFromZerodha() {
    const r = await fetchWithRetry('https://zerodha.com/ipo/', { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('Zerodha fetch failed: ' + r.status);
    const html = await r.text();

    const live = parseZerodhaTable(html, 'live-ipo-table', 'ongoing');
    const upcoming = parseZerodhaTable(html, 'upcoming-ipo-table', 'upcoming');
    const closed = parseZerodhaTable(html, 'closed-ipo-table', 'listed');
    return { live, upcoming, closed };
}

function parseZerodhaTable(html, tableId, category) {
    const start = html.indexOf('id="' + tableId + '"');
    if (start < 0) return [];
    const tbodyEnd = html.indexOf('</tbody>', start);
    const section = html.substring(start, tbodyEnd + 8);

    const rows = section.match(/<tr>[\s\S]*?<\/tr>/gi) || [];
    return rows.map(row => {
        const getText = s => s
            ? s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&ndash;/g, '–')
               .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
            : '';

        const symbolMatch  = row.match(/class="ipo-symbol">([\s\S]*?)<span/);
        const nameMatch    = row.match(/class="ipo-name[^"]*">([\s\S]*?)<\/span>/);
        const typeMatch    = row.match(/class="ipo-type">([\s\S]*?)<\/span>/);
        const hrefMatch    = row.match(/href="(\/ipo\/[^"]+)"/);
        const imgMatch     = row.match(/src="(https:\/\/zerodha\.com[^"]+)"/);
        const dateCells    = row.match(/<td class="date">([\s\S]*?)<\/td>/gi) || [];
        const hiddenDate   = row.match(/<span class="hidden">([^<]+)<\/span>/);
        const priceMatch   = row.match(/class="text-right">([\s\S]*?)<\/td>/i);

        const symbol       = getText(symbolMatch ? symbolMatch[1] : '');
        const companyName  = getText(nameMatch   ? nameMatch[1]   : '');
        const ipoType      = getText(typeMatch   ? typeMatch[1]   : 'Mainboard');
        const ipoDateRange = getText((dateCells[0] || '').replace(/<span[^>]*class="hidden"[^>]*>[^<]*<\/span>/gi, '')).trim();
        const listingDate  = hiddenDate ? hiddenDate[1] : getText(dateCells[1] || '');
        const priceRaw     = getText(priceMatch  ? priceMatch[1]  : '').replace(/₹/g, '').replace(/–/g, '-');
        const priceBand    = (priceRaw.match(/[\d,.]+\s*-\s*[\d,.]+/) || [priceRaw.trim()])[0].trim();
        const listingGainMatch = priceRaw.match(/Listing gain\s*([-\d.]+%)/i);
        const listingGain  = listingGainMatch ? listingGainMatch[1] : '';
        const logoUrl      = imgMatch  ? imgMatch[1]  : '';
        const detailPath   = hrefMatch ? hrefMatch[1] : '';

        // Parse open / close dates (handles both same-month and cross-month)
        const { openDate, closeDate } = parseDateRange(ipoDateRange);

        if (!companyName) return null;
        return { symbol, companyName, ipoType, priceBand, listingGain, openDate, closeDate, listingDate, ipoDateRange, logoUrl, detailPath, category, source: 'zerodha', gmp: '', ipoSize: '', lotSize: '' };
    }).filter(Boolean);
}

function parseDateRange(rangeStr) {
    if (!rangeStr || rangeStr === 'To be announced' || rangeStr === '–') return { openDate: '', closeDate: '' };

    // e.g. "09th – 13th Apr 2026" (same month)
    const sameMonth = rangeStr.match(/(\d+)\w*\s*[–-]\s*(\d+)\w*\s+(\w+)\s+(\d{4})/);
    if (sameMonth) {
        const [, d1, d2, month, year] = sameMonth;
        return { openDate: `${d1} ${month} ${year}`, closeDate: `${d2} ${month} ${year}` };
    }

    // e.g. "27th Mar 2026 – 08th Apr 2026" (cross-month)
    const crossMonth = rangeStr.match(/(\d+)\w*\s+(\w+)\s+(\d{4})\s*[–-]\s*(\d+)\w*\s+(\w+)\s+(\d{4})/);
    if (crossMonth) {
        const [, d1, m1, y1, d2, m2, y2] = crossMonth;
        return { openDate: `${d1} ${m1} ${y1}`, closeDate: `${d2} ${m2} ${y2}` };
    }

    return { openDate: '', closeDate: '' };
}

// ===== NSE Subscription Data =====
async function fetchNSESubscription() {
    try {
        const r = await fetchWithRetry('https://www.nseindia.com/api/ipo-current-issue', {
            headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.nseindia.com/' }
        }, 1, 8000);
        if (!r.ok) return [];
        const data = await r.json();
        return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
}

// ===== News & Sentiment =====
async function fetchIPONews(companyName) {
    const articles = [];
    try {
        const r = await fetchWithRetry(`https://news.google.com/rss/search?q=${encodeURIComponent(companyName + ' IPO')}&hl=en-IN&gl=IN&ceid=IN:en`, { headers: { 'User-Agent': UA } }, 1, 8000);
        if (r.ok) {
            const xml = await r.text();
            for (const item of (xml.match(/<item>([\s\S]*?)<\/item>/gi) || []).slice(0, 10)) {
                const title  = ((item.match(/<title>([\s\S]*?)<\/title>/i)   || [])[1] || '').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '');
                const link   = ((item.match(/<link>([\s\S]*?)<\/link>/i)     || [])[1] || '').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
                const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
                const source = ((item.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1] || '').replace(/<[^>]+>/g, '');
                articles.push({ title, link, date: pubDate, source, sentiment: analyzeSentiment(title) });
            }
        }
    } catch (e) { /* ignore */ }
    return articles;
}

function analyzeSentiment(text) {
    const lower = text.toLowerCase();
    const bullish = ['subscribe','strong','buy','positive','oversubscribed','demand','premium','listing gain','gmp','surge','rally','bullish','robust','blockbuster','record','bumper','recommend','attractive'];
    const bearish = ['avoid','risk','overpriced','expensive','caution','weak','loss','decline','crash','negative','sell','bearish','poor','flop','below','discount','debt','warning','fraud'];
    let score = 0;
    for (const w of bullish) if (lower.includes(w)) score++;
    for (const w of bearish) if (lower.includes(w)) score--;
    return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}

function computeNewsSentiment(articles) {
    if (!articles || !articles.length) return { score: 50, label: 'neutral', positive: 0, negative: 0, neutral: 0 };
    let positive = 0, negative = 0, neutral = 0;
    for (const a of articles) {
        if (a.sentiment === 'positive') positive++;
        else if (a.sentiment === 'negative') negative++;
        else neutral++;
    }
    const total = articles.length;
    const s = Math.round((positive / total) * 100 + (neutral / total) * 50);
    return { score: Math.min(100, s), label: s >= 65 ? 'positive' : s >= 40 ? 'neutral' : 'negative', positive, negative, neutral, total };
}

// ===== Yahoo Finance Enrichment =====
async function fetchYahooData(companyName) {
    try {
        const searchResp = await fetchWithRetry(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(companyName + ' NSE')}&quotesCount=3&newsCount=0`, { headers: { 'User-Agent': UA } }, 1, 8000);
        if (!searchResp.ok) return null;
        const searchData = await searchResp.json();
        const quote = (searchData.quotes || []).find(q => q.exchange === 'NSI' || q.exchange === 'BSE' || q.exchange === 'NSE');
        if (!quote) return null;
        const fundResp = await fetchWithRetry(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${quote.symbol}?modules=summaryProfile,financialData,defaultKeyStatistics`, { headers: { 'User-Agent': UA } }, 1, 8000);
        if (!fundResp.ok) return null;
        const fundData = await fundResp.json();
        const result = fundData?.quoteSummary?.result?.[0];
        if (!result) return null;
        const fd = result.financialData || {}, ks = result.defaultKeyStatistics || {}, sp = result.summaryProfile || {};
        return {
            symbol: quote.symbol, industry: sp.industry || '', sector: sp.sector || '', description: sp.longBusinessSummary || '',
            financials: { revenueGrowth: fd.revenueGrowth?.raw ? (fd.revenueGrowth.raw * 100).toFixed(1) : null, patMargin: fd.profitMargins?.raw ? (fd.profitMargins.raw * 100).toFixed(1) : null, roe: fd.returnOnEquity?.raw ? (fd.returnOnEquity.raw * 100).toFixed(1) : null, debtToEquity: fd.debtToEquity?.raw || null, currentRatio: fd.currentRatio?.raw || null },
            valuation: { peRatio: ks.forwardPE?.raw || ks.trailingPE?.raw || null, pbRatio: ks.priceToBook?.raw || null, marketCap: fd.marketCap?.raw || null }
        };
    } catch (e) { return null; }
}

// ===== IPO Scoring Engine =====
function scoreIPO(ipo) {
    let score = 50;
    const pros = [], cons = [];

    let fundScore = 15;
    if (ipo.financials) {
        const fin = ipo.financials;
        if (fin.revenueGrowth > 25) { fundScore += 8; pros.push('Strong revenue growth (' + fin.revenueGrowth + '%)'); }
        else if (fin.revenueGrowth > 10) { fundScore += 4; pros.push('Healthy revenue growth'); }
        else if (fin.revenueGrowth < 0) { fundScore -= 6; cons.push('Revenue declining'); }
        if (fin.patMargin > 15) { fundScore += 6; pros.push('High profit margins (' + fin.patMargin + '%)'); }
        else if (fin.patMargin > 5) { fundScore += 2; }
        else if (fin.patMargin < 0) { fundScore -= 8; cons.push('Company is loss-making'); }
        if (fin.roe > 20) { fundScore += 5; pros.push('Excellent ROE (' + fin.roe + '%)'); }
        else if (fin.roe > 12) { fundScore += 2; }
        else if (fin.roe < 8) { fundScore -= 3; cons.push('Low return on equity'); }
        if (fin.debtToEquity < 0.3) { fundScore += 4; pros.push('Low debt, clean balance sheet'); }
        else if (fin.debtToEquity > 1.5) { fundScore -= 5; cons.push('High debt levels (D/E: ' + fin.debtToEquity + ')'); }
    }
    fundScore = Math.max(0, Math.min(30, fundScore));

    let industryScore = 10;
    const hotSectors = ['technology','it','fintech','ev','renewable','solar','green energy','ai','semiconductor','defence','healthcare','pharma','digital','infra'];
    const coldSectors = ['real estate','textile','sugar','paper','mining'];
    const industry = (ipo.industry || '').toLowerCase();
    if (hotSectors.some(s => industry.includes(s))) { industryScore += 8; pros.push('High-growth industry sector'); }
    if (coldSectors.some(s => industry.includes(s))) { industryScore -= 5; cons.push('Sector has limited growth outlook'); }
    industryScore = Math.max(0, Math.min(20, industryScore));

    let valuationScore = 10;
    if (ipo.valuation?.peRatio) {
        const pe = ipo.valuation.peRatio;
        if (pe < 15) { valuationScore += 8; pros.push('Attractively priced (P/E: ' + pe + ')'); }
        else if (pe < 25) { valuationScore += 4; pros.push('Reasonably valued'); }
        else if (pe > 50) { valuationScore -= 7; cons.push('Expensive valuation (P/E: ' + pe + ')'); }
        else if (pe > 35) { valuationScore -= 3; cons.push('Premium pricing compared to peers'); }
    }
    valuationScore = Math.max(0, Math.min(20, valuationScore));

    let sentimentScore = 5;
    if (ipo.sentiment) {
        if (ipo.sentiment.score >= 70) { sentimentScore = 9; pros.push('Very positive market buzz'); }
        else if (ipo.sentiment.score >= 50) { sentimentScore = 6; }
        else if (ipo.sentiment.score < 35) { sentimentScore = 2; cons.push('Negative news sentiment'); }
    }
    sentimentScore = Math.max(0, Math.min(10, sentimentScore));

    let subScore = 5;
    if (ipo.subscription) {
        const total = parseFloat(ipo.subscription.total) || parseFloat(ipo.subscription.noOfTime) || 0;
        if (total > 20) { subScore = 10; pros.push('Massively oversubscribed (' + total.toFixed(1) + 'x)'); }
        else if (total > 5) { subScore = 8; pros.push('Strong subscription demand (' + total.toFixed(1) + 'x)'); }
        else if (total > 1) { subScore = 6; }
        else if (total > 0 && total < 0.5) { subScore = 2; cons.push('Very low subscription demand'); }
    }
    subScore = Math.max(0, Math.min(10, subScore));

    let riskScore = 8;
    const gmpVal = parseFloat((ipo.gmp || '').replace(/[^\d.-]/g, ''));
    if (!isNaN(gmpVal)) {
        if (gmpVal > 100) { riskScore = 10; pros.push('Very high GMP (₹' + gmpVal + ') — strong listing expected'); }
        else if (gmpVal > 30) { riskScore = 8; pros.push('Positive GMP (₹' + gmpVal + ')'); }
        else if (gmpVal > 0) { riskScore = 6; }
        else if (gmpVal <= 0) { riskScore = 3; cons.push('Zero or negative GMP — listing losses possible'); }
    }
    const sizeStr = (ipo.ipoSize || '').replace(/[^\d.]/g, '');
    if (sizeStr) {
        const sizeVal = parseFloat(sizeStr);
        if (sizeVal > 5000) pros.push('Large IPO — likely institutional-quality company');
        if (sizeVal < 50) { cons.push('Very small IPO size — higher risk'); riskScore -= 2; }
    }
    riskScore = Math.max(0, Math.min(10, riskScore));

    score = Math.max(0, Math.min(100, fundScore + industryScore + valuationScore + sentimentScore + subScore + riskScore));
    const verdict = score >= 75 ? 'INVEST' : score >= 50 ? 'NEUTRAL' : 'AVOID';
    const verdictColor = score >= 75 ? 'green' : score >= 50 ? 'yellow' : 'red';
    const summaryParts = [
        score >= 75 ? `${ipo.companyName} looks like a strong IPO opportunity.`
        : score >= 50 ? `${ipo.companyName} shows a mixed picture.`
        : `${ipo.companyName} carries significant risks.`
    ];
    if (pros.length > 0) summaryParts.push(pros[0] + '.');
    if (cons.length > 0) summaryParts.push('However, ' + cons[0].toLowerCase() + '.');

    return { score, verdict, verdictColor, summary: summaryParts.join(' '), pros: pros.slice(0, 6), cons: cons.slice(0, 6), breakdown: { fundamentals: fundScore, industry: industryScore, valuation: valuationScore, sentiment: sentimentScore, subscription: subScore, risk: riskScore } };
}

// ===== MongoDB Cache =====
async function getCached(db, key, ttlMs) {
    if (!db) return null;
    try {
        const cache = await db.collection('ipo_cache').findOne({ _id: key });
        if (cache?.updatedAt && Date.now() - new Date(cache.updatedAt).getTime() < ttlMs) return cache.data;
    } catch (e) { /* ignore */ }
    return null;
}

async function setCache(db, key, data) {
    if (!db) return;
    try {
        await db.collection('ipo_cache').updateOne({ _id: key }, { $set: { data, updatedAt: new Date() } }, { upsert: true });
    } catch (e) { /* ignore */ }
}

// ===== Main Express Handler =====
export default async function ipoHandler(req, res) {
    const { type = 'list', name } = req.query;

    let db;
    try { db = await getDb(); } catch (e) { db = null; }

    try {
        switch (type) {
            case 'list':    return await handleList(db, res);
            case 'detail':
                if (!name) return res.status(400).json({ error: 'Missing "name" parameter' });
                return await handleDetail(db, name, res);
            case 'news':
                if (!name) return res.status(400).json({ error: 'Missing "name" parameter' });
                return res.json(await (async () => { const a = await fetchIPONews(name); return { articles: a, sentiment: computeNewsSentiment(a) }; })());
            case 'refresh': return await handleRefresh(db, res);
            default:        return res.status(400).json({ error: 'Invalid type' });
        }
    } catch (err) {
        console.error('IPO handler error:', err);
        return res.status(500).json({ error: 'Internal error', message: err.message });
    }
}

async function handleList(db, res) {
    // L1: process memory cache (5 min TTL — fast, no DB round-trip)
    const memHit = memCacheGet('ipo_list', 5 * 60 * 1000);
    if (memHit) return res.json(memHit);

    // L2: MongoDB cache (30 min TTL)
    const dbCached = await getCached(db, 'ipo_list', 30 * 60 * 1000);
    if (dbCached) { memCacheSet('ipo_list', dbCached); return res.json(dbCached); }

    let zerodha, nseData = [];
    try {
        [zerodha, nseData] = await Promise.all([fetchIPOFromZerodha(), fetchNSESubscription()]);
    } catch (e) {
        console.error('IPO fetch error:', e.message);
        // Fallback: serve stale MongoDB cache (up to 2 hrs) rather than empty response
        const stale = await getCached(db, 'ipo_list', 2 * 60 * 60 * 1000);
        if (stale) return res.json({ ...stale, stale: true, message: 'Showing cached data — live source temporarily unavailable.' });
        return res.json({ upcoming: [], ongoing: [], listed: [], lastUpdated: new Date().toISOString(), source: 'error', message: 'IPO data temporarily unavailable. Please try again in a few minutes.' });
    }

    // Enrich ongoing IPOs with NSE subscription data
    const nseMap = {};
    for (const n of nseData) nseMap[n.symbol] = n;

    const enrich = (ipos) => ipos.map(ipo => {
        const nse = nseMap[ipo.symbol];
        if (nse) {
            ipo.subscription = { total: nse.noOfTime, noOfSharesBid: nse.noOfsharesBid, noOfSharesOffered: nse.noOfSharesOffered };
            if (!ipo.priceBand && nse.issuePrice) ipo.priceBand = nse.issuePrice.replace('Rs.', '').trim();
        }
        const priceMatch = (ipo.priceBand || '').match(/(\d+)\s*[-–]+\s*(\d+)/);
        if (priceMatch) { ipo.priceMin = parseInt(priceMatch[1]); ipo.priceMax = parseInt(priceMatch[2]); }
        return ipo;
    });

    const result = {
        ongoing: enrich(zerodha.live),
        upcoming: enrich(zerodha.upcoming),
        listed: enrich(zerodha.closed),
        total: zerodha.live.length + zerodha.upcoming.length + zerodha.closed.length,
        lastUpdated: new Date().toISOString(),
        source: 'zerodha+nse'
    };

    memCacheSet('ipo_list', result);
    await setCache(db, 'ipo_list', result);
    return res.json(result);
}

async function handleDetail(db, companyName, res) {
    const cacheKey = 'ipo_detail_' + companyName.replace(/\s+/g, '_').toLowerCase();
    const cached = await getCached(db, cacheKey, 2 * 60 * 60 * 1000);
    if (cached) return res.json(cached);

    const [newsArticles, yahooData] = await Promise.all([
        fetchIPONews(companyName),
        fetchYahooData(companyName),
    ]);

    const sentiment = computeNewsSentiment(newsArticles);
    const detail = {
        companyName,
        industry: yahooData?.industry || yahooData?.sector || '',
        description: yahooData?.description || '',
        symbol: yahooData?.symbol || '',
        financials: yahooData?.financials || null,
        valuation: yahooData?.valuation || null,
        sentiment, news: newsArticles.slice(0, 8),
        fetchedAt: new Date().toISOString()
    };
    detail.scoring = scoreIPO({ ...detail, gmp: '', ipoSize: '' });

    await setCache(db, cacheKey, detail);
    return res.json(detail);
}

async function handleRefresh(db, res) {
    memCache.delete('ipo_list');
    if (db) await db.collection('ipo_cache').deleteOne({ _id: 'ipo_list' }).catch(() => {});
    return await handleList(db, res);
}
