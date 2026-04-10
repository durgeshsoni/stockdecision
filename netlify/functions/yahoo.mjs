// Netlify Serverless Function - Yahoo Finance + News Proxy
// Handles: chart, fundamentals, insights, news

const HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300',
};

async function yahooGet(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        redirect: 'follow',
    });
    return { status: res.status, text: await res.text() };
}

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

// Parse Google News RSS XML into JSON
function parseGoogleNewsRSS(xml) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
        const item = match[1];
        const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'") || '';
        const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
        const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
        const source = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || '';
        if (title && title !== 'Google News') {
            items.push({ title, link, pubDate, source });
        }
    }
    return items;
}

// Simple keyword-based sentiment analysis
function analyzeSentiment(newsItems) {
    const bullish = ['buy','upgrade','bullish','surge','jump','rally','soar','gain','profit','growth','beat','strong','positive','upside','target','outperform','record high','breakout','recovery','boom','optimistic'];
    const bearish = ['sell','downgrade','bearish','crash','fall','drop','decline','loss','weak','negative','downside','underperform','warning','risk','war','tension','sanction','inflation','recession','crisis','slump','fear','concern','plunge','dump','worst','layoff','fraud','scam'];
    const neutral = ['hold','mixed','flat','steady','unchanged','stable'];

    let bullCount = 0, bearCount = 0, neutralCount = 0;
    const analyzed = newsItems.map(item => {
        const text = (item.title || '').toLowerCase();
        let sentiment = 'neutral';
        let score = 0;
        for (const w of bullish) { if (text.includes(w)) { score += 1; } }
        for (const w of bearish) { if (text.includes(w)) { score -= 1; } }
        if (score > 0) { sentiment = 'bullish'; bullCount++; }
        else if (score < 0) { sentiment = 'bearish'; bearCount++; }
        else { neutralCount++; }
        return { ...item, sentiment, score };
    });

    const total = analyzed.length || 1;
    const overallScore = ((bullCount - bearCount) / total) * 100; // -100 to +100
    const overallSentiment = overallScore > 20 ? 'bullish' : overallScore < -20 ? 'bearish' : 'neutral';

    return {
        items: analyzed,
        summary: { bullish: bullCount, bearish: bearCount, neutral: neutralCount, total: analyzed.length },
        overallScore: Math.round(overallScore),
        overallSentiment,
    };
}

export default async (req) => {
    const url = new URL(req.url);
    const type = url.searchParams.get('type');
    const symbol = url.searchParams.get('symbol');

    if (!symbol && !['news', 'stockofday', 'screener'].includes(type)) return new Response(JSON.stringify({ error: 'symbol required' }), { status: 400, headers: HEADERS });

    try {
        // CHART
        if (type === 'chart') {
            const range = url.searchParams.get('range') || '1y';
            const interval = url.searchParams.get('interval') || '1d';
            let r = await yahooGet(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
            if (r.status === 429) r = await yahooGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
            if (r.status === 429) return new Response(JSON.stringify({ error: 'Yahoo rate limit. Try again in 1 min.' }), { status: 429, headers: HEADERS });
            return new Response(r.text, { status: 200, headers: HEADERS });
        }

        // FUNDAMENTALS
        if (type === 'fundamentals') {
            const r = await yahooGet(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`);
            const summary = extractQuoteSummary(r.text);
            return new Response(JSON.stringify(summary || {}), { status: 200, headers: HEADERS });
        }

        // INSIGHTS
        if (type === 'insights') {
            const r = await yahooGet(`https://query2.finance.yahoo.com/ws/insights/v2/finance/insights?symbol=${encodeURIComponent(symbol)}`);
            return new Response(r.text, { status: 200, headers: HEADERS });
        }

        // NEWS - Fetches stock-specific + market + world news
        if (type === 'news') {
            const companyName = url.searchParams.get('name') || symbol;
            const isIndian = symbol?.endsWith('.NS') || symbol?.endsWith('.BO');

            // Fetch multiple news sources in parallel
            const fetches = [];

            // 1. Stock-specific news from Yahoo search
            if (symbol) {
                fetches.push(
                    yahooGet(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=6&quotesCount=0`)
                        .then(r => { try { return JSON.parse(r.text).news || []; } catch { return []; } })
                        .catch(() => [])
                );
            } else {
                fetches.push(Promise.resolve([]));
            }

            // 2. Company-specific news from Google News
            const cleanName = companyName.replace(/\.NS|\.BO/g, '').replace(/Ltd\.?|Inc\.?|Corp\.?|Limited/gi, '').trim();
            fetches.push(
                yahooGet(`https://news.google.com/rss/search?q=${encodeURIComponent(cleanName + ' stock')}&hl=en-IN&gl=IN&ceid=IN:en`)
                    .then(r => parseGoogleNewsRSS(r.text))
                    .catch(() => [])
            );

            // 3. Market news (India focused if Indian stock)
            const marketQuery = isIndian ? 'Indian stock market Nifty Sensex today' : 'stock market today US';
            fetches.push(
                yahooGet(`https://news.google.com/rss/search?q=${encodeURIComponent(marketQuery)}&hl=en-IN&gl=IN&ceid=IN:en`)
                    .then(r => parseGoogleNewsRSS(r.text))
                    .catch(() => [])
            );

            // 4. World events / geopolitics affecting markets
            fetches.push(
                yahooGet(`https://news.google.com/rss/search?q=${encodeURIComponent('world economy trade war geopolitics market impact')}&hl=en&gl=US&ceid=US:en`)
                    .then(r => parseGoogleNewsRSS(r.text))
                    .catch(() => [])
            );

            const [yahooNews, companyNews, marketNews, worldNews] = await Promise.all(fetches);

            // Normalize Yahoo news format
            const normalizedYahoo = (yahooNews || []).map(n => ({
                title: n.title || '',
                link: n.link || '',
                source: n.publisher || '',
                pubDate: n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toUTCString() : '',
            }));

            // Analyze sentiment for each category
            const stockSentiment = analyzeSentiment([...normalizedYahoo, ...companyNews]);
            const marketSentiment = analyzeSentiment(marketNews);
            const worldSentiment = analyzeSentiment(worldNews);

            // Combined score
            const combinedScore = Math.round(
                stockSentiment.overallScore * 0.5 +
                marketSentiment.overallScore * 0.3 +
                worldSentiment.overallScore * 0.2
            );

            const result = {
                stock: {
                    items: stockSentiment.items.slice(0, 8),
                    summary: stockSentiment.summary,
                    sentiment: stockSentiment.overallSentiment,
                    score: stockSentiment.overallScore,
                },
                market: {
                    items: marketSentiment.items.slice(0, 6),
                    summary: marketSentiment.summary,
                    sentiment: marketSentiment.overallSentiment,
                    score: marketSentiment.overallScore,
                },
                world: {
                    items: worldSentiment.items.slice(0, 6),
                    summary: worldSentiment.summary,
                    sentiment: worldSentiment.overallSentiment,
                    score: worldSentiment.overallScore,
                },
                combined: {
                    score: combinedScore,
                    sentiment: combinedScore > 20 ? 'bullish' : combinedScore < -20 ? 'bearish' : 'neutral',
                    bestTimeToBuy: combinedScore > 15 ? 'Yes - News sentiment is positive' :
                                   combinedScore > -15 ? 'Neutral - No strong news signal' :
                                   'No - Negative news sentiment, wait for clarity',
                },
            };

            return new Response(JSON.stringify(result), { status: 200, headers: HEADERS });
        }

        // STOCK OF THE DAY
        if (type === 'stockofday') {
            const SOTD_POOL = [
                'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
                'SBIN.NS', 'BHARTIARTL.NS', 'ITC.NS', 'TATAMOTORS.NS', 'BAJFINANCE.NS',
                'LT.NS', 'SUNPHARMA.NS', 'TITAN.NS', 'HCLTECH.NS', 'ADANIENT.NS',
                'AAPL', 'MSFT', 'GOOGL', 'TSLA', 'NVDA'
            ];

            const dateStr = new Date().toISOString().slice(0, 10);
            let hash = 0;
            for (let i = 0; i < dateStr.length; i++) hash += dateStr.charCodeAt(i);
            let pickIndex = hash % SOTD_POOL.length;

            let sotdSymbol = SOTD_POOL[pickIndex];
            let chartData, summaryData, retried = false;

            const fetchSOTD = async (sym) => {
                const [chartRes, fundRes] = await Promise.all([
                    yahooGet(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d&includePrePost=false`),
                    yahooGet(`https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/`),
                ]);
                const chart = JSON.parse(chartRes.text);
                const summary = extractQuoteSummary(fundRes.text);
                return { chart, summary };
            };

            try {
                const result = await fetchSOTD(sotdSymbol);
                chartData = result.chart;
                summaryData = result.summary;
            } catch {
                // Retry with next stock in pool
                pickIndex = (pickIndex + 1) % SOTD_POOL.length;
                sotdSymbol = SOTD_POOL[pickIndex];
                retried = true;
                try {
                    const result = await fetchSOTD(sotdSymbol);
                    chartData = result.chart;
                    summaryData = result.summary;
                } catch (e2) {
                    return new Response(JSON.stringify({ error: 'Failed to fetch stock of the day: ' + e2.message }), { status: 500, headers: HEADERS });
                }
            }

            const meta = chartData?.chart?.result?.[0]?.meta || {};
            const indicators = chartData?.chart?.result?.[0]?.indicators?.quote?.[0] || {};
            const timestamps = chartData?.chart?.result?.[0]?.timestamp || [];

            const price = meta.regularMarketPrice || 0;
            const previousClose = meta.chartPreviousClose || meta.previousClose || 0;
            const change = price - previousClose;
            const changePct = previousClose ? ((change / previousClose) * 100) : 0;
            const currency = meta.currency || 'USD';

            // Get latest volume and compute average volume from chart data
            const volumes = (indicators.volume || []).filter(v => v != null);
            const volume = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
            const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 1;
            const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;

            // Extract fundamentals from summary
            const defaultKeyStats = summaryData?.defaultKeyStatistics || {};
            const financialData = summaryData?.financialData || {};
            const summaryProfile = summaryData?.summaryProfile || {};
            const priceModule = summaryData?.price || {};
            const summaryDetail = summaryData?.summaryDetail || {};

            const name = priceModule.shortName || priceModule.longName || sotdSymbol;
            const sector = summaryProfile.sector || 'N/A';
            const pe = summaryDetail?.trailingPE?.raw || defaultKeyStats?.trailingPE?.raw || null;
            const eps = defaultKeyStats?.trailingEps?.raw || financialData?.earningsPerShare?.raw || null;
            const high52 = summaryDetail?.fiftyTwoWeekHigh?.raw || null;
            const low52 = summaryDetail?.fiftyTwoWeekLow?.raw || null;

            // Trending score and verdict
            const trendingScore = Math.abs(changePct) * volumeRatio;
            let verdict;
            if (changePct > 2) verdict = 'Surging Today';
            else if (changePct > 0) verdict = 'Trending Up';
            else if (changePct > -2) verdict = 'Slight Dip';
            else verdict = 'Under Pressure';

            const sotdHeaders = { ...HEADERS, 'Cache-Control': 'public, max-age=3600' };

            return new Response(JSON.stringify({
                symbol: sotdSymbol,
                name,
                sector,
                price,
                change: Math.round(change * 100) / 100,
                changePct: Math.round(changePct * 100) / 100,
                volume,
                avgVolume: Math.round(avgVolume),
                pe,
                eps,
                high52,
                low52,
                verdict,
                trendingScore: Math.round(trendingScore * 100) / 100,
                date: dateStr,
                currency,
            }), { status: 200, headers: sotdHeaders });
        }

        // SCREENER
        if (type === 'screener') {
            const symbolsParam = url.searchParams.get('symbols');
            if (!symbolsParam) {
                return new Response(JSON.stringify({ error: 'symbols parameter required for screener' }), { status: 400, headers: HEADERS });
            }

            const symbolsList = symbolsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
            if (symbolsList.length === 0) {
                return new Response(JSON.stringify({ error: 'No valid symbols provided' }), { status: 400, headers: HEADERS });
            }

            const fetchPromises = symbolsList.map(async (sym) => {
                const [chartRes, fundRes] = await Promise.allSettled([
                    yahooGet(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false`).then(r => JSON.parse(r.text)),
                    yahooGet(`https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/`).then(r => extractQuoteSummary(r.text)),
                ]);

                return {
                    symbol: sym,
                    chart: chartRes.status === 'fulfilled' ? chartRes.value : null,
                    summary: fundRes.status === 'fulfilled' ? fundRes.value : null,
                };
            });

            const settledResults = await Promise.allSettled(fetchPromises);
            const results = settledResults
                .filter(r => r.status === 'fulfilled')
                .map(r => r.value);

            const screenerHeaders = { ...HEADERS, 'Cache-Control': 'public, max-age=600' };

            return new Response(JSON.stringify({ results }), { status: 200, headers: screenerHeaders });
        }

        return new Response(JSON.stringify({ error: 'Invalid type' }), { status: 400, headers: HEADERS });

    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: HEADERS });
    }
};
