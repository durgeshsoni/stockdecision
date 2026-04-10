// ===== IPO Analyzer API Route =====
import { getDb } from '../lib/mongodb.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ===== Helpers =====
function parseDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

function categorizeIPO(ipo) {
    const now = new Date();
    const open = parseDate(ipo.openDate);
    const close = parseDate(ipo.closeDate);
    const listing = parseDate(ipo.listingDate);
    if (listing && listing <= now) return 'listed';
    if (open && close && open <= now && close >= now) return 'ongoing';
    if (open && open > now) return 'upcoming';
    if (close && close < now && (!listing || listing > now)) return 'upcoming';
    return 'upcoming';
}

// ===== IPO Data Fetchers =====
async function fetchIPOListFromWeb() {
    const ipos = [];
    try {
        const r = await fetch('https://www.investorgain.com/report/live-ipo-gmp/331/current-ipo/', { headers: { 'User-Agent': UA } });
        if (r.ok) ipos.push(...parseInvestorgainHTML(await r.text()));
    } catch (e) { console.log('Investorgain fetch failed:', e.message); }

    try {
        const r2 = await fetch('https://www.investorgain.com/report/live-ipo-gmp/331/all/', { headers: { 'User-Agent': UA } });
        if (r2.ok) {
            for (const ipo of parseInvestorgainHTML(await r2.text())) {
                if (!ipos.find(i => i.companyName === ipo.companyName)) ipos.push(ipo);
            }
        }
    } catch (e) { console.log('Investorgain all fetch failed:', e.message); }

    return ipos;
}

function parseInvestorgainHTML(html) {
    const ipos = [];
    const tableMatch = html.match(/<table[^>]*class="[^"]*table[^"]*"[^>]*>([\s\S]*?)<\/table>/gi);
    if (!tableMatch) return ipos;
    for (const table of tableMatch) {
        const rows = table.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
        if (!rows) continue;
        for (let i = 1; i < rows.length; i++) {
            const cells = rows[i].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
            if (!cells || cells.length < 4) continue;
            const getText = c => c.replace(/<[^>]+>/g, '').trim();
            const name = getText(cells[0]);
            if (!name || name.length < 2) continue;
            ipos.push({
                companyName: name, priceBand: getText(cells[1]) || '', gmp: getText(cells[2]) || '',
                openDate: getText(cells[3]) || '', closeDate: cells[4] ? getText(cells[4]) : '',
                listingDate: cells[5] ? getText(cells[5]) : '', ipoSize: cells[6] ? getText(cells[6]) : '',
                lotSize: cells[7] ? getText(cells[7]) : '', source: 'investorgain'
            });
        }
    }
    return ipos;
}

async function fetchFromChittorgarh() {
    const ipos = [];
    try {
        const r = await fetch('https://www.chittorgarh.com/report/ipo-in-india-702/702/', { headers: { 'User-Agent': UA } });
        if (!r.ok) return ipos;
        const html = await r.text();
        const tableMatch = html.match(/<table[^>]*id="report_table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
        if (!tableMatch) return ipos;
        const rows = tableMatch[0].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
        if (!rows) return ipos;
        for (let i = 1; i < rows.length; i++) {
            const cells = rows[i].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
            if (!cells || cells.length < 6) continue;
            const getText = c => c.replace(/<[^>]+>/g, '').trim();
            ipos.push({ companyName: getText(cells[0]), openDate: getText(cells[1]), closeDate: getText(cells[2]), ipoSize: getText(cells[3]), priceBand: getText(cells[4]), listingDate: getText(cells[5]) || '', gmp: '', lotSize: '', source: 'chittorgarh' });
        }
    } catch (e) { console.log('Chittorgarh fetch failed:', e.message); }
    return ipos;
}

async function fetchSubscriptionData(companyName) {
    try {
        const r = await fetch('https://www.nseindia.com/api/ipo-current-issue', { headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo' } });
        if (!r.ok) return null;
        const data = await r.json();
        if (Array.isArray(data)) {
            const match = data.find(item => (item.companyName || item.symbol || '').toLowerCase().includes(companyName.toLowerCase().split(' ')[0]));
            if (match) return { qib: match.subscriptionQIB || match.qib || null, hni: match.subscriptionHNI || match.hni || null, retail: match.subscriptionRetail || match.retail || null, total: match.subscriptionTotal || match.total || null, employee: match.subscriptionEmployee || null, lastUpdated: new Date().toISOString() };
        }
    } catch (e) { console.log('NSE subscription fetch failed:', e.message); }
    return null;
}

async function fetchIPONews(companyName) {
    const articles = [];
    try {
        const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(companyName + ' IPO')}&hl=en-IN&gl=IN&ceid=IN:en`, { headers: { 'User-Agent': UA } });
        if (r.ok) {
            const xml = await r.text();
            for (const item of (xml.match(/<item>([\s\S]*?)<\/item>/gi) || []).slice(0, 10)) {
                const title = ((item.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '');
                const link = ((item.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '').replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
                const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
                const source = ((item.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1] || '').replace(/<[^>]+>/g, '');
                articles.push({ title, link, date: pubDate, source, sentiment: analyzeSingleSentiment(title) });
            }
        }
    } catch (e) { console.log('IPO news fetch failed:', e.message); }
    return articles;
}

function analyzeSingleSentiment(text) {
    const lower = text.toLowerCase();
    const bullish = ['subscribe','strong','buy','positive','oversubscribed','demand','premium','listing gain','grey market','gmp','boom','surge','rally','bullish','upbeat','robust','stellar','blockbuster','record','bumper','allotment','apply','recommend','good','attractive'];
    const bearish = ['avoid','risk','concern','overpriced','expensive','caution','weak','loss','decline','crash','negative','sell','dump','bearish','poor','disappointing','flop','below','discount','trouble','debt','warning','fraud','scam','controversy'];
    let score = 0;
    for (const w of bullish) { if (lower.includes(w)) score++; }
    for (const w of bearish) { if (lower.includes(w)) score--; }
    return score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
}

function computeNewsSentiment(articles) {
    if (!articles || articles.length === 0) return { score: 50, label: 'neutral', positive: 0, negative: 0, neutral: 0 };
    let positive = 0, negative = 0, neutral = 0;
    for (const a of articles) {
        if (a.sentiment === 'positive') positive++;
        else if (a.sentiment === 'negative') negative++;
        else neutral++;
    }
    const total = articles.length;
    const sentimentScore = Math.round(((positive / total) * 100 + (neutral / total) * 50));
    return { score: Math.min(100, sentimentScore), label: sentimentScore >= 65 ? 'positive' : sentimentScore >= 40 ? 'neutral' : 'negative', positive, negative, neutral, total };
}

function scoreIPO(ipo) {
    let score = 50;
    const pros = [], cons = [];

    let fundScore = 15;
    if (ipo.financials) {
        const fin = ipo.financials;
        if (fin.revenueGrowth > 25) { fundScore += 8; pros.push('Strong revenue growth (>' + fin.revenueGrowth + '%)'); }
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
    const hotSectors = ['technology','it','fintech','ev','renewable','solar','green energy','ai','semiconductor','defence','healthcare','pharma','digital'];
    const coldSectors = ['real estate','textile','sugar','paper','mining'];
    const industry = (ipo.industry || '').toLowerCase();
    if (hotSectors.some(s => industry.includes(s))) { industryScore += 8; pros.push('High-growth industry sector'); }
    if (coldSectors.some(s => industry.includes(s))) { industryScore -= 5; cons.push('Sector has limited growth outlook'); }
    industryScore = Math.max(0, Math.min(20, industryScore));

    let valuationScore = 10;
    if (ipo.valuation?.peRatio) {
        if (ipo.valuation.peRatio < 15) { valuationScore += 8; pros.push('Attractively priced (P/E: ' + ipo.valuation.peRatio + ')'); }
        else if (ipo.valuation.peRatio < 25) { valuationScore += 4; pros.push('Reasonably valued'); }
        else if (ipo.valuation.peRatio > 50) { valuationScore -= 7; cons.push('Expensive valuation (P/E: ' + ipo.valuation.peRatio + ')'); }
        else if (ipo.valuation.peRatio > 35) { valuationScore -= 3; cons.push('Premium pricing compared to peers'); }
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
        const total = parseFloat(ipo.subscription.total) || 0;
        if (total > 20) { subScore = 10; pros.push('Massively oversubscribed (' + total + 'x)'); }
        else if (total > 5) { subScore = 8; pros.push('Strong subscription demand (' + total + 'x)'); }
        else if (total > 1) { subScore = 6; }
        else if (total > 0 && total < 0.5) { subScore = 2; cons.push('Very low subscription demand'); }
        const qib = parseFloat(ipo.subscription.qib) || 0;
        if (qib > 10) pros.push('Institutional investors showing high confidence');
        else if (qib < 0.5 && qib > 0) cons.push('Weak institutional interest');
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
    const sizeVal = parseFloat((ipo.ipoSize || '').replace(/[^\d.]/g, ''));
    if (!isNaN(sizeVal) && sizeVal > 5000) pros.push('Large IPO — likely institutional-quality company');
    if (!isNaN(sizeVal) && sizeVal < 50) { cons.push('Very small IPO size — higher risk'); riskScore -= 2; }
    riskScore = Math.max(0, Math.min(10, riskScore));

    score = Math.max(0, Math.min(100, fundScore + industryScore + valuationScore + sentimentScore + subScore + riskScore));
    const verdict = score >= 75 ? 'INVEST' : score >= 50 ? 'NEUTRAL' : 'AVOID';
    const verdictColor = score >= 75 ? 'green' : score >= 50 ? 'yellow' : 'red';
    const summaryParts = [score >= 75 ? `${ipo.companyName} looks like a strong IPO opportunity.` : score >= 50 ? `${ipo.companyName} shows a mixed picture.` : `${ipo.companyName} carries significant risks.`];
    if (pros.length > 0) summaryParts.push(pros[0] + '.');
    if (cons.length > 0) summaryParts.push('However, ' + cons[0].toLowerCase() + '.');

    return { score, verdict, verdictColor, summary: summaryParts.join(' '), pros: pros.slice(0, 6), cons: cons.slice(0, 6), breakdown: { fundamentals: fundScore, industry: industryScore, valuation: valuationScore, sentiment: sentimentScore, subscription: subScore, risk: riskScore } };
}

async function fetchYahooData(companyName) {
    try {
        const searchResp = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(companyName + ' NSE')}&quotesCount=3&newsCount=0`, { headers: { 'User-Agent': UA } });
        if (!searchResp.ok) return null;
        const searchData = await searchResp.json();
        const quote = (searchData.quotes || []).find(q => q.exchange === 'NSI' || q.exchange === 'BSE' || q.exchange === 'NSE');
        if (!quote) return null;
        const fundResp = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${quote.symbol}?modules=summaryProfile,financialData,defaultKeyStatistics`, { headers: { 'User-Agent': UA } });
        if (!fundResp.ok) return null;
        const fundData = await fundResp.json();
        const result = fundData?.quoteSummary?.result?.[0];
        if (!result) return null;
        const fd = result.financialData || {}, ks = result.defaultKeyStatistics || {}, sp = result.summaryProfile || {};
        return {
            symbol: quote.symbol, industry: sp.industry || '', sector: sp.sector || '', description: sp.longBusinessSummary || '',
            financials: { revenueGrowth: fd.revenueGrowth?.raw ? (fd.revenueGrowth.raw * 100).toFixed(1) : null, patMargin: fd.profitMargins?.raw ? (fd.profitMargins.raw * 100).toFixed(1) : null, roe: fd.returnOnEquity?.raw ? (fd.returnOnEquity.raw * 100).toFixed(1) : null, roce: fd.returnOnAssets?.raw ? (fd.returnOnAssets.raw * 100).toFixed(1) : null, debtToEquity: fd.debtToEquity?.raw || null, currentRatio: fd.currentRatio?.raw || null },
            valuation: { peRatio: ks.forwardPE?.raw || ks.trailingPE?.raw || null, pbRatio: ks.priceToBook?.raw || null, marketCap: fd.marketCap?.raw || null },
            competitors: []
        };
    } catch (e) { console.log('Yahoo IPO data failed:', e.message); return null; }
}

// ===== MongoDB Cache =====
async function getCached(db, key, ttlMs) {
    if (!db) return null;
    const cache = await db.collection('ipo_cache').findOne({ _id: key });
    if (cache?.updatedAt && Date.now() - new Date(cache.updatedAt).getTime() < ttlMs) return cache.data;
    return null;
}

async function setCache(db, key, data) {
    if (!db) return;
    await db.collection('ipo_cache').updateOne({ _id: key }, { $set: { data, updatedAt: new Date() } }, { upsert: true });
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
                return await handleNews(name, res);
            case 'refresh': return await handleRefresh(db, res);
            default:        return res.status(400).json({ error: 'Invalid type' });
        }
    } catch (err) {
        console.error('IPO handler error:', err);
        return res.status(500).json({ error: 'Internal error', message: err.message });
    }
}

async function handleList(db, res) {
    const cached = await getCached(db, 'ipo_list', 30 * 60 * 1000);
    if (cached) return res.json(cached);

    let ipos = await fetchIPOListFromWeb();
    if (ipos.length === 0) ipos = await fetchFromChittorgarh();

    if (ipos.length === 0) {
        return res.json({ upcoming: [], ongoing: [], listed: [], lastUpdated: new Date().toISOString(), source: 'fallback', message: 'IPO data sources temporarily unavailable.' });
    }

    const categorized = { upcoming: [], ongoing: [], listed: [] };
    for (const ipo of ipos) {
        ipo.category = categorizeIPO(ipo);
        const gmpStr = (ipo.gmp || '').replace(/[^\d.-]/g, '');
        ipo.gmpValue = parseFloat(gmpStr) || 0;
        const priceMatch = (ipo.priceBand || '').match(/(\d+)\s*[-–to]+\s*(\d+)/);
        if (priceMatch) { ipo.priceMin = parseInt(priceMatch[1]); ipo.priceMax = parseInt(priceMatch[2]); }
        if (categorized[ipo.category]) categorized[ipo.category].push(ipo);
        else categorized.upcoming.push(ipo);
    }

    const result = { ...categorized, total: ipos.length, lastUpdated: new Date().toISOString(), source: 'live' };
    await setCache(db, 'ipo_list', result).catch(() => {});
    return res.json(result);
}

async function handleDetail(db, companyName, res) {
    const cacheKey = 'ipo_detail_' + companyName.replace(/\s+/g, '_').toLowerCase();
    const cached = await getCached(db, cacheKey, 2 * 60 * 60 * 1000);
    if (cached) return res.json(cached);

    const [newsArticles, yahooData, subscription] = await Promise.all([
        fetchIPONews(companyName),
        fetchYahooData(companyName),
        fetchSubscriptionData(companyName),
    ]);

    const sentiment = computeNewsSentiment(newsArticles);
    const detail = {
        companyName, industry: yahooData?.industry || yahooData?.sector || '', description: yahooData?.description || '',
        symbol: yahooData?.symbol || '', financials: yahooData?.financials || null, valuation: yahooData?.valuation || null,
        sentiment, news: newsArticles.slice(0, 8), subscription, competitors: [], fetchedAt: new Date().toISOString()
    };
    detail.scoring = scoreIPO({ ...detail, gmp: '', ipoSize: '' });

    await setCache(db, cacheKey, detail).catch(() => {});
    return res.json(detail);
}

async function handleNews(companyName, res) {
    const articles = await fetchIPONews(companyName);
    return res.json({ articles, sentiment: computeNewsSentiment(articles) });
}

async function handleRefresh(db, res) {
    if (db) await db.collection('ipo_cache').deleteOne({ _id: 'ipo_list' }).catch(() => {});
    return await handleList(db, res);
}
