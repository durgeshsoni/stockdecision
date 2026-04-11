// ===== StockDecision - India Focused Edition =====
// Uses local Node.js server - NO CORS, NO API keys, NO rate limits

const API = ''; // Same origin
let priceChart = null;
let volumeChart = null;
let beginnerChart = null;
let currentMode = 'beginner'; // 'beginner' or 'pro'
let lastAnalysis = null; // Store last analysis for mode switching

// ===== Indian Stock Database (loaded from stocks.json) =====
// To add/remove stocks, edit public/stocks.json — no code change needed.
let STOCK_DB = [];
const INDIAN_NAMES = {};

async function loadStockDb() {
    try {
        const res = await fetch('/stocks.json');
        if (!res.ok) throw new Error('Failed to load stocks.json');
        STOCK_DB = await res.json();
    } catch {
        // Minimal fallback — keeps search working even if JSON fetch fails
        STOCK_DB = [
            { symbol: 'RELIANCE.NS', name: 'Reliance Industries', exchange: 'NSE', sector: 'Energy' },
            { symbol: 'TCS.NS',      name: 'Tata Consultancy Services', exchange: 'NSE', sector: 'IT' },
            { symbol: 'HDFCBANK.NS', name: 'HDFC Bank Ltd', exchange: 'NSE', sector: 'Banking' },
            { symbol: 'INFY.NS',     name: 'Infosys Ltd', exchange: 'NSE', sector: 'IT' },
            { symbol: 'AAPL',        name: 'Apple Inc.', exchange: 'NASDAQ', sector: 'Tech' },
            { symbol: 'MSFT',        name: 'Microsoft', exchange: 'NASDAQ', sector: 'Tech' },
        ];
    }
    STOCK_DB.filter(s => s.symbol.endsWith('.NS')).forEach(s => {
        INDIAN_NAMES[s.symbol.replace('.NS', '')] = s.symbol;
        INDIAN_NAMES[s.name.toUpperCase()] = s.symbol;
    });
}

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', async () => {
    // Load stock database before wiring up search (non-blocking for the rest of init)
    loadStockDb(); // intentionally not awaited — search works once promise resolves

    document.getElementById('analyzeBtn').addEventListener('click', startAnalysis);
    document.getElementById('stockInput').addEventListener('keypress', e => {
        if (e.key === 'Enter') { e.preventDefault(); startAnalysis(); }
    });
    document.getElementById('stockInput').addEventListener('input', handleSearchInput);
    document.getElementById('stockInput').addEventListener('focus', handleSearchInput);
    document.addEventListener('click', e => {
        if (!e.target.closest('.hero-search-wrapper'))
            document.getElementById('suggestionsDropdown').classList.add('hidden');
    });

    document.querySelectorAll('.pick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('stockInput').value = btn.dataset.symbol;
            startAnalysis();
        });
    });

    // Mode toggle (triggered from result banners, not navbar)

    updateMarketStatus();
    loadWorldMarkets();
    loadStockOfDay();
});

// ===== Stock of the Day =====
async function loadStockOfDay() {
    // Check localStorage cache
    const cached = localStorage.getItem('sotd');
    if (cached) {
        try {
            const data = JSON.parse(cached);
            if (data.date === new Date().toISOString().slice(0, 10)) {
                renderSOTD(data);
                return;
            }
        } catch { /* stale cache */ }
    }
    try {
        const data = await apiGet('stockofday', {});
        if (data && data.symbol) {
            localStorage.setItem('sotd', JSON.stringify(data));
            renderSOTD(data);
        }
    } catch { /* SOTD is optional, don't show error */ }
}

function renderSOTD(data) {
    const card = document.getElementById('sotdCard');
    if (!card) return;
    const cs = data.currency === 'INR' ? '₹' : data.currency === 'USD' ? '$' : (data.currency || '₹');
    document.getElementById('sotdName').textContent = `${data.name} (${data.symbol})`;
    document.getElementById('sotdSector').textContent = data.sector || '';
    document.getElementById('sotdPrice').textContent = `${cs}${data.price?.toLocaleString(undefined, {maximumFractionDigits:2})}`;
    const changeEl = document.getElementById('sotdChange');
    changeEl.textContent = `${data.changePct >= 0 ? '+' : ''}${data.changePct?.toFixed(2)}%`;
    changeEl.className = `sotd-change ${data.changePct >= 0 ? 'up' : 'down'}`;
    document.getElementById('sotdVerdict').textContent = data.verdict || '';
    document.getElementById('sotdPE').textContent = `P/E: ${data.pe ? data.pe.toFixed(1) : '--'}`;
    document.getElementById('sotdEPS').textContent = `EPS: ${data.eps ? cs + data.eps.toFixed(2) : '--'}`;
    document.getElementById('sotd52W').textContent = `52W: ${cs}${data.low52?.toFixed(0) || '--'} - ${cs}${data.high52?.toFixed(0) || '--'}`;
    card.classList.remove('hidden');
    // Store symbol for analyze button
    card.dataset.symbol = data.symbol;
}

function analyzeSOTD() {
    const card = document.getElementById('sotdCard');
    const symbol = card?.dataset?.symbol;
    if (symbol) {
        document.getElementById('stockInput').value = symbol;
        startAnalysis();
    }
}

function switchMode(mode) {
    currentMode = mode;
    // Switch the view
    if (lastAnalysis) {
        document.getElementById('beginnerContent').classList.toggle('hidden', mode !== 'beginner');
        document.getElementById('mainContent').classList.toggle('hidden', mode !== 'pro');
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ===== Recent Searches (localStorage) =====
function getRecentSearches() {
    try { return JSON.parse(localStorage.getItem('recentSearches') || '[]'); } catch { return []; }
}
function saveRecentSearch(symbol, name) {
    const recent = getRecentSearches().filter(r => r.symbol !== symbol);
    recent.unshift({ symbol, name, ts: Date.now() });
    localStorage.setItem('recentSearches', JSON.stringify(recent.slice(0, 10)));
}

// ===== Search Suggestions =====
function handleSearchInput() {
    const query = document.getElementById('stockInput').value.trim().toLowerCase();
    const dropdown = document.getElementById('suggestionsDropdown');

    // Empty input → show recent searches
    if (query.length < 1) {
        showRecentSearches(dropdown);
        return;
    }

    // Score matches: symbol-start > name-start > symbol-contains > name-contains
    const scored = [];
    for (const s of STOCK_DB) {
        const symClean = s.symbol.replace('.NS', '').replace('.BO', '').toLowerCase();
        const nameLower = s.name.toLowerCase();
        let score = 0;
        if (symClean === query) score = 100;
        else if (symClean.startsWith(query)) score = 80;
        else if (nameLower.startsWith(query)) score = 60;
        else if (symClean.includes(query)) score = 40;
        else if (nameLower.includes(query)) score = 20;
        // Match individual words in company name (e.g. "tata" matches "Tata Motors")
        else if (nameLower.split(/\s+/).some(w => w.startsWith(query))) score = 30;
        if (score > 0) scored.push({ ...s, _score: score });
    }
    scored.sort((a, b) => b._score - a._score);
    const matches = scored.slice(0, 8);

    if (!matches.length) { dropdown.classList.add('hidden'); return; }

    dropdown.innerHTML = matches.map(s => {
        const symDisplay = s.symbol.replace('.NS', '').replace('.BO', '');
        return `<div class="suggestion-item" data-symbol="${s.symbol}">
            <div><span class="sym">${symDisplay}</span> <span class="name">${s.name}</span></div>
            <span class="exchange">${s.exchange}</span>
        </div>`;
    }).join('');
    dropdown.classList.remove('hidden');
    bindDropdownClicks(dropdown);
}

function showRecentSearches(dropdown) {
    const recent = getRecentSearches();
    if (!recent.length) { dropdown.classList.add('hidden'); return; }
    dropdown.innerHTML = '<div class="dropdown-section-title"><i class="fas fa-clock"></i> Recent Searches</div>' +
        recent.map(r => {
            const symDisplay = r.symbol.replace('.NS', '').replace('.BO', '');
            return `<div class="suggestion-item recent-item" data-symbol="${r.symbol}">
                <div><span class="sym">${symDisplay}</span> <span class="name">${r.name || r.symbol}</span></div>
                <i class="fas fa-arrow-right" style="color:var(--text-muted);font-size:11px"></i>
            </div>`;
        }).join('');
    dropdown.classList.remove('hidden');
    bindDropdownClicks(dropdown);
}

function bindDropdownClicks(dropdown) {
    dropdown.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
            document.getElementById('stockInput').value = item.dataset.symbol;
            dropdown.classList.add('hidden');
            startAnalysis();
        });
    });
}

// ===== API Calls =====
async function apiGet(endpoint, params, retries = 2) {
    const typeMap = { chart: 'chart', fundamentals: 'fundamentals', insights: 'insights', news: 'news' };
    const qs = new URLSearchParams({ type: typeMap[endpoint] || endpoint, ...params }).toString();
    const headers = {};
    if (typeof getAuthToken === 'function') {
        const token = await getAuthToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(`/api/yahoo?${qs}`, { headers });
            if (res.status === 429) throw new Error('Yahoo rate limit. Wait 1-2 min.');
            // Don't retry client errors (4xx) — only server errors (5xx) and network failures
            if (res.status >= 400 && res.status < 500) throw new Error(`API error: ${res.status}`);
            if (!res.ok) {
                if (attempt < retries) { await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt))); continue; }
                throw new Error(`API error: ${res.status}`);
            }
            return res.json();
        } catch (e) {
            // Re-throw immediately for non-retryable errors
            if (e.message.includes('rate limit') || e.message.includes('API error: 4')) throw e;
            if (attempt === retries) throw e;
            await new Promise(r => setTimeout(r, 800 * Math.pow(2, attempt)));
        }
    }
}

// Track search if logged in (fire-and-forget)
function trackSearch(symbol, name) {
    if (typeof getAuthToken !== 'function') return;
    getAuthToken().then(token => {
        if (!token) return;
        fetch('/api/user?action=search', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol, name })
        }).catch(() => {});
    });
}

// ===== Go Home (Logo Click) =====
function goHome() {
    setRoute('/');
    // Hide all content sections
    ['dashboardContent', 'screenerContent', 'mainContent', 'beginnerContent', 'alertsContent', 'ipoContent'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    // Show welcome screen
    const ws = document.getElementById('welcomeScreen');
    if (ws) ws.classList.remove('hidden');
    // Clear search input
    const input = document.getElementById('stockInput');
    if (input) input.value = '';
}

// ===== Market Status with IST Time =====
function updateMarketStatus() {
    // Get IST time properly
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const ist = new Date(utcMs + 5.5 * 3600000);
    const istH = ist.getHours();
    const istM = ist.getMinutes();
    const istTotalMin = istH * 60 + istM;
    const day = ist.getDay();
    const isWeekday = day > 0 && day < 6;

    // NSE: 9:15 AM - 3:30 PM IST
    const marketOpenMin = 9 * 60 + 15;  // 9:15 AM
    const marketCloseMin = 15 * 60 + 30; // 3:30 PM
    const indiaOpen = isWeekday && istTotalMin >= marketOpenMin && istTotalMin < marketCloseMin;

    // Pre-market: 9:00 - 9:15, Post-market: 3:30 - 4:00
    const isPreMarket = isWeekday && istTotalMin >= (9 * 60) && istTotalMin < marketOpenMin;
    const isPostMarket = isWeekday && istTotalMin >= marketCloseMin && istTotalMin < (16 * 60);

    const statusText = document.getElementById('marketStatusText');
    const statusDot = document.querySelector('.status-dot');

    const istTimeStr = `${istH.toString().padStart(2, '0')}:${istM.toString().padStart(2, '0')} IST`;

    if (indiaOpen) {
        statusText.textContent = `NSE Open (9:15 AM - 3:30 PM) | ${istTimeStr}`;
        statusDot.style.background = 'var(--accent-green)';
    } else if (isPreMarket) {
        statusText.textContent = `Pre-Market 9:00-9:15 | ${istTimeStr}`;
        statusDot.style.background = 'var(--accent-yellow)';
    } else if (isPostMarket) {
        statusText.textContent = `Post-Market 3:30-4:00 | ${istTimeStr}`;
        statusDot.style.background = 'var(--accent-yellow)';
    } else {
        statusText.textContent = `NSE Closed (9:15 AM - 3:30 PM) | ${istTimeStr}`;
        statusDot.style.background = 'var(--accent-red)';
    }

    // Update every minute
    setTimeout(updateMarketStatus, 60000);
}

// ===== World Markets =====
async function loadWorldMarkets() {
    const tickerEl = document.getElementById('tickerContent');
    const indices = [
        { symbol: '^NSEI', name: 'Nifty 50', flag: '🇮🇳' },
        { symbol: '^BSESN', name: 'Sensex', flag: '🇮🇳' },
        { symbol: '^NSEBANK', name: 'Bank Nifty', flag: '🇮🇳' },
        { symbol: 'NIFTYMIDCAP150.NS', name: 'Nifty Midcap 150', flag: '🇮🇳' },
        { symbol: '^CNXIT', name: 'Nifty IT', flag: '🇮🇳' },
        { symbol: '^CNXPHARMA', name: 'Nifty Pharma', flag: '🇮🇳' },
        { symbol: '^CNXAUTO', name: 'Nifty Auto', flag: '🇮🇳' },
        { symbol: '^CNXFMCG', name: 'Nifty FMCG', flag: '🇮🇳' },
    ];

    try {
        const results = await Promise.allSettled(
            indices.map(idx => apiGet('chart', { symbol: idx.symbol, range: '5d', interval: '1d' }))
        );

        let tickerHTML = '';
        for (let rep = 0; rep < 2; rep++) {
            results.forEach((r, i) => {
                if (r.status !== 'fulfilled' || !r.value.chart?.result?.[0]) return;
                const meta = r.value.chart.result[0].meta;
                const closes = r.value.chart.result[0].indicators?.quote?.[0]?.close || [];
                const validCloses = closes.filter(c => c != null);
                const latest = validCloses[validCloses.length - 1] || meta.regularMarketPrice || 0;
                const prev = validCloses[validCloses.length - 2] || latest;
                const change = prev > 0 ? ((latest - prev) / prev * 100).toFixed(2) : '0.00';
                const isUp = parseFloat(change) >= 0;
                tickerHTML += `
                    <span class="ticker-item">
                        <span class="name">${indices[i].flag || ''} ${indices[i].name}</span>
                        <span class="value">${latest.toLocaleString(undefined, {maximumFractionDigits: 2})}</span>
                        <span class="change ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${change}%</span>
                    </span>
                `;
            });
        }
        if (tickerHTML) tickerEl.innerHTML = tickerHTML;
        else tickerEl.innerHTML = '<span class="ticker-loading">Market data loading...</span>';
    } catch {
        tickerEl.innerHTML = '<span class="ticker-loading">Market data loading...</span>';
    }
}

// ===== Main Analysis =====
async function startAnalysis() {
    let symbol = document.getElementById('stockInput').value.trim().toUpperCase();
    if (!symbol) return showToast('Please enter a stock symbol');

    // Auto-detect Indian stock names and append .NS
    if (INDIAN_NAMES[symbol]) symbol = INDIAN_NAMES[symbol];
    else if (!symbol.includes('.') && !['AAPL','MSFT','GOOGL','TSLA','NVDA','AMZN','META','NFLX','JPM','V','BA','DIS','AMD','INTC','WMT'].includes(symbol)) {
        // Assume Indian stock if not a known US symbol
        symbol = symbol + '.NS';
    }
    document.getElementById('stockInput').value = symbol;
    document.getElementById('suggestionsDropdown').classList.add('hidden');
    showLoading(true);

    try {
        // 1. Fetch chart data
        updateProgress('Loading price history...', 15);
        const chartResp = await apiGet('chart', { symbol, range: '1y', interval: '1d' });
        if (!chartResp.chart?.result?.[0]) throw new Error(`No data for "${symbol}". Check the symbol.`);
        const chartData = chartResp.chart.result[0];

        // 2. Fetch fundamentals (page scraping - server side)
        updateProgress('Loading fundamentals & company data...', 45);
        const summary = await apiGet('fundamentals', { symbol });

        // 3. Fetch insights
        updateProgress('Loading market insights...', 70);
        let insights = {};
        try {
            const insResp = await apiGet('insights', { symbol });
            insights = insResp.finance?.result || {};
        } catch { /* optional */ }

        updateProgress('Running AI analysis...', 85);

        // Process chart data
        const timestamps = chartData.timestamp || [];
        const ohlcv = chartData.indicators?.quote?.[0] || {};
        const prices = [];
        for (let i = timestamps.length - 1; i >= 0; i--) {
            if (ohlcv.close[i] != null) {
                prices.push({
                    date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
                    open: ohlcv.open[i] || 0,
                    high: ohlcv.high[i] || 0,
                    low: ohlcv.low[i] || 0,
                    close: ohlcv.close[i],
                    volume: ohlcv.volume[i] || 0,
                });
            }
        }
        if (prices.length < 5) throw new Error('Insufficient data for analysis.');

        const meta = chartData.meta || {};
        const currency = meta.currency || 'INR';
        const cs = currency === 'INR' ? '₹' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency;

        updateProgress('Computing indicators...', 85);
        const analysis = runAnalysis(prices, summary, meta, insights);

        // Fetch news & sentiment (non-blocking - renders after main content)
        updateProgress('Fetching latest news & events...', 90);
        let newsData = null;
        try {
            const pr = summary.price || {};
            const compName = vs(pr.longName) || vs(pr.shortName) || meta.longName || symbol;
            newsData = await apiGet('news', { symbol, name: compName });
        } catch { /* news is optional */ }

        // Store for mode switching
        lastAnalysis = { symbol, prices, summary, meta, analysis, cs, currency, insights, newsData };

        updateProgress('Generating report...', 95);

        // Render both modes
        renderResults(symbol, prices, summary, meta, analysis, cs, currency, insights);
        renderBeginner(symbol, prices, summary, meta, analysis, cs, currency, insights);
        if (newsData) {
            renderNewsBeginnerMode(newsData, analysis);
            renderNewsProMode(newsData);
        }

        updateProgress('Complete!', 100);
        currentMode = 'beginner'; // Always start with simple view
        setTimeout(() => {
            showLoading(false);
            document.getElementById('welcomeScreen').classList.add('hidden');
            document.getElementById('beginnerContent').classList.remove('hidden');
            document.getElementById('mainContent').classList.add('hidden');
            setRoute('/stock/' + encodeURIComponent(symbol));
        }, 300);

    } catch (err) {
        showLoading(false);
        showToast(err.message);
    }
}

// ===== Analysis Engine =====
function runAnalysis(prices, summary, meta, insights) {
    const closes = prices.map(p => p.close);
    const volumes = prices.map(p => p.volume);
    const latest = closes[0];
    const prev = closes[1] || latest;

    // Technical Indicators
    const sma20 = calcSMA(closes, 20);
    const sma50 = calcSMA(closes, 50);
    const sma200 = calcSMA(closes, 200);
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const rsi = calcRSI(closes, 14);
    const macdLine = ema12 - ema26;
    const bb = calcBollingerBands(closes, 20);
    const avgVolume = volumes.slice(0, 20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
    const volumeRatio = avgVolume > 0 ? volumes[0] / avgVolume : 1;

    // Price changes
    const dayChange = prev > 0 ? ((latest - prev) / prev * 100) : 0;
    const weekChange = closes.length >= 5 ? ((latest - closes[4]) / closes[4] * 100) : 0;
    const monthChange = closes.length >= 22 ? ((latest - closes[21]) / closes[21] * 100) : 0;
    const threeMonthChange = closes.length >= 66 ? ((latest - closes[65]) / closes[65] * 100) : 0;
    const sixMonthChange = closes.length >= 126 ? ((latest - closes[125]) / closes[125] * 100) : 0;
    const yearChange = closes.length >= 250 ? ((latest - closes[249]) / closes[249] * 100) : 0;

    // Fundamentals from scraped summary
    const fd = summary.financialData || {};
    const sd = summary.summaryDetail || {};
    const ks = summary.defaultKeyStatistics || {};
    const pr = summary.price || {};

    const pe = v(sd.trailingPE) || v(pr.trailingPE) || 0;
    const forwardPE = v(sd.forwardPE) || v(ks.forwardPE) || 0;
    const pb = v(ks.priceToBook) || 0;
    const eps = v(ks.trailingEps) || 0;
    const roe = v(fd.returnOnEquity) || 0;
    const roa = v(fd.returnOnAssets) || 0;
    const profitMargin = v(fd.profitMargins) || 0;
    const grossMargin = v(fd.grossMargins) || 0;
    const operatingMargin = v(fd.operatingMargins) || 0;
    const debtToEquity = v(fd.debtToEquity) || 0;
    const currentRatio = v(fd.currentRatio) || 0;
    const revenueGrowth = v(fd.revenueGrowth) || 0;
    const earningsGrowth = v(fd.earningsGrowth) || 0;
    const divYield = v(sd.dividendYield) || 0;
    const divRate = v(sd.dividendRate) || 0;
    const payoutRatio = v(sd.payoutRatio) || 0;
    const beta = v(sd.beta) || v(ks.beta) || 1;
    const marketCap = v(pr.marketCap) || v(sd.marketCap) || 0;
    const fiftyTwoWeekHigh = v(sd.fiftyTwoWeekHigh) || meta.fiftyTwoWeekHigh || 0;
    const fiftyTwoWeekLow = v(sd.fiftyTwoWeekLow) || meta.fiftyTwoWeekLow || 0;
    const targetPrice = v(fd.targetMeanPrice) || 0;
    const recommendation = fd.recommendationKey || '';
    const totalRevenue = v(fd.totalRevenue) || 0;
    const totalDebt = v(fd.totalDebt) || 0;
    const totalCash = v(fd.totalCash) || 0;
    const freeCashflow = v(fd.freeCashflow) || 0;

    // ===== SCORING =====
    let techScore = 50, fundScore = 50;

    // Technical
    if (latest > sma20) techScore += 5; else techScore -= 5;
    if (latest > sma50) techScore += 7; else techScore -= 7;
    if (latest > sma200) techScore += 10; else techScore -= 10;
    if (sma20 > sma50) techScore += 4; else techScore -= 4;
    if (sma50 > sma200) techScore += 5; else techScore -= 5;
    if (rsi < 30) techScore += 10; else if (rsi < 40) techScore += 5; else if (rsi > 70) techScore -= 10; else if (rsi > 60) techScore -= 3;
    if (macdLine > 0) techScore += 5; else techScore -= 5;
    if (latest < bb.lower) techScore += 8; else if (latest > bb.upper) techScore -= 6;
    if (volumeRatio > 1.5 && dayChange > 0) techScore += 5;
    if (volumeRatio > 1.5 && dayChange < 0) techScore -= 5;
    if (monthChange > 5) techScore += 5; else if (monthChange < -5) techScore -= 5;
    if (weekChange > 0 && monthChange > 0) techScore += 3;
    if (weekChange < 0 && monthChange < 0) techScore -= 3;
    if (fiftyTwoWeekHigh > 0 && fiftyTwoWeekLow > 0) {
        const pos = (latest - fiftyTwoWeekLow) / (fiftyTwoWeekHigh - fiftyTwoWeekLow);
        if (pos > 0.8) techScore -= 3;
        if (pos < 0.3) techScore += 5;
    }

    // Fundamental
    if (pe > 0 && pe < 15) fundScore += 10; else if (pe < 25) fundScore += 5; else if (pe > 40) fundScore -= 8; else if (pe > 30) fundScore -= 4;
    if (pb > 0 && pb < 1.5) fundScore += 8; else if (pb < 3) fundScore += 3; else if (pb > 5) fundScore -= 5;
    if (roe > 0.20) fundScore += 10; else if (roe > 0.15) fundScore += 7; else if (roe > 0.10) fundScore += 4; else if (roe > 0 && roe < 0.05) fundScore -= 5;
    if (profitMargin > 0.20) fundScore += 8; else if (profitMargin > 0.10) fundScore += 5; else if (profitMargin < 0) fundScore -= 10;
    if (debtToEquity < 50) fundScore += 5; else if (debtToEquity > 200) fundScore -= 8; else if (debtToEquity > 100) fundScore -= 4;
    if (eps > 0) fundScore += 5; else fundScore -= 8;
    if (currentRatio > 1.5) fundScore += 4; else if (currentRatio > 0 && currentRatio < 1) fundScore -= 5;
    if (revenueGrowth > 0.15) fundScore += 7; else if (revenueGrowth > 0.05) fundScore += 3; else if (revenueGrowth < 0) fundScore -= 6;
    if (earningsGrowth > 0.15) fundScore += 7; else if (earningsGrowth > 0) fundScore += 3; else if (earningsGrowth < -0.10) fundScore -= 8;
    if (divYield > 0.03) fundScore += 5; else if (divYield > 0.01) fundScore += 2;
    if (targetPrice > 0 && latest > 0) {
        const upside = ((targetPrice - latest) / latest) * 100;
        if (upside > 20) fundScore += 8; else if (upside > 10) fundScore += 5; else if (upside < -10) fundScore -= 5;
    }
    if (recommendation === 'buy' || recommendation === 'strongBuy') fundScore += 5;
    if (recommendation === 'sell' || recommendation === 'strongSell') fundScore -= 5;

    techScore = clamp(techScore, 0, 100);
    fundScore = clamp(fundScore, 0, 100);
    const totalScore = clamp(Math.round(techScore * 0.45 + fundScore * 0.55), 0, 100);

    // Verdict
    let verdict, action, holdPeriod, holdClass;
    if (totalScore >= 72) { verdict = 'STRONG BULLISH'; action = 'STRONG BUY'; holdPeriod = '2-5 Years (Long Term)'; holdClass = 'long'; }
    else if (totalScore >= 60) { verdict = 'BULLISH'; action = 'BUY'; holdPeriod = '1-2 Years'; holdClass = 'long'; }
    else if (totalScore >= 52) { verdict = 'SLIGHTLY BULLISH'; action = 'BUY / HOLD'; holdPeriod = '6-12 Months'; holdClass = 'medium'; }
    else if (totalScore >= 45) { verdict = 'NEUTRAL'; action = 'HOLD / WATCH'; holdPeriod = '3-6 Months (Watch)'; holdClass = 'medium'; }
    else if (totalScore >= 35) { verdict = 'SLIGHTLY BEARISH'; action = 'HOLD / EXIT'; holdPeriod = '1-3 Months (Exit)'; holdClass = 'short'; }
    else { verdict = 'BEARISH'; action = 'SELL / AVOID'; holdPeriod = 'Exit or Avoid'; holdClass = 'short'; }

    let investPct, investReason;
    if (totalScore >= 70 && beta < 1.3) { investPct = '15-25%'; investReason = 'Strong fundamentals + low volatility. SIP recommended for best entry.'; }
    else if (totalScore >= 60) { investPct = '10-15%'; investReason = 'Good outlook. Allocate with 8-10% stop-loss.'; }
    else if (totalScore >= 50) { investPct = '5-10%'; investReason = 'Moderate signals. Small position, monitor closely.'; }
    else if (totalScore >= 40) { investPct = '2-5%'; investReason = 'Mixed signals. Only speculative position. Tight stop-loss.'; }
    else { investPct = '0% (Avoid)'; investReason = 'Negative signals dominate. Preserve capital.'; }

    return {
        score: totalScore, techScore, fundScore, verdict, action, holdPeriod, holdClass, investPct, investReason,
        indicators: { sma20, sma50, sma200, ema12, ema26, rsi, macdLine, bollingerUpper: bb.upper, bollingerLower: bb.lower, bollingerMiddle: bb.middle, avgVolume, volumeRatio },
        changes: { dayChange, weekChange, monthChange, threeMonthChange, sixMonthChange, yearChange },
        fundamentals: {
            pe, forwardPE, pb, eps, roe, roa, profitMargin, grossMargin, operatingMargin, debtToEquity, currentRatio,
            revenueGrowth, earningsGrowth, divYield, divRate, payoutRatio, beta, marketCap,
            fiftyTwoWeekHigh, fiftyTwoWeekLow, targetPrice, recommendation,
            totalRevenue, totalDebt, totalCash, freeCashflow,
        },
    };
}

// ===== Helpers =====
function v(obj) {
    if (obj == null) return 0;
    if (typeof obj === 'number') return obj;
    if (typeof obj === 'object' && obj.raw !== undefined) return obj.raw ?? 0;
    if (typeof obj === 'string') return parseFloat(obj) || 0;
    return 0;
}
function vs(obj) { // string value
    if (obj == null) return '';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'object' && obj.fmt) return obj.fmt;
    return String(obj);
}
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function calcSMA(d, p) { const n = Math.min(p, d.length); return d.slice(0, n).reduce((a, b) => a + b, 0) / n; }
function calcEMA(d, p) {
    if (d.length < p) return d[0];
    const k = 2 / (p + 1);
    let ema = d.slice(d.length - p).reduce((a, b) => a + b, 0) / p;
    for (let i = d.length - p - 1; i >= 0; i--) ema = d[i] * k + ema * (1 - k);
    return ema;
}
function calcRSI(d, p) {
    if (d.length < p + 1) return 50;
    let g = 0, l = 0;
    for (let i = 0; i < p; i++) { const diff = d[i] - d[i + 1]; if (diff >= 0) g += diff; else l -= diff; }
    if (l === 0) return 100;
    return 100 - (100 / (1 + (g / p) / (l / p)));
}
function calcBollingerBands(d, p) {
    const n = Math.min(p, d.length), sma = d.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(d.slice(0, n).reduce((s, v) => s + (v - sma) ** 2, 0) / n);
    return { upper: sma + 2 * std, middle: sma, lower: sma - 2 * std };
}
function fmtNum(n) {
    if (n == null || isNaN(n)) return '--';
    if (n >= 1e12) return (n/1e12).toFixed(2)+'T';
    if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
    if (n >= 1e7) return (n/1e7).toFixed(2)+'Cr';
    if (n >= 1e5) return (n/1e5).toFixed(2)+'L';
    return n.toLocaleString(undefined, {maximumFractionDigits: 2});
}
function fmtCur(n, s) { return n == null || isNaN(n) ? '--' : s + n.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}); }
function fmtMC(n, s) {
    if (!n) return 'N/A';
    if (n >= 1e12) return s+(n/1e12).toFixed(2)+'T';
    if (n >= 1e9) return s+(n/1e9).toFixed(2)+'B';
    if (n >= 1e7) return s+(n/1e7).toFixed(2)+'Cr';
    return s+n.toLocaleString();
}

// ===== Render Results =====
function renderResults(symbol, prices, summary, meta, analysis, cs, currency, insights) {
    const latest = prices[0], prev = prices[1] || latest;
    const change = latest.close - prev.close;
    const changePct = prev.close > 0 ? (change / prev.close * 100) : 0;
    const f = analysis.fundamentals;
    const sp = summary.summaryProfile || summary.assetProfile || {};
    const pr = summary.price || {};

    const companyName = vs(pr.longName) || vs(pr.shortName) || meta.longName || meta.shortName || symbol;
    const isBull = analysis.score >= 50, isBear = analysis.score < 40;
    const cls = isBear ? 'bearish' : isBull ? 'bullish' : 'neutral';

    // Verdict
    const vc = document.getElementById('verdictCard');
    vc.className = `summary-card verdict-card ${cls}`;
    const vb = document.getElementById('verdictBadge');
    vb.className = `verdict-badge ${cls}`;
    vb.textContent = analysis.verdict;
    document.getElementById('stockName').textContent = `${companyName} (${symbol})`;
    document.getElementById('currentPrice').textContent = fmtCur(latest.close, cs);
    const pce = document.getElementById('priceChange');
    pce.textContent = `${change >= 0 ? '+' : ''}${fmtCur(Math.abs(change), cs)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`;
    pce.className = `price-change ${change >= 0 ? 'up' : 'down'}`;
    document.getElementById('verdictText').innerHTML = `AI: ${analysis.action} | Tech: ${analysis.techScore}/100 | Fund: ${analysis.fundScore}/100 | Score: ${analysis.score}/100
    <span class="stock-actions">
        <button class="btn-action-sm" onclick="if(typeof showAlertModal==='function')showAlertModal('${symbol}','${companyName.replace(/'/g,"\\'")}',${latest.close},'${currency}')" title="Set Alert"><i class="fas fa-bell"></i></button>
        <button class="btn-action-sm" onclick="if(typeof addToWatchlist==='function')addToWatchlist('${symbol}','${companyName.replace(/'/g,"\\'")}');else if(typeof showLoginModal==='function')showLoginModal()" title="Add to Watchlist"><i class="fas fa-star"></i></button>
    </span>`;

    // Track search
    saveRecentSearch(symbol, companyName);
    trackSearch(symbol, companyName);

    // Signal
    document.getElementById('signalFill').style.width = `${analysis.score}%`;
    const c = analysis.changes;
    document.getElementById('signalDetails').innerHTML = `
        <strong>Score: ${analysis.score}/100</strong><br>
        Day: <span style="color:${c.dayChange>=0?'var(--accent-green)':'var(--accent-red)'}">${c.dayChange>=0?'+':''}${c.dayChange.toFixed(2)}%</span> |
        Week: <span style="color:${c.weekChange>=0?'var(--accent-green)':'var(--accent-red)'}">${c.weekChange>=0?'+':''}${c.weekChange.toFixed(2)}%</span> |
        Month: <span style="color:${c.monthChange>=0?'var(--accent-green)':'var(--accent-red)'}">${c.monthChange>=0?'+':''}${c.monthChange.toFixed(2)}%</span> |
        Year: <span style="color:${c.yearChange>=0?'var(--accent-green)':'var(--accent-red)'}">${c.yearChange>=0?'+':''}${c.yearChange.toFixed(2)}%</span>`;

    // Investment
    document.getElementById('investSuggestion').innerHTML = `<div class="invest-amount">${analysis.investPct} of Portfolio</div><div class="invest-details">${analysis.investReason}</div>`;

    // Charts
    renderPriceChart(prices.slice(0, 120).reverse(), cs);
    renderVolumeChart(prices.slice(0, 30).reverse());

    // Sections
    renderTechnical(analysis, cs);
    renderFundamental(analysis, cs);
    renderCompany(summary, meta, symbol, cs, f);
    renderDividend(analysis, cs, latest.close, currency);
    renderWorldMarketSection();
    renderHold(analysis);
    renderReport(symbol, latest, companyName, analysis, cs, currency, insights);
}

// ===== Charts =====
function renderPriceChart(prices, cs) {
    const ctx = document.getElementById('priceChart').getContext('2d');
    if (priceChart) priceChart.destroy();
    const labels = prices.map(p => p.date), data = prices.map(p => p.close);
    const s20 = [], s50 = [];
    data.forEach((_, i) => {
        const a = data.slice(Math.max(0, i-19), i+1); s20.push(a.reduce((x,y)=>x+y,0)/a.length);
        const b = data.slice(Math.max(0, i-49), i+1); s50.push(i >= 49 ? b.reduce((x,y)=>x+y,0)/b.length : null);
    });
    priceChart = new Chart(ctx, {
        type: 'line', data: { labels, datasets: [
            { label:'Price', data, borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.05)', borderWidth:2, fill:true, tension:0.3, pointRadius:0, pointHitRadius:10 },
            { label:'SMA 20', data:s20, borderColor:'#f59e0b', borderWidth:1.5, borderDash:[5,3], fill:false, tension:0.3, pointRadius:0 },
            { label:'SMA 50', data:s50, borderColor:'#ef4444', borderWidth:1.5, borderDash:[5,3], fill:false, tension:0.3, pointRadius:0 },
        ]},
        options: { responsive:true, maintainAspectRatio:false, interaction:{mode:'index',intersect:false},
            plugins:{legend:{labels:{color:'#8b95a5',font:{size:11}}},tooltip:{backgroundColor:'#1a1f2e',borderColor:'#2a3042',borderWidth:1,titleColor:'#f0f2f5',bodyColor:'#8b95a5'}},
            scales:{x:{ticks:{color:'#5a6377',maxTicksLimit:10,font:{size:10}},grid:{color:'rgba(42,48,66,0.3)'}},y:{ticks:{color:'#5a6377',font:{size:10}},grid:{color:'rgba(42,48,66,0.3)'}}}
        }
    });
}
function renderVolumeChart(prices) {
    const ctx = document.getElementById('volumeChart').getContext('2d');
    if (volumeChart) volumeChart.destroy();
    volumeChart = new Chart(ctx, {
        type:'bar', data:{labels:prices.map(p=>p.date), datasets:[{label:'Volume',data:prices.map(p=>p.volume),
            backgroundColor:prices.map((p,i)=>i===0?'rgba(59,130,246,0.6)':p.close>=(prices[i-1]?.close||0)?'rgba(16,185,129,0.5)':'rgba(239,68,68,0.5)'),borderRadius:3}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{backgroundColor:'#1a1f2e',borderColor:'#2a3042',borderWidth:1,callbacks:{label:c=>'Vol: '+fmtNum(c.raw)}}},
            scales:{x:{ticks:{color:'#5a6377',maxTicksLimit:8,font:{size:10}},grid:{display:false}},y:{ticks:{color:'#5a6377',font:{size:10},callback:v=>fmtNum(v)},grid:{color:'rgba(42,48,66,0.3)'}}}}
    });
}

// ===== Section Renderers =====
function renderTechnical(a, cs) {
    const i = a.indicators;
    document.getElementById('indicatorGrid').innerHTML = [
        { l:'RSI (14)', v:i.rsi.toFixed(2), s:i.rsi<30?'bullish':i.rsi>70?'bearish':'neutral' },
        { l:'SMA 20', v:fmtCur(i.sma20,cs), s:'neutral' },
        { l:'SMA 50', v:fmtCur(i.sma50,cs), s:'neutral' },
        { l:'SMA 200', v:fmtCur(i.sma200,cs), s:'neutral' },
        { l:'MACD', v:i.macdLine.toFixed(4), s:i.macdLine>0?'bullish':'bearish' },
        { l:'Bollinger Upper', v:fmtCur(i.bollingerUpper,cs), s:'neutral' },
        { l:'Bollinger Lower', v:fmtCur(i.bollingerLower,cs), s:'neutral' },
        { l:'Volume Ratio', v:i.volumeRatio.toFixed(2)+'x', s:i.volumeRatio>1.5?'bullish':'neutral' },
    ].map(x=>`<div class="indicator-row"><span class="label">${x.l}</span><span class="value ${x.s}">${x.v}</span></div>`).join('');
}
function renderFundamental(a, cs) {
    const f = a.fundamentals;
    document.getElementById('fundamentalGrid').innerHTML = [
        { l:'P/E (TTM)', v:f.pe?f.pe.toFixed(2):'N/A', s:f.pe>0&&f.pe<25?'good':f.pe>35?'bad':'neutral' },
        { l:'Forward P/E', v:f.forwardPE?f.forwardPE.toFixed(2):'N/A', s:f.forwardPE>0&&f.forwardPE<20?'good':'neutral' },
        { l:'P/B Ratio', v:f.pb?f.pb.toFixed(2):'N/A', s:f.pb>0&&f.pb<3?'good':f.pb>5?'bad':'neutral' },
        { l:'EPS', v:f.eps?cs+f.eps.toFixed(2):'N/A', s:f.eps>0?'good':'bad' },
        { l:'ROE', v:f.roe?(f.roe*100).toFixed(2)+'%':'N/A', s:f.roe>0.15?'good':f.roe>0.08?'neutral':'bad' },
        { l:'Profit Margin', v:f.profitMargin?(f.profitMargin*100).toFixed(2)+'%':'N/A', s:f.profitMargin>0.1?'good':f.profitMargin>0?'neutral':'bad' },
        { l:'Debt/Equity', v:f.debtToEquity?f.debtToEquity.toFixed(2):'N/A', s:f.debtToEquity<100?'good':f.debtToEquity<200?'neutral':'bad' },
        { l:'Current Ratio', v:f.currentRatio?f.currentRatio.toFixed(2):'N/A', s:f.currentRatio>1.5?'good':f.currentRatio>1?'neutral':'bad' },
        { l:'Revenue Growth', v:f.revenueGrowth?(f.revenueGrowth*100).toFixed(2)+'%':'N/A', s:f.revenueGrowth>0.1?'good':f.revenueGrowth>0?'neutral':'bad' },
        { l:'Earnings Growth', v:f.earningsGrowth?(f.earningsGrowth*100).toFixed(2)+'%':'N/A', s:f.earningsGrowth>0.1?'good':f.earningsGrowth>0?'neutral':'bad' },
        { l:'Beta', v:f.beta?f.beta.toFixed(2):'N/A', s:f.beta>=0.8&&f.beta<=1.3?'good':'neutral' },
        { l:'Analyst Target', v:f.targetPrice?fmtCur(f.targetPrice,cs):'N/A', s:'neutral' },
    ].map(x=>`<div class="fundamental-row"><span class="label">${x.l}</span><span class="value">${x.v}</span><span class="status ${x.s}">${x.s==='good'?'Good':x.s==='bad'?'Weak':'Fair'}</span></div>`).join('');
}
function renderCompany(summary, meta, symbol, cs, f) {
    const el = document.getElementById('companyProfile');
    const sp = summary.summaryProfile || summary.assetProfile || {};
    const pr = summary.price || {};
    const name = vs(pr.longName)||vs(pr.shortName)||meta.longName||symbol;
    const sector = sp.sector||vs(pr.sector)||'N/A';
    const industry = sp.industry||vs(pr.industry)||'N/A';
    const desc = sp.longBusinessSummary||'';
    const website = sp.website||'';
    const employees = sp.fullTimeEmployees||0;
    const country = sp.country||'N/A';
    const exchange = meta.fullExchangeName||meta.exchangeName||'';
    el.innerHTML = `<div class="company-info">
        <div class="company-header"><div class="company-logo">${symbol.replace(/\..+/,'').substring(0,2)}</div>
        <div class="company-name-sector"><h4>${name}</h4><span>${sector} | ${industry}</span></div></div>
        ${desc?`<p class="company-desc">${desc.substring(0,300)}${desc.length>300?'...':''}</p>`:''}
        <div class="company-meta">
            <div class="meta-item"><span class="label">Market Cap</span><span class="value">${fmtMC(f.marketCap,cs)}</span></div>
            <div class="meta-item"><span class="label">Exchange</span><span class="value">${exchange}</span></div>
            <div class="meta-item"><span class="label">52W High</span><span class="value">${fmtCur(f.fiftyTwoWeekHigh,cs)}</span></div>
            <div class="meta-item"><span class="label">52W Low</span><span class="value">${fmtCur(f.fiftyTwoWeekLow,cs)}</span></div>
            <div class="meta-item"><span class="label">Employees</span><span class="value">${employees?parseInt(employees).toLocaleString():'N/A'}</span></div>
            <div class="meta-item"><span class="label">Country</span><span class="value">${country}</span></div>
        </div>
        ${website?`<a href="${website}" target="_blank" style="color:var(--accent-blue);font-size:12px;margin-top:8px;display:inline-block"><i class="fas fa-external-link-alt"></i> ${website}</a>`:''}</div>`;
}
function renderDividend(a, cs, price, currency) {
    const f = a.fundamentals, isINR = currency === 'INR';
    const amounts = isINR ? [100000, 500000, 1000000] : [10000, 50000, 100000];
    document.getElementById('dividendInfo').innerHTML = `<div class="dividend-grid">
        <div class="dividend-row"><span class="label">Dividend/Share</span><span class="value">${f.divRate>0?fmtCur(f.divRate,cs):'No Dividend'}</span></div>
        <div class="dividend-row"><span class="label">Dividend Yield</span><span class="value">${(f.divYield*100).toFixed(2)}%</span></div>
        <div class="dividend-row"><span class="label">Payout Ratio</span><span class="value">${(f.payoutRatio*100).toFixed(1)}%</span></div>
        ${amounts.map(amt=>{const sh=price>0?Math.floor(amt/price):0;const inc=sh*f.divRate;
        return `<div class="dividend-row"><span class="label">Invest ${cs}${amt.toLocaleString(isINR?'en-IN':undefined)}</span><span class="value">${sh} shares = ${cs}${inc.toFixed(2)}/yr</span></div>`;}).join('')}
    </div>`;
}
async function renderWorldMarketSection() {
    const el = document.getElementById('marketGrid');
    const indices = [
        {s:'^NSEI',n:'Nifty 50',r:'India'},{s:'^BSESN',n:'Sensex',r:'India'},
        {s:'^GSPC',n:'S&P 500',r:'US'},{s:'^IXIC',n:'NASDAQ',r:'US'},
        {s:'^DJI',n:'Dow Jones',r:'US'},{s:'^FTSE',n:'FTSE 100',r:'UK'},
        {s:'^N225',n:'Nikkei',r:'Japan'},{s:'^HSI',n:'Hang Seng',r:'China'}];
    try {
        const results = await Promise.allSettled(indices.map(i=>apiGet('chart',{symbol:i.s,range:'5d',interval:'1d'})));
        el.innerHTML = results.map((r,i)=>{
            if (r.status!=='fulfilled'||!r.value.chart?.result?.[0]) return '';
            const m=r.value.chart.result[0].meta;const cls=r.value.chart.result[0].indicators?.quote?.[0]?.close||[];
            const vc=cls.filter(c=>c!=null);const lt=vc[vc.length-1]||m.regularMarketPrice||0;
            const pv=vc[vc.length-2]||lt;const ch=pv>0?((lt-pv)/pv*100).toFixed(2):'0.00';const up=parseFloat(ch)>=0;
            return `<div class="market-item"><span class="name">${indices[i].n} <small style="color:var(--text-muted)">(${indices[i].r})</small></span>
            <span class="price">${fmtNum(lt)}</span><span class="change ${up?'up':'down'}">${up?'+':''}${ch}%</span></div>`;
        }).join('')||'<p class="placeholder-text">Market data unavailable</p>';
    } catch { el.innerHTML = '<p class="placeholder-text">Market data unavailable</p>'; }
}
function renderHold(a) {
    const el=document.getElementById('holdDuration');const f=a.fundamentals;let reasons=[];
    if(a.holdClass==='long'){reasons.push('Strong fundamentals support long-term accumulation.');if(f.revenueGrowth>0.1)reasons.push('Revenue growing at '+(f.revenueGrowth*100).toFixed(1)+'%.');if(f.roe>0.15)reasons.push('ROE of '+(f.roe*100).toFixed(1)+'% shows efficient capital usage.');reasons.push('Consider SIP approach for best average price.');}
    else if(a.holdClass==='medium'){reasons.push('Mixed signals - medium-term watch position.');reasons.push('Set trailing stop-loss at 8-10%.');reasons.push('Reassess after next quarterly results.');}
    else{reasons.push('Weak indicators suggest caution.');reasons.push('Set tight stop-loss at 5% below CMP.');reasons.push('Wait for reversal before fresh entry.');}
    el.innerHTML=`<div class="hold-info"><div class="hold-badge ${a.holdClass}">${a.holdPeriod}</div><p class="hold-reason">${reasons.join('<br>')}</p></div>`;
}
function renderReport(symbol,latest,name,a,cs,currency,insights) {
    const el=document.getElementById('aiReport');const i=a.indicators;const f=a.fundamentals;const c=a.changes;
    const isINR=currency==='INR';const trend=a.score>=55?'Uptrend':a.score<=45?'Downtrend':'Sideways';
    const insightTech=insights.instrumentInfo?.technicalEvents||{};
    const shortOutlook=insightTech.shortTermOutlook?.stateDescription||'';
    const midOutlook=insightTech.intermediateTermOutlook?.stateDescription||'';
    const longOutlook=insightTech.longTermOutlook?.stateDescription||'';
    el.innerHTML=`
    <div class="report-section" style="border-left-color:${a.score>=50?'var(--accent-green)':a.score>=40?'var(--accent-yellow)':'var(--accent-red)'}">
        <h4><i class="fas fa-gavel" style="color:var(--accent-purple)"></i> Final Verdict: ${a.verdict} - ${a.action}</h4>
        <p>${name} scores <strong>${a.score}/100</strong> (Tech:${a.techScore} | Fund:${a.fundScore}). Currently in <strong>${trend}</strong>.
        ${f.targetPrice>0?`Analyst target: ${cs}${f.targetPrice.toFixed(2)} (${((f.targetPrice-latest.close)/latest.close*100).toFixed(1)}% ${f.targetPrice>latest.close?'upside':'downside'}).`:''}</p>
        ${shortOutlook?`<p style="margin-top:8px"><strong>Trading Central:</strong> Short-term: ${shortOutlook} | Mid-term: ${midOutlook} | Long-term: ${longOutlook}</p>`:''}
    </div>
    <div class="report-section"><h4><i class="fas fa-chart-line" style="color:var(--accent-blue)"></i> Technical Summary</h4><ul>
        <li>RSI ${i.rsi.toFixed(1)} - ${i.rsi<30?'OVERSOLD (Buy signal)':i.rsi>70?'OVERBOUGHT (Caution)':i.rsi<45?'Approaching oversold':'Normal range'}</li>
        <li>Price ${latest.close>i.sma200?'ABOVE':'BELOW'} 200-SMA (${cs}${i.sma200.toFixed(2)}) - ${latest.close>i.sma200?'Long-term BULLISH':'Long-term BEARISH'}</li>
        <li>${i.sma50>i.sma200?'GOLDEN CROSS (50>200 SMA) - Bullish':'DEATH CROSS (50<200 SMA) - Bearish'}</li>
        <li>MACD: ${i.macdLine>0?'Positive (bullish momentum)':'Negative (bearish momentum)'}</li>
        <li>Bollinger: ${cs}${i.bollingerLower.toFixed(2)} - ${cs}${i.bollingerUpper.toFixed(2)} ${latest.close<i.bollingerLower?'(BELOW - potential bounce)':latest.close>i.bollingerUpper?'(ABOVE - overextended)':'(Within bands)'}</li>
        <li>Volume: ${i.volumeRatio.toFixed(2)}x avg - ${i.volumeRatio>1.5?'High activity':i.volumeRatio<0.5?'Low activity':'Normal'}</li></ul></div>
    <div class="report-section"><h4><i class="fas fa-building" style="color:var(--accent-green)"></i> Fundamental Health</h4><ul>
        <li>P/E: ${f.pe?f.pe.toFixed(2):'N/A'} ${f.forwardPE?'(Forward:'+f.forwardPE.toFixed(2)+')':''} - ${f.pe>0&&f.pe<20?'Attractive':f.pe<30?'Fair':f.pe>35?'Premium':'Check'}</li>
        <li>EPS: ${f.eps?cs+f.eps.toFixed(2):'N/A'} - ${f.eps>0?'PROFITABLE':'NOT profitable'}</li>
        <li>ROE: ${f.roe?(f.roe*100).toFixed(2)+'%':'N/A'} - ${f.roe>0.20?'EXCELLENT':f.roe>0.15?'Good':f.roe>0.10?'Average':'Below avg'}</li>
        <li>Debt/Equity: ${f.debtToEquity?f.debtToEquity.toFixed(2):'N/A'} - ${f.debtToEquity<50?'Very healthy':f.debtToEquity<100?'Manageable':f.debtToEquity<200?'High leverage':'Risky'}</li>
        <li>Profit Margin: ${f.profitMargin?(f.profitMargin*100).toFixed(2)+'%':'N/A'} | Revenue Growth: ${f.revenueGrowth?(f.revenueGrowth*100).toFixed(2)+'%':'N/A'}</li>
        <li>Free Cash Flow: ${f.freeCashflow?fmtMC(f.freeCashflow,cs):'N/A'} | Total Cash: ${f.totalCash?fmtMC(f.totalCash,cs):'N/A'}</li></ul></div>
    <div class="report-section"><h4><i class="fas fa-coins" style="color:var(--accent-yellow)"></i> Dividend & Income</h4><ul>
        <li>Yield: ${f.divYield?(f.divYield*100).toFixed(2)+'%':'0%'} | Per Share: ${f.divRate?cs+f.divRate.toFixed(2):'N/A'} | Payout: ${f.payoutRatio?(f.payoutRatio*100).toFixed(1)+'%':'N/A'}</li>
        <li>${f.divYield>0.03?'STRONG dividend - excellent passive income':f.divYield>0.01?'Moderate dividend':f.divRate>0?'Small dividend':'Growth stock - returns via price appreciation'}</li>
        <li>Invest ${cs}${isINR?'1,00,000':'10,000'}: ~${cs}${((isINR?100000:10000)*(f.divYield||0)).toFixed(2)}/year dividend</li>
        <li>Invest ${cs}${isINR?'5,00,000':'50,000'}: ~${cs}${((isINR?500000:50000)*(f.divYield||0)).toFixed(2)}/year dividend</li></ul></div>
    <div class="report-section"><h4><i class="fas fa-wallet" style="color:var(--accent-cyan)"></i> How Much to Invest</h4><ul>
        <li>Recommended: <strong>${a.investPct}</strong> of portfolio</li>
        <li>${a.investReason}</li>
        <li>Beta: ${f.beta?f.beta.toFixed(2):'1.00'} - ${f.beta>1.5?'Very high volatility':f.beta>1.2?'Above avg volatility':f.beta<0.7?'Defensive stock':'Avg volatility'}</li>
        ${isINR?`<li>For ₹5L portfolio: ₹${a.investPct.includes('0%')?'0':((parseInt(a.investPct)||5)*5000).toLocaleString('en-IN')} - ₹${((parseInt(a.investPct.split('-')[1]||a.investPct)||5)*5000).toLocaleString('en-IN')}</li>
        <li>For ₹10L portfolio: ₹${a.investPct.includes('0%')?'0':((parseInt(a.investPct)||5)*10000).toLocaleString('en-IN')} - ₹${((parseInt(a.investPct.split('-')[1]||a.investPct)||5)*10000).toLocaleString('en-IN')}</li>`
        :`<li>For $50K: $${a.investPct.includes('0%')?'0':((parseInt(a.investPct)||5)*500).toLocaleString()} - $${((parseInt(a.investPct.split('-')[1]||a.investPct)||5)*500).toLocaleString()}</li>`}</ul></div>
    <div class="report-section"><h4><i class="fas fa-clock" style="color:var(--accent-purple)"></i> Holding & Performance</h4><ul>
        <li>Hold: <strong>${a.holdPeriod}</strong></li>
        <li>Day ${c.dayChange>=0?'+':''}${c.dayChange.toFixed(2)}% | Week ${c.weekChange>=0?'+':''}${c.weekChange.toFixed(2)}% | Month ${c.monthChange>=0?'+':''}${c.monthChange.toFixed(2)}%</li>
        <li>3M ${c.threeMonthChange>=0?'+':''}${c.threeMonthChange.toFixed(2)}% | 6M ${c.sixMonthChange>=0?'+':''}${c.sixMonthChange.toFixed(2)}% | 1Y ${c.yearChange>=0?'+':''}${c.yearChange.toFixed(2)}%</li>
        <li>52W: ${cs}${f.fiftyTwoWeekLow.toFixed(2)} - ${cs}${f.fiftyTwoWeekHigh.toFixed(2)}</li>
        <li>${a.score>=60?'SIP recommended for best average price':a.score>=45?'Wait for dips to accumulate':'Avoid fresh entry - wait for reversal'}</li></ul></div>`;
}

// ===== Utilities =====
// ===== Beginner Mode Renderer =====
function renderBeginner(symbol, prices, summary, meta, analysis, cs, currency, insights) {
    const latest = prices[0], prev = prices[1] || latest;
    const change = latest.close - prev.close;
    const changePct = prev.close > 0 ? (change / prev.close * 100) : 0;
    const f = analysis.fundamentals;
    const sp = summary.summaryProfile || summary.assetProfile || {};
    const pr = summary.price || {};
    const name = vs(pr.longName) || vs(pr.shortName) || meta.longName || symbol;
    const isINR = currency === 'INR';
    const score = analysis.score;

    // Verdict card
    const vc = document.getElementById('bVerdictCard');
    const isBull = score >= 55, isBear = score < 40;
    vc.className = `b-verdict-card ${isBear ? 'bearish' : isBull ? 'bullish' : 'neutral'}`;

    // Emoji
    let emoji, labelText, labelClass, desc;
    if (score >= 70) {
        emoji = '<i class="fas fa-rocket" style="color:var(--accent-green)"></i>';
        labelText = 'GREAT STOCK - BUY'; labelClass = 'buy';
        desc = 'This stock looks strong! The company is doing well financially and the price trend is positive. Good for long-term investment.';
    } else if (score >= 55) {
        emoji = '<i class="fas fa-thumbs-up" style="color:var(--accent-green)"></i>';
        labelText = 'GOOD - CONSIDER BUYING'; labelClass = 'buy';
        desc = 'This stock has more positives than negatives. You can consider buying it, but start with a small amount first.';
    } else if (score >= 45) {
        emoji = '<i class="fas fa-hand-paper" style="color:var(--accent-yellow)"></i>';
        labelText = 'AVERAGE - WAIT & WATCH'; labelClass = 'hold';
        desc = 'This stock is neither great nor bad right now. If you already own it, hold. If not, wait for a better price before buying.';
    } else if (score >= 35) {
        emoji = '<i class="fas fa-exclamation-triangle" style="color:var(--accent-yellow)"></i>';
        labelText = 'RISKY - BE CAREFUL'; labelClass = 'hold';
        desc = 'This stock has some warning signs. Not the best time to buy. If you own it, consider setting a stop-loss to protect your money.';
    } else {
        emoji = '<i class="fas fa-times-circle" style="color:var(--accent-red)"></i>';
        labelText = 'AVOID - DON\'T BUY'; labelClass = 'sell';
        desc = 'This stock is showing weak signals. The company or price trend has problems. Better to keep your money safe and look at other stocks.';
    }

    document.getElementById('bEmoji').innerHTML = emoji;
    document.getElementById('bStockName').textContent = name;
    document.getElementById('bPrice').innerHTML = `${fmtCur(latest.close, cs)} <span style="font-size:18px;color:${change>=0?'var(--accent-green)':'var(--accent-red)'}">${change>=0?'+':''}${changePct.toFixed(2)}%</span>`;
    const vl = document.getElementById('bVerdictLabel');
    vl.textContent = labelText;
    vl.className = `b-verdict-label ${labelClass}`;
    document.getElementById('bVerdictDesc').textContent = desc;

    // Should I Buy?
    const buyCard = document.getElementById('bShouldBuy');
    if (score >= 55) {
        buyCard.className = 'b-card good';
        document.getElementById('bBuyAnswer').textContent = `Yes, this looks like a good buy! The company is financially healthy with a score of ${score}/100. Start with a small amount through SIP (monthly buying).`;
    } else if (score >= 45) {
        buyCard.className = 'b-card warn';
        document.getElementById('bBuyAnswer').textContent = `Not right now. The stock scores ${score}/100 which means it's average. Wait for the price to drop or for the company to show better results.`;
    } else {
        buyCard.className = 'b-card bad';
        document.getElementById('bBuyAnswer').textContent = `No, avoid buying this stock right now. It scores only ${score}/100. There are better stocks to invest your money in.`;
    }

    // How Long to Hold?
    const holdCard = document.getElementById('bHowLong');
    holdCard.className = `b-card ${analysis.holdClass === 'long' ? 'good' : analysis.holdClass === 'medium' ? 'warn' : 'bad'}`;
    let holdText;
    if (analysis.holdClass === 'long') holdText = `This is a good long-term stock. Hold for ${analysis.holdPeriod}. The company has strong basics and should grow over time. Be patient!`;
    else if (analysis.holdClass === 'medium') holdText = `Hold for ${analysis.holdPeriod}. Check the company's results every 3 months. If things get worse, consider selling. Set a stop-loss at 8-10%.`;
    else holdText = `If you own this stock, think about selling soon. The signals are weak. If you don't own it, stay away for now.`;
    document.getElementById('bHoldAnswer').textContent = holdText;

    // How Much to Invest?
    const investCard = document.getElementById('bHowMuch');
    investCard.className = `b-card ${score >= 55 ? 'good' : score >= 40 ? 'warn' : 'bad'}`;
    let investText;
    if (isINR) {
        if (score >= 60) investText = `You can invest ${analysis.investPct} of your savings. Example: If you have ₹5 Lakh to invest, put ₹${((parseInt(analysis.investPct)||10)*5000).toLocaleString('en-IN')} to ₹${((parseInt(analysis.investPct.split('-')[1]||analysis.investPct)||15)*5000).toLocaleString('en-IN')} in this stock. Use SIP for better results.`;
        else if (score >= 45) investText = `Only put a small amount - ${analysis.investPct} of your savings. Example: If you have ₹5 Lakh, invest only ₹${((parseInt(analysis.investPct)||5)*5000).toLocaleString('en-IN')} maximum. Don't put all your eggs in one basket!`;
        else investText = `Don't invest in this stock right now. Keep your money in safer options like FD or better-rated stocks.`;
    } else {
        investText = `Allocate ${analysis.investPct} of your portfolio. ${analysis.investReason}`;
    }
    document.getElementById('bInvestAnswer').textContent = investText;

    // Dividends
    const divCard = document.getElementById('bDividend');
    if (f.divRate > 0) {
        divCard.className = 'b-card good';
        const annualPer1L = Math.floor((isINR ? 100000 : 10000) / latest.close) * f.divRate;
        document.getElementById('bDivAnswer').textContent = `Yes! This company pays ${cs}${f.divRate.toFixed(2)} per share as dividend every year (${(f.divYield*100).toFixed(2)}% yield). If you invest ${cs}${isINR?'1,00,000':'10,000'}, you'll get about ${cs}${annualPer1L.toFixed(0)} per year as passive income.`;
    } else {
        divCard.className = 'b-card warn';
        document.getElementById('bDivAnswer').textContent = `This company doesn't pay regular dividends. Your returns will come from the stock price going up. This is normal for growth companies.`;
    }

    // Health Check
    const healthItems = [];
    const addHealth = (label, value, status, icon) => healthItems.push({ label, value, status, icon });

    if (f.pe > 0) addHealth('Is it expensive?', f.pe < 20 ? `No, reasonably priced (P/E: ${f.pe.toFixed(1)})` : f.pe < 35 ? `Somewhat (P/E: ${f.pe.toFixed(1)})` : `Yes, quite expensive (P/E: ${f.pe.toFixed(1)})`, f.pe < 25 ? 'good' : f.pe < 35 ? 'ok' : 'bad', f.pe < 25 ? 'fa-check' : f.pe < 35 ? 'fa-minus' : 'fa-times');
    if (f.eps) addHealth('Is it profitable?', f.eps > 0 ? `Yes, earning ${cs}${f.eps.toFixed(2)} per share` : 'No, making losses', f.eps > 0 ? 'good' : 'bad', f.eps > 0 ? 'fa-check' : 'fa-times');
    if (f.roe) addHealth('Using money well?', f.roe > 0.15 ? `Excellent (ROE: ${(f.roe*100).toFixed(1)}%)` : f.roe > 0.08 ? `Decent (ROE: ${(f.roe*100).toFixed(1)}%)` : `Poor (ROE: ${(f.roe*100).toFixed(1)}%)`, f.roe > 0.15 ? 'good' : f.roe > 0.08 ? 'ok' : 'bad', f.roe > 0.15 ? 'fa-check' : 'fa-minus');
    if (f.debtToEquity) addHealth('Too much debt?', f.debtToEquity < 50 ? `No, very healthy (${f.debtToEquity.toFixed(0)}%)` : f.debtToEquity < 150 ? `Some debt (${f.debtToEquity.toFixed(0)}%)` : `High debt (${f.debtToEquity.toFixed(0)}%)`, f.debtToEquity < 100 ? 'good' : f.debtToEquity < 200 ? 'ok' : 'bad', f.debtToEquity < 100 ? 'fa-check' : 'fa-minus');
    if (f.revenueGrowth) addHealth('Sales growing?', f.revenueGrowth > 0.1 ? `Yes, ${(f.revenueGrowth*100).toFixed(1)}% growth` : f.revenueGrowth > 0 ? `Slowly, ${(f.revenueGrowth*100).toFixed(1)}%` : `No, declining ${(f.revenueGrowth*100).toFixed(1)}%`, f.revenueGrowth > 0.05 ? 'good' : f.revenueGrowth > 0 ? 'ok' : 'bad', f.revenueGrowth > 0.05 ? 'fa-check' : 'fa-minus');
    if (f.profitMargin) addHealth('Good profit margins?', f.profitMargin > 0.15 ? `Great (${(f.profitMargin*100).toFixed(1)}%)` : f.profitMargin > 0.05 ? `Okay (${(f.profitMargin*100).toFixed(1)}%)` : `Thin (${(f.profitMargin*100).toFixed(1)}%)`, f.profitMargin > 0.1 ? 'good' : f.profitMargin > 0 ? 'ok' : 'bad', f.profitMargin > 0.1 ? 'fa-check' : 'fa-minus');

    document.getElementById('bHealthGrid').innerHTML = healthItems.map(h => `
        <div class="b-health-item">
            <div class="b-health-icon ${h.status}"><i class="fas ${h.icon}"></i></div>
            <div class="b-health-info"><span class="label">${h.label}</span><span class="value">${h.value}</span></div>
        </div>
    `).join('');

    // Chart
    renderBeginnerChart(prices.slice(0, 120).reverse(), cs);

    // About
    const desc2 = sp.longBusinessSummary || '';
    const sector = sp.sector || '';
    const industry = sp.industry || '';
    document.getElementById('bAboutText').innerHTML = `<strong>${name}</strong>${sector ? ` is a <strong>${sector}</strong> company` : ''}${industry ? ` in the <strong>${industry}</strong> industry` : ''}. ${desc2 ? desc2.substring(0, 250) + (desc2.length > 250 ? '...' : '') : 'Company description not available.'}`;

    // Summary in plain language
    const c = analysis.changes;
    const points = [];
    points.push({ icon: score >= 50 ? 'green' : score >= 40 ? 'yellow' : 'red', text: `Overall Score: <strong>${score}/100</strong> - ${score >= 70 ? 'Very strong stock' : score >= 55 ? 'Above average stock' : score >= 45 ? 'Average stock' : score >= 35 ? 'Below average' : 'Weak stock'}` });
    points.push({ icon: c.yearChange >= 10 ? 'green' : c.yearChange >= 0 ? 'yellow' : 'red', text: `In the last 1 year, this stock has ${c.yearChange >= 0 ? 'gone UP' : 'gone DOWN'} by <strong>${Math.abs(c.yearChange).toFixed(1)}%</strong>. ${c.yearChange > 15 ? 'Great performance!' : c.yearChange > 0 ? 'Decent performance.' : 'Not good.'}` });
    points.push({ icon: 'blue', text: `Current price is ${cs}${latest.close.toFixed(2)}. The lowest it went in 52 weeks was ${cs}${f.fiftyTwoWeekLow.toFixed(2)} and highest was ${cs}${f.fiftyTwoWeekHigh.toFixed(2)}.` });
    if (f.targetPrice > 0) {
        const upside = ((f.targetPrice - latest.close) / latest.close * 100);
        points.push({ icon: upside > 0 ? 'green' : 'red', text: `Stock market experts think this stock should be at ${cs}${f.targetPrice.toFixed(2)}, which is <strong>${upside > 0 ? '+' : ''}${upside.toFixed(1)}%</strong> from current price.` });
    }
    if (f.divRate > 0) points.push({ icon: 'green', text: `This company shares its profits with you through dividends of ${cs}${f.divRate.toFixed(2)} per share every year.` });
    points.push({ icon: 'blue', text: `<strong>Tip:</strong> ${score >= 55 ? 'Consider SIP (investing a fixed amount monthly) instead of putting all money at once. This reduces risk.' : 'Don\'t invest money you can\'t afford to lose. Always keep an emergency fund separate.'}` });

    document.getElementById('bSummaryText').innerHTML = points.map(p => `
        <div class="point">
            <div class="point-icon ${p.icon}"><i class="fas fa-circle"></i></div>
            <div>${p.text}</div>
        </div>
    `).join('');
}

function renderBeginnerChart(prices, cs) {
    const ctx = document.getElementById('bPriceChart').getContext('2d');
    if (beginnerChart) beginnerChart.destroy();
    beginnerChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: prices.map(p => p.date),
            datasets: [{
                label: 'Stock Price',
                data: prices.map(p => p.close),
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59,130,246,0.08)',
                borderWidth: 2.5,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHitRadius: 10,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: '#1a1f2e', borderColor: '#2a3042', borderWidth: 1, titleColor: '#f0f2f5', bodyColor: '#8b95a5',
                    callbacks: { label: c => `Price: ${cs}${c.raw.toLocaleString(undefined, {minimumFractionDigits:2})}` }
                },
            },
            scales: {
                x: { ticks: { color: '#5a6377', maxTicksLimit: 6, font: { size: 11 } }, grid: { color: 'rgba(42,48,66,0.2)' } },
                y: { ticks: { color: '#5a6377', font: { size: 11 } }, grid: { color: 'rgba(42,48,66,0.2)' } },
            },
        },
    });
}

// ===== News Renderers =====
function renderNewsBeginnerMode(news, analysis) {
    const el = document.getElementById('bNewsVerdict');
    const grid = document.getElementById('bNewsGrid');
    const c = news.combined || {};
    const sent = c.sentiment || 'neutral';

    // Verdict
    let verdictText;
    if (sent === 'bullish') verdictText = `<strong><i class="fas fa-thumbs-up"></i> Good News!</strong> Recent news about this stock and the market is mostly positive. This supports buying.`;
    else if (sent === 'bearish') verdictText = `<strong><i class="fas fa-exclamation-triangle"></i> Caution!</strong> Recent news is mostly negative - there may be risks. Wait for things to settle before buying.`;
    else verdictText = `<strong><i class="fas fa-info-circle"></i> Mixed News</strong> - News sentiment is neutral. No strong signal from news to buy or sell right now.`;
    verdictText += `<br><small>Best time to buy? <strong>${c.bestTimeToBuy || 'No strong signal'}</strong></small>`;
    el.className = `b-news-verdict ${sent}`;
    el.innerHTML = verdictText;

    // News items
    const allItems = [...(news.stock?.items||[]), ...(news.market?.items||[]).slice(0,3), ...(news.world?.items||[]).slice(0,2)];
    grid.innerHTML = allItems.slice(0, 8).map(item => `
        <div class="b-news-item">
            <div class="b-news-dot ${item.sentiment}"></div>
            <div>
                <a href="${item.link}" target="_blank" rel="noopener">${item.title}</a>
                ${item.source ? `<div class="b-news-source">${item.source}</div>` : ''}
            </div>
        </div>
    `).join('') || '<p style="color:var(--text-muted);text-align:center;padding:12px">No recent news found</p>';
}

function renderNewsProMode(news) {
    const bar = document.getElementById('newsSentimentBar');
    const grid = document.getElementById('newsGridPro');
    const c = news.combined || {};

    // Sentiment badges
    bar.innerHTML = `
        <div class="sentiment-badge ${news.stock?.sentiment||'neutral'}"><i class="fas fa-circle"></i> Stock: ${news.stock?.sentiment?.toUpperCase()||'N/A'} (${news.stock?.score||0})</div>
        <div class="sentiment-badge ${news.market?.sentiment||'neutral'}"><i class="fas fa-circle"></i> Market: ${news.market?.sentiment?.toUpperCase()||'N/A'} (${news.market?.score||0})</div>
        <div class="sentiment-badge ${news.world?.sentiment||'neutral'}"><i class="fas fa-circle"></i> World: ${news.world?.sentiment?.toUpperCase()||'N/A'} (${news.world?.score||0})</div>
        <div class="sentiment-badge ${c.sentiment||'neutral'}"><i class="fas fa-bolt"></i> Combined: ${c.score||0} | ${c.bestTimeToBuy||'N/A'}</div>
    `;

    const renderCol = (title, items) => {
        const rows = (items||[]).slice(0,5).map(i => `
            <div class="news-pro-item">
                <a href="${i.link}" target="_blank" rel="noopener">${i.title}</a>
                ${i.sentiment !== 'neutral' ? `<span class="tag ${i.sentiment}">${i.sentiment === 'bullish' ? 'BULL' : 'BEAR'}</span>` : ''}
                ${i.source ? `<div class="src">${i.source}</div>` : ''}
            </div>
        `).join('');
        return `<div class="news-column"><h4>${title}</h4>${rows || '<p style="color:var(--text-muted);font-size:12px">No news</p>'}</div>`;
    };

    grid.innerHTML = renderCol('Stock News', news.stock?.items) + renderCol('Market News', news.market?.items) + renderCol('World Events', news.world?.items);
}

// ===== Utilities =====
function showLoading(s){document.getElementById('loadingOverlay').classList.toggle('hidden',!s);}
function updateProgress(t,p){document.getElementById('loadingStep').textContent=t;document.getElementById('progressFill').style.width=p+'%';}
function showToast(m,type='error'){document.querySelectorAll('.error-toast').forEach(e=>e.remove());const t=document.createElement('div');t.className='error-toast'+(type==='success'?' toast-success':'');t.textContent=m;document.body.appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity 0.25s ease';setTimeout(()=>t.remove(),250);},4000);}
