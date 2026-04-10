// ===== Stock Screener =====

let screenerResults = [];
let screenerRunning = false;

// ===== Show/Hide Screener =====
function showScreener() {
    ['welcomeScreen','beginnerContent','mainContent','dashboardContent','ipoContent'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    const sc = document.getElementById('screenerContent');
    if (sc) sc.classList.remove('hidden');
}

function hideScreener() {
    const sc = document.getElementById('screenerContent');
    if (sc) sc.classList.add('hidden');
    const ws = document.getElementById('welcomeScreen');
    if (ws) ws.classList.remove('hidden');
}

// ===== Populate Filter Options =====
function populateFilterOptions() {
    const sectorSelect = document.getElementById('screenerSector');
    if (!sectorSelect || typeof STOCK_DB === 'undefined') return;
    const sectors = [...new Set(STOCK_DB.map(s => s.sector).filter(Boolean))].sort();
    sectorSelect.innerHTML = '<option value="">All Sectors</option>' +
        sectors.map(s => `<option value="${s}">${s}</option>`).join('');
}

// ===== Run Screener =====
async function runScreener() {
    if (screenerRunning) return;
    screenerRunning = true;
    screenerResults = [];

    const filters = {
        sector: document.getElementById('screenerSector')?.value || '',
        peMax: parseFloat(document.getElementById('screenerPE')?.value) || 0,
        roeMin: parseFloat(document.getElementById('screenerROE')?.value) || 0,
        divMin: parseFloat(document.getElementById('screenerDiv')?.value) || 0,
        marketCap: document.getElementById('screenerMarketCap')?.value || '',
        changeFilter: document.getElementById('screenerChange')?.value || 'any',
    };

    // Pre-filter by sector
    let candidates = typeof STOCK_DB !== 'undefined' ? [...STOCK_DB] : [];
    if (filters.sector) {
        candidates = candidates.filter(s => s.sector === filters.sector);
    }

    if (candidates.length === 0) {
        renderScreenerResults([]);
        screenerRunning = false;
        return;
    }

    // Show progress
    const progressBar = document.getElementById('screenerProgressFill');
    const progressText = document.getElementById('screenerProgressText');
    const progressWrap = document.getElementById('screenerProgress');
    const runBtn = document.getElementById('screenerRunBtn');
    if (progressWrap) progressWrap.classList.remove('hidden');
    if (runBtn) { runBtn.disabled = true; runBtn.textContent = 'Screening...'; }

    const batches = [];
    for (let i = 0; i < candidates.length; i += 8) {
        batches.push(candidates.slice(i, i + 8));
    }

    let processed = 0;
    const total = candidates.length;
    const allResults = [];

    for (let bi = 0; bi < batches.length; bi++) {
        const batch = batches[bi];
        const symbols = batch.map(s => s.symbol).join(',');

        if (progressText) progressText.textContent = `Screening ${processed}/${total} stocks...`;
        if (progressBar) progressBar.style.width = `${(processed / total * 100).toFixed(0)}%`;

        try {
            const resp = await apiGet('screener', { symbols });
            const results = resp.results || [];

            for (const item of results) {
                try {
                    const chartResult = item.chart?.chart?.result?.[0] || item.chart?.result?.[0];
                    if (!chartResult || !chartResult.timestamp) continue;

                    const ts = chartResult.timestamp || [];
                    const ohlcv = chartResult.indicators?.quote?.[0] || {};
                    const prices = [];
                    for (let i = ts.length - 1; i >= 0; i--) {
                        if (ohlcv.close[i] != null) {
                            prices.push({
                                date: new Date(ts[i] * 1000).toISOString().split('T')[0],
                                open: ohlcv.open[i] || 0, high: ohlcv.high[i] || 0,
                                low: ohlcv.low[i] || 0, close: ohlcv.close[i],
                                volume: ohlcv.volume[i] || 0
                            });
                        }
                    }
                    if (prices.length < 5) continue;

                    const meta = chartResult.meta || {};
                    const summary = item.summary || {};
                    const analysis = runAnalysis(prices, summary, meta, {});
                    const f = analysis.fundamentals;
                    const cs = meta.currency === 'INR' ? '₹' : meta.currency === 'USD' ? '$' : (meta.currency || '₹');
                    const dbEntry = (typeof STOCK_DB !== 'undefined' ? STOCK_DB : []).find(s => s.symbol === item.symbol);
                    const pr = summary.price || {};

                    allResults.push({
                        symbol: item.symbol,
                        name: pr.longName?.raw || pr.shortName?.raw || meta.longName || meta.shortName || dbEntry?.name || item.symbol,
                        sector: dbEntry?.sector || pr.sector || '',
                        price: prices[0].close,
                        changePct: analysis.changes.dayChange,
                        yearChange: analysis.changes.yearChange,
                        score: analysis.score,
                        verdict: analysis.verdict,
                        action: analysis.action,
                        pe: f.pe,
                        roe: f.roe,
                        divYield: f.divYield,
                        marketCap: f.marketCap,
                        profitMargin: f.profitMargin,
                        debtToEquity: f.debtToEquity,
                        eps: f.eps,
                        cs,
                    });
                } catch { /* skip failed stock */ }
            }
        } catch (err) {
            console.warn('Screener batch error:', err.message);
        }

        processed += batch.length;

        // Rate limit delay between batches
        if (bi < batches.length - 1) {
            await new Promise(r => setTimeout(r, 1500));
        }
    }

    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = `Screening complete! ${total} stocks processed.`;

    // Apply filters
    const filtered = allResults.filter(item => matchesFilters(item, filters));

    // Sort by score descending
    filtered.sort((a, b) => b.score - a.score);
    screenerResults = filtered;

    renderScreenerResults(filtered);

    if (runBtn) { runBtn.disabled = false; runBtn.textContent = 'Screen Stocks'; }
    setTimeout(() => { if (progressWrap) progressWrap.classList.add('hidden'); }, 2000);
    screenerRunning = false;
}

// ===== Filter Matching =====
function matchesFilters(item, filters) {
    if (filters.peMax && item.pe > 0 && item.pe > filters.peMax) return false;
    if (filters.roeMin && item.roe > 0 && item.roe * 100 < filters.roeMin) return false;
    if (filters.divMin && item.divYield * 100 < filters.divMin) return false;
    if (filters.changeFilter === 'positive' && item.yearChange < 0) return false;
    if (filters.changeFilter === 'negative' && item.yearChange >= 0) return false;
    // Market cap filter (in crores: 1 Cr = 10M)
    if (filters.marketCap && item.marketCap > 0) {
        const capInCr = item.marketCap / 10000000; // convert to crores
        if (filters.marketCap === 'large' && capInCr < 20000) return false;
        if (filters.marketCap === 'mid' && (capInCr < 5000 || capInCr >= 20000)) return false;
        if (filters.marketCap === 'small' && capInCr >= 5000) return false;
    }
    return true;
}

// ===== Render Results =====
function renderScreenerResults(results) {
    const container = document.getElementById('screenerResults');
    if (!container) return;

    if (results.length === 0) {
        container.innerHTML = '<div class="screener-empty"><i class="fas fa-filter"></i><p>No stocks match your filters. Try broadening your criteria.</p></div>';
        document.getElementById('screenerCount').textContent = '0 results';
        return;
    }

    document.getElementById('screenerCount').textContent = `${results.length} stocks found`;

    container.innerHTML = results.map(item => {
        const scoreClass = item.score >= 55 ? 'bullish' : item.score < 40 ? 'bearish' : 'neutral';
        const changeClass = item.changePct >= 0 ? 'up' : 'down';
        const yearClass = item.yearChange >= 0 ? 'up' : 'down';
        return `
        <div class="screener-card ${scoreClass}">
            <div class="screener-card-header">
                <div>
                    <strong class="screener-symbol">${item.symbol.replace('.NS','').replace('.BO','')}</strong>
                    <span class="screener-name">${item.name}</span>
                    ${item.sector ? `<span class="screener-sector">${item.sector}</span>` : ''}
                </div>
                <div class="score-pill ${scoreClass}">${item.score}</div>
            </div>
            <div class="screener-card-price">
                <span class="screener-price">${item.cs}${item.price.toLocaleString(undefined,{maximumFractionDigits:2})}</span>
                <span class="screener-change ${changeClass}">${item.changePct>=0?'+':''}${item.changePct.toFixed(2)}%</span>
            </div>
            <div class="screener-card-metrics">
                <div><span class="metric-label">P/E</span><span class="metric-val">${item.pe?item.pe.toFixed(1):'--'}</span></div>
                <div><span class="metric-label">ROE</span><span class="metric-val">${item.roe?(item.roe*100).toFixed(1)+'%':'--'}</span></div>
                <div><span class="metric-label">Div</span><span class="metric-val">${item.divYield?(item.divYield*100).toFixed(2)+'%':'0%'}</span></div>
                <div><span class="metric-label">MCap</span><span class="metric-val">${item.marketCap?formatMarketCap(item.marketCap):'--'}</span></div>
                <div><span class="metric-label">1Y</span><span class="metric-val ${yearClass}">${item.yearChange>=0?'+':''}${item.yearChange.toFixed(1)}%</span></div>
            </div>
            <div class="screener-card-verdict">${item.verdict} - ${item.action}</div>
            <div class="screener-card-actions">
                <button onclick="analyzeFromScreener('${item.symbol}')"><i class="fas fa-chart-line"></i> Analyze</button>
                <button onclick="if(typeof addToWatchlist==='function')addToWatchlist('${item.symbol}','${item.name.replace(/'/g,"\\'")}')"><i class="fas fa-star"></i></button>
            </div>
        </div>`;
    }).join('');
}

// ===== Sort =====
function sortScreener(field) {
    if (!screenerResults.length) return;
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    event?.target?.classList?.add('active');

    switch (field) {
        case 'score': screenerResults.sort((a, b) => b.score - a.score); break;
        case 'pe': screenerResults.sort((a, b) => (a.pe || 999) - (b.pe || 999)); break;
        case 'div': screenerResults.sort((a, b) => (b.divYield || 0) - (a.divYield || 0)); break;
        case 'change': screenerResults.sort((a, b) => b.yearChange - a.yearChange); break;
        case 'roe': screenerResults.sort((a, b) => (b.roe || 0) - (a.roe || 0)); break;
    }
    renderScreenerResults(screenerResults);
}

// ===== Helpers =====
function formatMarketCap(cap) {
    if (!cap || cap <= 0) return '--';
    const crores = cap / 10000000;
    if (crores >= 100000) return (crores / 100000).toFixed(2) + ' L Cr';
    if (crores >= 1000) return (crores / 1000).toFixed(1) + 'K Cr';
    if (crores >= 1) return crores.toFixed(0) + ' Cr';
    return (cap / 1000000).toFixed(1) + 'M';
}

function analyzeFromScreener(symbol) {
    hideScreener();
    const input = document.getElementById('stockInput');
    if (input) { input.value = symbol; }
    const btn = document.getElementById('analyzeBtn');
    if (btn) btn.click();
}

function resetScreener() {
    ['screenerSector','screenerPE','screenerROE','screenerDiv','screenerMarketCap'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const ch = document.getElementById('screenerChange');
    if (ch) ch.value = 'any';
    document.getElementById('screenerResults').innerHTML = '';
    document.getElementById('screenerCount').textContent = '';
    screenerResults = [];
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    populateFilterOptions();
});
