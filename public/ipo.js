// ===== IPO Analyzer — Frontend Module =====
// Handles IPO listing, detail view, scoring visualization

let ipoData = null;
let ipoCurrentTab = 'ongoing';
let ipoDetailOpen = false;

// ===== API =====
async function ipoApiGet(type, params = {}) {
    const qs = new URLSearchParams({ type, ...params }).toString();
    // Use same pattern as apiGet — works with both local server & Netlify
    const base = window.location.hostname === 'localhost' ? '' : '';
    const resp = await fetch(`/.netlify/functions/ipo?${qs}`);
    if (!resp.ok) throw new Error(`IPO API error: ${resp.status}`);
    return resp.json();
}

// Local fallback for dev server
async function ipoApiGetLocal(type, params = {}) {
    try {
        return await ipoApiGet(type, params);
    } catch (e) {
        // If Netlify function not available (local dev), try proxy
        const qs = new URLSearchParams({ type, ...params }).toString();
        const resp = await fetch(`/api/ipo?${qs}`);
        if (!resp.ok) throw new Error('IPO local API error');
        return resp.json();
    }
}

// ===== Show IPO Section =====
function showIPOSection() {
    // Hide other sections
    const sections = ['welcomeScreen', 'mainContent', 'beginnerContent', 'screenerContent', 'dashboardContent'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const ipoContent = document.getElementById('ipoContent');
    if (ipoContent) {
        ipoContent.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Update mobile bottom bar
    document.querySelectorAll('.mob-btn').forEach(b => b.classList.remove('active'));
    const ipoMobBtn = document.querySelector('.mob-btn[onclick*="showIPO"]');
    if (ipoMobBtn) ipoMobBtn.classList.add('active');

    // Load data if not loaded
    if (!ipoData) {
        loadIPOData();
    }
}

function hideIPOSection() {
    const ipoContent = document.getElementById('ipoContent');
    if (ipoContent) ipoContent.classList.add('hidden');

    // Show welcome
    const welcome = document.getElementById('welcomeScreen');
    if (welcome) welcome.classList.remove('hidden');

    // Reset mobile bar
    document.querySelectorAll('.mob-btn').forEach(b => b.classList.remove('active'));
    const homeBtn = document.querySelector('.mob-btn[onclick*="goHome"]');
    if (homeBtn) homeBtn.classList.add('active');
}

// ===== Load IPO Data =====
async function loadIPOData() {
    const container = document.getElementById('ipoListContainer');
    if (!container) return;

    container.innerHTML = `
        <div class="ipo-loading">
            <div class="ipo-loading-spinner"></div>
            <p>Fetching latest IPO data...</p>
        </div>
    `;

    try {
        ipoData = await ipoApiGetLocal('list');
        renderIPOList();
    } catch (err) {
        console.error('IPO load error:', err);
        container.innerHTML = `
            <div class="ipo-empty">
                <i class="fas fa-exclamation-triangle"></i>
                <h3>Could not load IPO data</h3>
                <p>${err.message || 'Please check your connection and try again.'}</p>
                <button class="ipo-retry-btn" onclick="loadIPOData()"><i class="fas fa-redo"></i> Retry</button>
            </div>
        `;
    }
}

// ===== Render IPO List =====
function renderIPOList() {
    if (!ipoData) return;

    updateIPOStats();
    switchIPOTab(ipoCurrentTab);
}

function updateIPOStats() {
    const setCount = (id, count) => {
        const el = document.getElementById(id);
        if (el) el.textContent = count;
    };

    setCount('ipoOngoingCount', (ipoData.ongoing || []).length);
    setCount('ipoUpcomingCount', (ipoData.upcoming || []).length);
    setCount('ipoListedCount', (ipoData.listed || []).length);
}

function switchIPOTab(tab) {
    ipoCurrentTab = tab;

    // Update tab buttons
    document.querySelectorAll('.ipo-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    const container = document.getElementById('ipoListContainer');
    if (!container || !ipoData) return;

    const items = ipoData[tab] || [];

    if (items.length === 0) {
        const messages = {
            ongoing: 'No ongoing IPOs right now. Check back soon!',
            upcoming: 'No upcoming IPOs announced yet.',
            listed: 'No recently listed IPOs to show.'
        };
        container.innerHTML = `
            <div class="ipo-empty">
                <i class="fas fa-inbox"></i>
                <h3>${messages[tab]}</h3>
                <p>We check for new IPOs regularly.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = items.map(ipo => renderIPOCard(ipo, tab)).join('');
}

function renderIPOCard(ipo, tab) {
    const gmpVal = parseFloat((ipo.gmp || '').replace(/[^\d.-]/g, '')) || 0;
    const gmpClass = gmpVal > 0 ? 'positive' : gmpVal < 0 ? 'negative' : 'neutral';
    const gmpDisplay = ipo.gmp || '—';

    // Price band
    const priceBand = ipo.priceBand || '—';

    // Dates
    const openDate = ipo.openDate || '—';
    const closeDate = ipo.closeDate || '—';
    const listingDate = ipo.listingDate || '—';

    // IPO size
    const ipoSize = ipo.ipoSize || '—';

    // Status badge
    let statusBadge = '';
    if (tab === 'ongoing') {
        statusBadge = '<span class="ipo-status-badge ongoing"><i class="fas fa-circle"></i> Live</span>';
    } else if (tab === 'upcoming') {
        statusBadge = '<span class="ipo-status-badge upcoming"><i class="fas fa-clock"></i> Upcoming</span>';
    } else {
        statusBadge = '<span class="ipo-status-badge listed"><i class="fas fa-check-circle"></i> Listed</span>';
    }

    // Lot size
    const lotSize = ipo.lotSize || '';

    return `
        <div class="ipo-card" onclick="openIPODetail('${escapeAttr(ipo.companyName)}', ${JSON.stringify(ipo).replace(/"/g, '&quot;')})">
            <div class="ipo-card-top">
                <div class="ipo-card-info">
                    <div class="ipo-card-name-row">
                        <h3>${ipo.companyName}</h3>
                        ${statusBadge}
                    </div>
                    ${ipo.industry ? `<span class="ipo-card-industry"><i class="fas fa-building"></i> ${ipo.industry}</span>` : ''}
                </div>
                <div class="ipo-gmp-badge ${gmpClass}">
                    <span class="ipo-gmp-label">GMP</span>
                    <span class="ipo-gmp-value">${gmpDisplay}</span>
                </div>
            </div>

            <div class="ipo-card-metrics">
                <div class="ipo-metric">
                    <span class="ipo-metric-label"><i class="fas fa-tag"></i> Price Band</span>
                    <span class="ipo-metric-value">${priceBand}</span>
                </div>
                <div class="ipo-metric">
                    <span class="ipo-metric-label"><i class="fas fa-rupee-sign"></i> Size</span>
                    <span class="ipo-metric-value">${ipoSize}</span>
                </div>
                <div class="ipo-metric">
                    <span class="ipo-metric-label"><i class="fas fa-calendar-alt"></i> Open</span>
                    <span class="ipo-metric-value">${openDate}</span>
                </div>
                <div class="ipo-metric">
                    <span class="ipo-metric-label"><i class="fas fa-calendar-check"></i> Close</span>
                    <span class="ipo-metric-value">${closeDate}</span>
                </div>
                ${lotSize ? `
                <div class="ipo-metric">
                    <span class="ipo-metric-label"><i class="fas fa-layer-group"></i> Lot</span>
                    <span class="ipo-metric-value">${lotSize}</span>
                </div>` : ''}
                <div class="ipo-metric">
                    <span class="ipo-metric-label"><i class="fas fa-chart-line"></i> Listing</span>
                    <span class="ipo-metric-value">${listingDate}</span>
                </div>
            </div>

            <div class="ipo-card-footer">
                <span class="ipo-analyze-hint"><i class="fas fa-arrow-right"></i> Click for AI Analysis</span>
            </div>
        </div>
    `;
}

function escapeAttr(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ===== IPO Detail View =====
async function openIPODetail(companyName, cardData) {
    ipoDetailOpen = true;
    const panel = document.getElementById('ipoDetailPanel');
    if (!panel) return;

    panel.classList.remove('hidden');
    panel.innerHTML = `
        <div class="ipo-detail-container">
            <div class="ipo-detail-header">
                <button class="ipo-detail-back" onclick="closeIPODetail()"><i class="fas fa-arrow-left"></i> Back to IPOs</button>
                <h2>${companyName}</h2>
            </div>
            <div class="ipo-detail-loading">
                <div class="ipo-loading-spinner"></div>
                <p>Running AI analysis on ${companyName}...</p>
                <div class="ipo-analysis-steps">
                    <div class="ipo-step active" id="ipoStep1"><i class="fas fa-search"></i> Fetching company data</div>
                    <div class="ipo-step" id="ipoStep2"><i class="fas fa-newspaper"></i> Analyzing news sentiment</div>
                    <div class="ipo-step" id="ipoStep3"><i class="fas fa-calculator"></i> Computing valuation</div>
                    <div class="ipo-step" id="ipoStep4"><i class="fas fa-brain"></i> Generating verdict</div>
                </div>
            </div>
        </div>
    `;

    // Scroll to top
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
        // Animate steps
        setTimeout(() => markStep('ipoStep2'), 800);
        setTimeout(() => markStep('ipoStep3'), 1600);

        const detail = await ipoApiGetLocal('detail', { name: companyName });

        // Merge card data with detail
        if (cardData) {
            detail.gmp = cardData.gmp || detail.gmp || '';
            detail.priceBand = cardData.priceBand || detail.priceBand || '';
            detail.openDate = cardData.openDate || '';
            detail.closeDate = cardData.closeDate || '';
            detail.listingDate = cardData.listingDate || '';
            detail.ipoSize = cardData.ipoSize || '';
            detail.lotSize = cardData.lotSize || '';
            detail.category = cardData.category || '';

            // Rescore with GMP and IPO size data
            if (detail.scoring) {
                const rescored = rescoreWithCardData(detail, cardData);
                detail.scoring = rescored;
            }
        }

        setTimeout(() => {
            markStep('ipoStep4');
            setTimeout(() => renderIPODetail(panel, detail), 400);
        }, 400);

    } catch (err) {
        console.error('IPO detail error:', err);
        panel.innerHTML = `
            <div class="ipo-detail-container">
                <div class="ipo-detail-header">
                    <button class="ipo-detail-back" onclick="closeIPODetail()"><i class="fas fa-arrow-left"></i> Back to IPOs</button>
                    <h2>${companyName}</h2>
                </div>
                <div class="ipo-empty">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3>Analysis Failed</h3>
                    <p>${err.message || 'Unable to fetch data for this IPO.'}</p>
                    <button class="ipo-retry-btn" onclick="openIPODetail('${escapeAttr(companyName)}')"><i class="fas fa-redo"></i> Retry</button>
                </div>
            </div>
        `;
    }
}

function markStep(stepId) {
    const el = document.getElementById(stepId);
    if (el) el.classList.add('active');
}

function rescoreWithCardData(detail, cardData) {
    // Re-run scoring with complete data
    const ipoObj = {
        companyName: detail.companyName,
        industry: detail.industry,
        financials: detail.financials,
        valuation: detail.valuation,
        sentiment: detail.sentiment,
        subscription: detail.subscription,
        gmp: cardData.gmp || '',
        ipoSize: cardData.ipoSize || ''
    };

    // Simple rescore for GMP & size adjustments
    const base = detail.scoring;
    let score = base.score;
    const pros = [...base.pros];
    const cons = [...base.cons];

    const gmpVal = parseFloat((cardData.gmp || '').replace(/[^\d.-]/g, '')) || 0;
    if (gmpVal > 100 && !pros.some(p => p.includes('GMP'))) {
        score += 5;
        pros.push('Very high GMP (₹' + gmpVal + ')');
    } else if (gmpVal <= 0 && gmpVal !== 0 && !cons.some(c => c.includes('GMP'))) {
        score -= 5;
        cons.push('Negative GMP — listing losses likely');
    }

    score = Math.max(0, Math.min(100, score));

    let verdict, verdictColor;
    if (score >= 75) { verdict = 'INVEST'; verdictColor = 'green'; }
    else if (score >= 50) { verdict = 'NEUTRAL'; verdictColor = 'yellow'; }
    else { verdict = 'AVOID'; verdictColor = 'red'; }

    return { ...base, score, verdict, verdictColor, pros, cons };
}

function closeIPODetail() {
    const panel = document.getElementById('ipoDetailPanel');
    if (panel) panel.classList.add('hidden');
    ipoDetailOpen = false;
}

// ===== Render IPO Detail =====
function renderIPODetail(panel, detail) {
    const s = detail.scoring || {};
    const bd = s.breakdown || {};
    const fin = detail.financials || {};
    const val = detail.valuation || {};
    const sent = detail.sentiment || {};
    const sub = detail.subscription;
    const news = detail.news || [];

    const verdictClass = s.verdict === 'INVEST' ? 'invest' : s.verdict === 'AVOID' ? 'avoid' : 'neutral';

    panel.innerHTML = `
        <div class="ipo-detail-container">
            <div class="ipo-detail-header">
                <button class="ipo-detail-back" onclick="closeIPODetail()"><i class="fas fa-arrow-left"></i> Back to IPOs</button>
                <div class="ipo-detail-title-row">
                    <div>
                        <h2>${detail.companyName}</h2>
                        ${detail.industry ? `<span class="ipo-detail-industry"><i class="fas fa-building"></i> ${detail.industry}</span>` : ''}
                    </div>
                    <div class="ipo-verdict-badge ${verdictClass}">
                        <span class="ipo-verdict-score">${s.score || '—'}</span>
                        <span class="ipo-verdict-label">${s.verdict || 'N/A'}</span>
                    </div>
                </div>
            </div>

            <!-- Summary -->
            <div class="ipo-detail-summary">
                <p>${s.summary || 'Analysis in progress...'}</p>
            </div>

            <!-- Quick Info Bar -->
            ${renderQuickInfo(detail)}

            <!-- Score Breakdown -->
            <div class="ipo-detail-card">
                <div class="ipo-detail-card-header">
                    <h3><i class="fas fa-chart-pie"></i> AI Score Breakdown</h3>
                    <span class="ipo-detail-card-badge">${s.score}/100</span>
                </div>
                <div class="ipo-score-bars">
                    ${renderScoreBar('Fundamentals', bd.fundamentals, 30)}
                    ${renderScoreBar('Industry Potential', bd.industry, 20)}
                    ${renderScoreBar('Valuation', bd.valuation, 20)}
                    ${renderScoreBar('Sentiment', bd.sentiment, 10)}
                    ${renderScoreBar('Subscription', bd.subscription, 10)}
                    ${renderScoreBar('Risk Assessment', bd.risk, 10)}
                </div>
            </div>

            <!-- Pros & Cons -->
            <div class="ipo-detail-grid">
                <div class="ipo-detail-card ipo-pros-card">
                    <div class="ipo-detail-card-header">
                        <h3><i class="fas fa-thumbs-up"></i> Strengths</h3>
                    </div>
                    <ul class="ipo-pros-list">
                        ${(s.pros || []).map(p => `<li><i class="fas fa-check-circle"></i> ${p}</li>`).join('') || '<li class="ipo-no-data">No specific strengths identified</li>'}
                    </ul>
                </div>
                <div class="ipo-detail-card ipo-cons-card">
                    <div class="ipo-detail-card-header">
                        <h3><i class="fas fa-thumbs-down"></i> Risks & Concerns</h3>
                    </div>
                    <ul class="ipo-cons-list">
                        ${(s.cons || []).map(c => `<li><i class="fas fa-exclamation-circle"></i> ${c}</li>`).join('') || '<li class="ipo-no-data">No major concerns identified</li>'}
                    </ul>
                </div>
            </div>

            <!-- Financials -->
            ${fin && Object.values(fin).some(v => v !== null) ? `
            <div class="ipo-detail-card">
                <div class="ipo-detail-card-header">
                    <h3><i class="fas fa-calculator"></i> Key Financials</h3>
                </div>
                <div class="ipo-financials-grid">
                    ${renderFinMetric('Revenue Growth', fin.revenueGrowth, '%')}
                    ${renderFinMetric('PAT Margin', fin.patMargin, '%')}
                    ${renderFinMetric('ROE', fin.roe, '%')}
                    ${renderFinMetric('ROCE', fin.roce, '%')}
                    ${renderFinMetric('Debt/Equity', fin.debtToEquity, 'x')}
                    ${renderFinMetric('Current Ratio', fin.currentRatio, 'x')}
                    ${val.peRatio ? renderFinMetric('P/E Ratio', val.peRatio, 'x') : ''}
                    ${val.pbRatio ? renderFinMetric('P/B Ratio', val.pbRatio, 'x') : ''}
                </div>
            </div>` : ''}

            <!-- Subscription Data -->
            ${sub ? `
            <div class="ipo-detail-card">
                <div class="ipo-detail-card-header">
                    <h3><i class="fas fa-users"></i> Subscription Status</h3>
                    <span class="ipo-detail-card-badge live">Live</span>
                </div>
                <div class="ipo-subscription-grid">
                    ${renderSubCategory('QIB', sub.qib)}
                    ${renderSubCategory('HNI', sub.hni)}
                    ${renderSubCategory('Retail', sub.retail)}
                    ${renderSubCategory('Total', sub.total)}
                </div>
            </div>` : ''}

            <!-- Sentiment -->
            ${news.length > 0 ? `
            <div class="ipo-detail-card">
                <div class="ipo-detail-card-header">
                    <h3><i class="fas fa-newspaper"></i> News & Sentiment</h3>
                    <span class="ipo-sentiment-badge ${sent.label || 'neutral'}">${(sent.label || 'neutral').toUpperCase()}</span>
                </div>
                <div class="ipo-sentiment-bar-container">
                    <div class="ipo-sentiment-bar">
                        <div class="ipo-sentiment-positive" style="width: ${sent.total ? (sent.positive / sent.total * 100) : 33}%">${sent.positive || 0} Positive</div>
                        <div class="ipo-sentiment-neutral" style="width: ${sent.total ? (sent.neutral / sent.total * 100) : 34}%">${sent.neutral || 0} Neutral</div>
                        <div class="ipo-sentiment-negative" style="width: ${sent.total ? (sent.negative / sent.total * 100) : 33}%">${sent.negative || 0} Negative</div>
                    </div>
                </div>
                <div class="ipo-news-list">
                    ${news.slice(0, 6).map(n => `
                        <a href="${n.link}" target="_blank" rel="noopener" class="ipo-news-item">
                            <div class="ipo-news-sentiment-dot ${n.sentiment}"></div>
                            <div class="ipo-news-content">
                                <span class="ipo-news-title">${n.title}</span>
                                <span class="ipo-news-meta">${n.source || ''} ${n.date ? '• ' + new Date(n.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}</span>
                            </div>
                        </a>
                    `).join('')}
                </div>
            </div>` : ''}

            <!-- Company Description -->
            ${detail.description ? `
            <div class="ipo-detail-card">
                <div class="ipo-detail-card-header">
                    <h3><i class="fas fa-info-circle"></i> About the Company</h3>
                </div>
                <p class="ipo-description">${detail.description.substring(0, 500)}${detail.description.length > 500 ? '...' : ''}</p>
            </div>` : ''}

            <!-- Disclaimer -->
            <div class="ipo-disclaimer">
                <i class="fas fa-exclamation-triangle"></i>
                <p>IPO analysis is based on publicly available data and AI scoring. This is NOT financial advice. Always do your own research before investing.</p>
            </div>
        </div>
    `;
}

function renderQuickInfo(detail) {
    const items = [];
    if (detail.priceBand) items.push({ icon: 'fa-tag', label: 'Price', value: detail.priceBand });
    if (detail.ipoSize) items.push({ icon: 'fa-rupee-sign', label: 'Size', value: detail.ipoSize });
    if (detail.openDate) items.push({ icon: 'fa-calendar-alt', label: 'Opens', value: detail.openDate });
    if (detail.closeDate) items.push({ icon: 'fa-calendar-check', label: 'Closes', value: detail.closeDate });
    if (detail.listingDate) items.push({ icon: 'fa-chart-line', label: 'Listing', value: detail.listingDate });
    if (detail.lotSize) items.push({ icon: 'fa-layer-group', label: 'Lot', value: detail.lotSize });
    if (detail.gmp) items.push({ icon: 'fa-fire', label: 'GMP', value: detail.gmp });

    if (items.length === 0) return '';

    return `
        <div class="ipo-quick-info">
            ${items.map(i => `
                <div class="ipo-quick-item">
                    <i class="fas ${i.icon}"></i>
                    <span class="ipo-quick-label">${i.label}</span>
                    <span class="ipo-quick-value">${i.value}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function renderScoreBar(label, value, max) {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    const color = pct >= 70 ? 'var(--accent-green)' : pct >= 40 ? 'var(--accent-yellow)' : 'var(--accent-red)';

    return `
        <div class="ipo-score-bar-row">
            <div class="ipo-score-bar-label">
                <span>${label}</span>
                <span class="ipo-score-bar-nums">${value || 0}/${max}</span>
            </div>
            <div class="ipo-score-bar-track">
                <div class="ipo-score-bar-fill" style="width: ${pct}%; background: ${color}"></div>
            </div>
        </div>
    `;
}

function renderFinMetric(label, value, suffix) {
    if (value === null || value === undefined) return '';
    const numVal = parseFloat(value);
    let colorClass = '';
    if (!isNaN(numVal)) {
        if (label.includes('Growth') || label === 'ROE' || label === 'ROCE' || label === 'PAT Margin') {
            colorClass = numVal > 0 ? 'positive' : numVal < 0 ? 'negative' : '';
        }
        if (label === 'Debt/Equity') {
            colorClass = numVal < 0.5 ? 'positive' : numVal > 1.5 ? 'negative' : '';
        }
    }

    return `
        <div class="ipo-fin-metric">
            <span class="ipo-fin-label">${label}</span>
            <span class="ipo-fin-value ${colorClass}">${value}${suffix}</span>
        </div>
    `;
}

function renderSubCategory(label, value) {
    const numVal = parseFloat(value) || 0;
    const pct = Math.min(100, numVal * 10); // Scale for bar width
    const colorClass = numVal > 5 ? 'high' : numVal > 1 ? 'medium' : 'low';

    return `
        <div class="ipo-sub-category">
            <div class="ipo-sub-header">
                <span class="ipo-sub-label">${label}</span>
                <span class="ipo-sub-value ${colorClass}">${numVal > 0 ? numVal.toFixed(2) + 'x' : '—'}</span>
            </div>
            <div class="ipo-sub-bar">
                <div class="ipo-sub-bar-fill ${colorClass}" style="width: ${pct}%"></div>
            </div>
        </div>
    `;
}

// ===== Refresh =====
async function refreshIPOData() {
    ipoData = null;
    const container = document.getElementById('ipoListContainer');
    if (container) {
        container.innerHTML = `
            <div class="ipo-loading">
                <div class="ipo-loading-spinner"></div>
                <p>Refreshing IPO data...</p>
            </div>
        `;
    }

    try {
        ipoData = await ipoApiGetLocal('refresh');
        renderIPOList();
        if (typeof showToast === 'function') showToast('IPO data refreshed!', 'success');
    } catch (err) {
        if (typeof showToast === 'function') showToast('Failed to refresh IPO data', 'error');
        loadIPOData(); // Fallback to regular load
    }
}
