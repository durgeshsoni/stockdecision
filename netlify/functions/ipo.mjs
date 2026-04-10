// ===== IPO Analyzer — Netlify Serverless Function =====
// Fetches IPO data from multiple public sources, caches in MongoDB
// Endpoints: list, detail, subscription, refresh

import { getDb } from '../lib/mongodb.mjs';

const HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
};

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ===== Helpers =====
function respond(status, body) {
    return { statusCode: status, headers: HEADERS, body: JSON.stringify(body) };
}

function parseDate(str) {
    if (!str) return null;
    // Handle formats: "Apr 07, 2026", "07 Apr 2026", "2026-04-07"
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

function daysBetween(d1, d2) {
    return Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24));
}

function categorizeIPO(ipo) {
    const now = new Date();
    const open = parseDate(ipo.openDate);
    const close = parseDate(ipo.closeDate);
    const listing = parseDate(ipo.listingDate);

    if (listing && listing <= now) return 'listed';
    if (open && close && open <= now && close >= now) return 'ongoing';
    if (open && open > now) return 'upcoming';
    if (close && close < now && (!listing || listing > now)) return 'upcoming'; // between close and listing
    return 'upcoming';
}

// ===== IPO Data Fetcher — Investorgain / Public APIs =====

async function fetchIPOListFromWeb() {
    const ipos = [];

    try {
        // Source 1: Investorgain IPO API (public, free)
        const igResp = await fetch('https://www.investorgain.com/report/live-ipo-gmp/331/current-ipo/', {
            headers: { 'User-Agent': USER_AGENT }
        });
        if (igResp.ok) {
            const html = await igResp.text();
            const parsed = parseInvestorgainHTML(html);
            ipos.push(...parsed);
        }
    } catch (e) {
        console.log('Investorgain fetch failed:', e.message);
    }

    try {
        // Source 2: SME + Mainboard IPOs from another endpoint
        const igResp2 = await fetch('https://www.investorgain.com/report/live-ipo-gmp/331/all/', {
            headers: { 'User-Agent': USER_AGENT }
        });
        if (igResp2.ok) {
            const html = await igResp2.text();
            const parsed = parseInvestorgainHTML(html);
            // Merge, avoiding duplicates
            for (const ipo of parsed) {
                if (!ipos.find(i => i.companyName === ipo.companyName)) {
                    ipos.push(ipo);
                }
            }
        }
    } catch (e) {
        console.log('Investorgain all fetch failed:', e.message);
    }

    return ipos;
}

function parseInvestorgainHTML(html) {
    const ipos = [];

    // Extract table rows from the HTML
    // Pattern: Look for IPO data in table format
    const tableMatch = html.match(/<table[^>]*class="[^"]*table[^"]*"[^>]*>([\s\S]*?)<\/table>/gi);
    if (!tableMatch) return ipos;

    for (const table of tableMatch) {
        const rows = table.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
        if (!rows) continue;

        for (let i = 1; i < rows.length; i++) { // Skip header row
            const cells = rows[i].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
            if (!cells || cells.length < 4) continue;

            const getText = (cell) => cell.replace(/<[^>]+>/g, '').trim();
            const name = getText(cells[0]);

            if (!name || name.length < 2) continue;

            const ipo = {
                companyName: name,
                priceBand: getText(cells[1]) || '',
                gmp: getText(cells[2]) || '',
                openDate: getText(cells[3]) || '',
                closeDate: cells[4] ? getText(cells[4]) : '',
                listingDate: cells[5] ? getText(cells[5]) : '',
                ipoSize: cells[6] ? getText(cells[6]) : '',
                lotSize: cells[7] ? getText(cells[7]) : '',
                source: 'investorgain'
            };

            if (ipo.companyName.length > 2) {
                ipos.push(ipo);
            }
        }
    }

    return ipos;
}

// ===== Chittorgarh IPO Scraper (backup) =====
async function fetchFromChittorgarh() {
    const ipos = [];

    try {
        const resp = await fetch('https://www.chittorgarh.com/report/ipo-in-india-702/702/', {
            headers: { 'User-Agent': USER_AGENT }
        });
        if (!resp.ok) return ipos;
        const html = await resp.text();

        const tableMatch = html.match(/<table[^>]*id="report_table[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
        if (!tableMatch) return ipos;

        const rows = tableMatch[0].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
        if (!rows) return ipos;

        for (let i = 1; i < rows.length; i++) {
            const cells = rows[i].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
            if (!cells || cells.length < 6) continue;

            const getText = (cell) => cell.replace(/<[^>]+>/g, '').trim();

            ipos.push({
                companyName: getText(cells[0]),
                openDate: getText(cells[1]),
                closeDate: getText(cells[2]),
                ipoSize: getText(cells[3]),
                priceBand: getText(cells[4]),
                listingDate: getText(cells[5]) || '',
                gmp: '',
                lotSize: '',
                source: 'chittorgarh'
            });
        }
    } catch (e) {
        console.log('Chittorgarh fetch failed:', e.message);
    }

    return ipos;
}

// ===== NSE IPO Subscription Data =====
async function fetchSubscriptionData(companyName) {
    try {
        // NSE public API for IPO subscription
        const resp = await fetch('https://www.nseindia.com/api/ipo-current-issue', {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json',
                'Referer': 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo'
            }
        });

        if (!resp.ok) return null;
        const data = await resp.json();

        if (Array.isArray(data)) {
            const match = data.find(item => {
                const name = (item.companyName || item.symbol || '').toLowerCase();
                return name.includes(companyName.toLowerCase().split(' ')[0]);
            });

            if (match) {
                return {
                    qib: match.subscriptionQIB || match.qib || null,
                    hni: match.subscriptionHNI || match.hni || null,
                    retail: match.subscriptionRetail || match.retail || null,
                    total: match.subscriptionTotal || match.total || null,
                    employee: match.subscriptionEmployee || null,
                    lastUpdated: new Date().toISOString()
                };
            }
        }
    } catch (e) {
        console.log('NSE subscription fetch failed:', e.message);
    }
    return null;
}

// ===== News Fetcher for IPO =====
async function fetchIPONews(companyName) {
    const articles = [];
    const query = encodeURIComponent(`${companyName} IPO`);

    try {
        // Google News RSS
        const resp = await fetch(`https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`, {
            headers: { 'User-Agent': USER_AGENT }
        });

        if (resp.ok) {
            const xml = await resp.text();
            const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];

            for (const item of items.slice(0, 10)) {
                const title = (item.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
                const link = (item.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
                const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
                const source = (item.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1] || '';

                const cleanTitle = title.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '');

                articles.push({
                    title: cleanTitle,
                    link: link.replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1'),
                    date: pubDate,
                    source: source.replace(/<[^>]+>/g, ''),
                    sentiment: analyzeSingleSentiment(cleanTitle)
                });
            }
        }
    } catch (e) {
        console.log('News fetch failed:', e.message);
    }

    return articles;
}

function analyzeSingleSentiment(text) {
    const lower = text.toLowerCase();

    const bullish = ['subscribe', 'strong', 'buy', 'positive', 'oversubscribed', 'demand', 'premium', 'listing gain',
        'grey market', 'gmp', 'boom', 'surge', 'rally', 'bullish', 'upbeat', 'robust', 'stellar', 'blockbuster',
        'record', 'bumper', 'allotment', 'apply', 'recommend', 'good', 'attractive'];

    const bearish = ['avoid', 'risk', 'concern', 'overpriced', 'expensive', 'caution', 'weak', 'loss', 'decline',
        'crash', 'negative', 'sell', 'dump', 'bearish', 'poor', 'disappointing', 'flop', 'below', 'discount',
        'trouble', 'debt', 'warning', 'fraud', 'scam', 'controversy'];

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

    return {
        score: Math.min(100, sentimentScore),
        label: sentimentScore >= 65 ? 'positive' : sentimentScore >= 40 ? 'neutral' : 'negative',
        positive, negative, neutral,
        total
    };
}

// ===== IPO Scoring Engine =====
function scoreIPO(ipo) {
    let score = 50; // Start neutral
    const pros = [];
    const cons = [];

    // 1. FUNDAMENTALS (30 points max)
    let fundScore = 15; // Start mid

    if (ipo.financials) {
        const fin = ipo.financials;

        // Revenue growth
        if (fin.revenueGrowth > 25) { fundScore += 8; pros.push('Strong revenue growth (>' + fin.revenueGrowth + '%)'); }
        else if (fin.revenueGrowth > 10) { fundScore += 4; pros.push('Healthy revenue growth'); }
        else if (fin.revenueGrowth < 0) { fundScore -= 6; cons.push('Revenue declining'); }

        // Profitability
        if (fin.patMargin > 15) { fundScore += 6; pros.push('High profit margins (' + fin.patMargin + '%)'); }
        else if (fin.patMargin > 5) { fundScore += 2; }
        else if (fin.patMargin < 0) { fundScore -= 8; cons.push('Company is loss-making'); }

        // ROE
        if (fin.roe > 20) { fundScore += 5; pros.push('Excellent ROE (' + fin.roe + '%)'); }
        else if (fin.roe > 12) { fundScore += 2; }
        else if (fin.roe < 8) { fundScore -= 3; cons.push('Low return on equity'); }

        // Debt
        if (fin.debtToEquity < 0.3) { fundScore += 4; pros.push('Low debt, clean balance sheet'); }
        else if (fin.debtToEquity > 1.5) { fundScore -= 5; cons.push('High debt levels (D/E: ' + fin.debtToEquity + ')'); }
    }
    fundScore = Math.max(0, Math.min(30, fundScore));

    // 2. INDUSTRY POTENTIAL (20 points max)
    let industryScore = 10;
    const hotSectors = ['technology', 'it', 'fintech', 'ev', 'renewable', 'solar', 'green energy', 'ai', 'semiconductor', 'defence', 'healthcare', 'pharma', 'digital'];
    const coldSectors = ['real estate', 'textile', 'sugar', 'paper', 'mining'];

    const industry = (ipo.industry || '').toLowerCase();
    if (hotSectors.some(s => industry.includes(s))) { industryScore += 8; pros.push('High-growth industry sector'); }
    if (coldSectors.some(s => industry.includes(s))) { industryScore -= 5; cons.push('Sector has limited growth outlook'); }

    industryScore = Math.max(0, Math.min(20, industryScore));

    // 3. VALUATION (20 points max)
    let valuationScore = 10;

    if (ipo.valuation) {
        if (ipo.valuation.peRatio) {
            if (ipo.valuation.peRatio < 15) { valuationScore += 8; pros.push('Attractively priced (P/E: ' + ipo.valuation.peRatio + ')'); }
            else if (ipo.valuation.peRatio < 25) { valuationScore += 4; pros.push('Reasonably valued'); }
            else if (ipo.valuation.peRatio > 50) { valuationScore -= 7; cons.push('Expensive valuation (P/E: ' + ipo.valuation.peRatio + ')'); }
            else if (ipo.valuation.peRatio > 35) { valuationScore -= 3; cons.push('Premium pricing compared to peers'); }
        }

        if (ipo.valuation.peerComparison === 'underpriced') { valuationScore += 5; pros.push('Priced lower than listed peers'); }
        else if (ipo.valuation.peerComparison === 'overpriced') { valuationScore -= 5; cons.push('Overpriced compared to listed competitors'); }
    }
    valuationScore = Math.max(0, Math.min(20, valuationScore));

    // 4. SENTIMENT (10 points max)
    let sentimentScore = 5;

    if (ipo.sentiment) {
        if (ipo.sentiment.score >= 70) { sentimentScore = 9; pros.push('Very positive market buzz'); }
        else if (ipo.sentiment.score >= 50) { sentimentScore = 6; }
        else if (ipo.sentiment.score < 35) { sentimentScore = 2; cons.push('Negative news sentiment'); }
    }
    sentimentScore = Math.max(0, Math.min(10, sentimentScore));

    // 5. SUBSCRIPTION DEMAND (10 points max)
    let subScore = 5;

    if (ipo.subscription) {
        const total = parseFloat(ipo.subscription.total) || 0;
        if (total > 20) { subScore = 10; pros.push('Massively oversubscribed (' + total + 'x)'); }
        else if (total > 5) { subScore = 8; pros.push('Strong subscription demand (' + total + 'x)'); }
        else if (total > 1) { subScore = 6; }
        else if (total > 0 && total < 0.5) { subScore = 2; cons.push('Very low subscription demand'); }

        const qib = parseFloat(ipo.subscription.qib) || 0;
        if (qib > 10) { pros.push('Institutional investors showing high confidence'); }
        else if (qib < 0.5 && qib > 0) { cons.push('Weak institutional interest'); }
    }
    subScore = Math.max(0, Math.min(10, subScore));

    // 6. RISK FACTORS (10 points max — deductions)
    let riskScore = 8;

    // GMP analysis
    const gmpVal = parseFloat((ipo.gmp || '').replace(/[^\d.-]/g, ''));
    if (!isNaN(gmpVal)) {
        if (gmpVal > 100) { riskScore = 10; pros.push('Very high GMP (₹' + gmpVal + ') — strong listing expected'); }
        else if (gmpVal > 30) { riskScore = 8; pros.push('Positive GMP (₹' + gmpVal + ')'); }
        else if (gmpVal > 0) { riskScore = 6; }
        else if (gmpVal <= 0) { riskScore = 3; cons.push('Zero or negative GMP — listing losses possible'); }
    }

    // IPO size
    const sizeStr = (ipo.ipoSize || '').replace(/[^\d.]/g, '');
    const sizeVal = parseFloat(sizeStr);
    if (!isNaN(sizeVal) && sizeVal > 5000) { pros.push('Large IPO — likely institutional-quality company'); }
    if (!isNaN(sizeVal) && sizeVal < 50) { cons.push('Very small IPO size — higher risk'); riskScore -= 2; }

    riskScore = Math.max(0, Math.min(10, riskScore));

    // FINAL SCORE
    score = fundScore + industryScore + valuationScore + sentimentScore + subScore + riskScore;
    score = Math.max(0, Math.min(100, score));

    // Verdict
    let verdict, verdictColor;
    if (score >= 75) { verdict = 'INVEST'; verdictColor = 'green'; }
    else if (score >= 50) { verdict = 'NEUTRAL'; verdictColor = 'yellow'; }
    else { verdict = 'AVOID'; verdictColor = 'red'; }

    // Summary
    const summaryParts = [];
    if (score >= 75) summaryParts.push(`${ipo.companyName} looks like a strong IPO opportunity.`);
    else if (score >= 50) summaryParts.push(`${ipo.companyName} shows a mixed picture.`);
    else summaryParts.push(`${ipo.companyName} carries significant risks.`);

    if (pros.length > 0) summaryParts.push(pros[0] + '.');
    if (cons.length > 0) summaryParts.push('However, ' + cons[0].toLowerCase() + '.');

    return {
        score,
        verdict,
        verdictColor,
        summary: summaryParts.join(' '),
        pros: pros.slice(0, 6),
        cons: cons.slice(0, 6),
        breakdown: {
            fundamentals: fundScore,
            industry: industryScore,
            valuation: valuationScore,
            sentiment: sentimentScore,
            subscription: subScore,
            risk: riskScore
        }
    };
}

// ===== Try to get peer/financial info from Yahoo =====
async function fetchYahooData(companyName) {
    try {
        // Search for the company on Yahoo
        const searchTerm = encodeURIComponent(companyName + ' NSE');
        const searchResp = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${searchTerm}&quotesCount=3&newsCount=0`, {
            headers: { 'User-Agent': USER_AGENT }
        });

        if (!searchResp.ok) return null;
        const searchData = await searchResp.json();

        const quote = (searchData.quotes || []).find(q =>
            q.exchange === 'NSI' || q.exchange === 'BSE' || q.exchange === 'NSE'
        );

        if (!quote) return null;

        const symbol = quote.symbol;

        // Fetch fundamentals
        const fundResp = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=summaryProfile,financialData,defaultKeyStatistics,earnings,incomeStatementHistory`, {
            headers: { 'User-Agent': USER_AGENT }
        });

        if (!fundResp.ok) return null;
        const fundData = await fundResp.json();
        const result = fundData?.quoteSummary?.result?.[0];
        if (!result) return null;

        const fd = result.financialData || {};
        const ks = result.defaultKeyStatistics || {};
        const sp = result.summaryProfile || {};

        return {
            symbol,
            industry: sp.industry || '',
            sector: sp.sector || '',
            description: sp.longBusinessSummary || '',
            financials: {
                revenueGrowth: fd.revenueGrowth?.raw ? (fd.revenueGrowth.raw * 100).toFixed(1) : null,
                patMargin: fd.profitMargins?.raw ? (fd.profitMargins.raw * 100).toFixed(1) : null,
                roe: fd.returnOnEquity?.raw ? (fd.returnOnEquity.raw * 100).toFixed(1) : null,
                roce: fd.returnOnAssets?.raw ? (fd.returnOnAssets.raw * 100).toFixed(1) : null,
                debtToEquity: fd.debtToEquity?.raw || null,
                currentRatio: fd.currentRatio?.raw || null,
                revenue: fd.totalRevenue?.raw || null,
                ebitda: fd.ebitda?.raw || null,
            },
            valuation: {
                peRatio: ks.forwardPE?.raw || ks.trailingPE?.raw || null,
                pbRatio: ks.priceToBook?.raw || null,
                marketCap: fd.marketCap?.raw || null,
            },
            competitors: sp.industryKey ? await fetchPeers(sp.industryKey) : []
        };
    } catch (e) {
        console.log('Yahoo data fetch failed:', e.message);
        return null;
    }
}

async function fetchPeers(industryKey) {
    // This is a simplified peer lookup
    return []; // Yahoo doesn't easily expose this without auth
}

// ===== MongoDB Cache Operations =====
async function getCachedIPOList(db) {
    const cache = await db.collection('ipo_cache').findOne({ _id: 'ipo_list' });
    if (cache && cache.updatedAt) {
        const age = Date.now() - new Date(cache.updatedAt).getTime();
        if (age < 30 * 60 * 1000) { // 30 min cache
            return cache.data;
        }
    }
    return null;
}

async function setCachedIPOList(db, data) {
    await db.collection('ipo_cache').updateOne(
        { _id: 'ipo_list' },
        { $set: { data, updatedAt: new Date() } },
        { upsert: true }
    );
}

async function getCachedIPODetail(db, name) {
    const key = 'ipo_detail_' + name.replace(/\s+/g, '_').toLowerCase();
    const cache = await db.collection('ipo_cache').findOne({ _id: key });
    if (cache && cache.updatedAt) {
        const age = Date.now() - new Date(cache.updatedAt).getTime();
        if (age < 2 * 60 * 60 * 1000) { // 2 hour cache for details
            return cache.data;
        }
    }
    return null;
}

async function setCachedIPODetail(db, name, data) {
    const key = 'ipo_detail_' + name.replace(/\s+/g, '_').toLowerCase();
    await db.collection('ipo_cache').updateOne(
        { _id: key },
        { $set: { data, updatedAt: new Date() } },
        { upsert: true }
    );
}

// ===== Main Handler =====
export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return { statusCode: 204, headers: HEADERS };
    }

    const url = new URL(req.url, 'https://localhost');
    const type = url.searchParams.get('type') || 'list';

    try {
        let db;
        try { db = await getDb(); } catch (e) { db = null; }

        switch (type) {
            case 'list':
                return await handleList(db);

            case 'detail':
                const name = url.searchParams.get('name');
                if (!name) return respond(400, { error: 'Missing "name" parameter' });
                return await handleDetail(db, name);

            case 'news':
                const company = url.searchParams.get('name');
                if (!company) return respond(400, { error: 'Missing "name" parameter' });
                return await handleNews(company);

            case 'refresh':
                return await handleRefresh(db);

            default:
                return respond(400, { error: 'Invalid type. Use: list, detail, news, refresh' });
        }
    } catch (err) {
        console.error('IPO handler error:', err);
        return respond(500, { error: 'Internal error', message: err.message });
    }
}

async function handleList(db) {
    // Try cache first
    if (db) {
        const cached = await getCachedIPOList(db);
        if (cached) return respond(200, cached);
    }

    // Fetch fresh data
    let ipos = await fetchIPOListFromWeb();

    // If primary source fails, try backup
    if (ipos.length === 0) {
        ipos = await fetchFromChittorgarh();
    }

    // If still no data, return fallback
    if (ipos.length === 0) {
        return respond(200, {
            upcoming: [], ongoing: [], listed: [],
            lastUpdated: new Date().toISOString(),
            source: 'fallback',
            message: 'IPO data sources temporarily unavailable. Please try again later.'
        });
    }

    // Categorize
    const categorized = { upcoming: [], ongoing: [], listed: [] };
    for (const ipo of ipos) {
        ipo.category = categorizeIPO(ipo);

        // Parse GMP value
        const gmpStr = (ipo.gmp || '').replace(/[^\d.-]/g, '');
        ipo.gmpValue = parseFloat(gmpStr) || 0;

        // Parse price band
        const priceMatch = (ipo.priceBand || '').match(/(\d+)\s*[-–to]+\s*(\d+)/);
        if (priceMatch) {
            ipo.priceMin = parseInt(priceMatch[1]);
            ipo.priceMax = parseInt(priceMatch[2]);
        }

        if (categorized[ipo.category]) {
            categorized[ipo.category].push(ipo);
        } else {
            categorized.upcoming.push(ipo);
        }
    }

    const result = {
        ...categorized,
        total: ipos.length,
        lastUpdated: new Date().toISOString(),
        source: 'live'
    };

    // Cache it
    if (db) {
        await setCachedIPOList(db, result).catch(() => {});
    }

    return respond(200, result);
}

async function handleDetail(db, companyName) {
    // Try cache
    if (db) {
        const cached = await getCachedIPODetail(db, companyName);
        if (cached) return respond(200, cached);
    }

    // Fetch news
    const newsArticles = await fetchIPONews(companyName);
    const sentiment = computeNewsSentiment(newsArticles);

    // Try Yahoo for financial data
    const yahooData = await fetchYahooData(companyName);

    // Fetch subscription data
    const subscription = await fetchSubscriptionData(companyName);

    // Build detail object
    const detail = {
        companyName,
        industry: yahooData?.industry || yahooData?.sector || '',
        description: yahooData?.description || '',
        symbol: yahooData?.symbol || '',
        financials: yahooData?.financials || null,
        valuation: yahooData?.valuation || null,
        sentiment,
        news: newsArticles.slice(0, 8),
        subscription,
        competitors: yahooData?.competitors || [],
        fetchedAt: new Date().toISOString()
    };

    // Score it
    const scoring = scoreIPO({
        ...detail,
        gmp: '', // Will be populated from list data on frontend
        ipoSize: ''
    });

    detail.scoring = scoring;

    // Cache
    if (db) {
        await setCachedIPODetail(db, companyName, detail).catch(() => {});
    }

    return respond(200, detail);
}

async function handleNews(companyName) {
    const articles = await fetchIPONews(companyName);
    const sentiment = computeNewsSentiment(articles);
    return respond(200, { articles, sentiment });
}

async function handleRefresh(db) {
    // Force refresh by clearing cache
    if (db) {
        await db.collection('ipo_cache').deleteOne({ _id: 'ipo_list' });
    }
    return await handleList(db);
}
