// ===== IPO Analyzer — Frontend Module =====
// Handles IPO listing, detail view, scoring visualization

let ipoData = null;
let ipoCurrentTab = 'ongoing';
let ipoDetailOpen = false;

// ===== API =====
async function ipoApiGet(type, params = {}) {
    const qs = new URLSearchParams({ type, ...params }).toString();
    const resp = await fetch(`/api/ipo?${qs}`);
    if (!resp.ok) throw new Error(`IPO API error: ${resp.status}`);
    return resp.json();
}

// Alias used throughout the file
async function ipoApiGetLocal(type, params = {}) {
    return ipoApiGet(type, params);
}

// ===== Show IPO Section =====
function showIPOSection() {
    setRoute('/ipo');
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
    const openDate = formatIPODate(ipo.openDate) || '—';
    const closeDate = formatIPODate(ipo.closeDate) || '—';
    const listingDate = formatIPODate(ipo.listingDate) || '—';

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
            setTimeout(() => { _deepDetail = detail; renderIPODetail(panel, detail); }, 400);
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

// ===== Date Formatter =====
function formatIPODate(str) {
    if (!str) return '—';
    // ISO format 2026-04-17
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        const d = new Date(str + 'T00:00:00');
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    return str;
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
    const verdictGrad = s.verdict === 'INVEST'
        ? 'linear-gradient(135deg,rgba(16,185,129,0.12),rgba(16,185,129,0.02))'
        : s.verdict === 'AVOID'
        ? 'linear-gradient(135deg,rgba(239,68,68,0.12),rgba(239,68,68,0.02))'
        : 'linear-gradient(135deg,rgba(245,158,11,0.12),rgba(245,158,11,0.02))';
    const verdictBorder = s.verdict === 'INVEST' ? 'rgba(16,185,129,0.3)' : s.verdict === 'AVOID' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)';

    const logoHtml = detail.logoUrl
        ? `<img src="${detail.logoUrl}" alt="${detail.companyName}" class="ipo-hero-logo" onerror="this.style.display='none'">`
        : `<div class="ipo-hero-logo-placeholder"><i class="fas fa-building"></i></div>`;

    panel.innerHTML = `
        <div class="ipo-detail-container">

            <!-- Back Button -->
            <button class="ipo-detail-back" onclick="closeIPODetail()"><i class="fas fa-arrow-left"></i> Back to IPOs</button>

            <!-- Hero Header -->
            <div class="ipo-detail-hero" style="background:${verdictGrad};border-color:${verdictBorder};">
                <div class="ipo-hero-left">
                    ${logoHtml}
                    <div class="ipo-hero-info">
                        <div class="ipo-hero-tags">
                            ${detail.ipoType ? `<span class="ipo-hero-tag type">${detail.ipoType}</span>` : ''}
                            ${detail.category === 'ongoing' ? `<span class="ipo-hero-tag live"><i class="fas fa-circle"></i> LIVE</span>` : ''}
                            ${detail.industry ? `<span class="ipo-hero-tag sector">${detail.industry}</span>` : ''}
                        </div>
                        <h2 class="ipo-hero-name">${detail.companyName}</h2>
                        <p class="ipo-hero-summary">${s.summary || ''}</p>
                    </div>
                </div>
                <div class="ipo-verdict-badge ${verdictClass}">
                    <span class="ipo-verdict-score">${s.score || '—'}</span>
                    <span class="ipo-verdict-label">${s.verdict || 'N/A'}</span>
                </div>
            </div>

            <!-- Key Stats Grid -->
            <div class="ipo-stats-grid">
                ${detail.priceBand ? `<div class="ipo-stat-card"><i class="fas fa-tag"></i><span class="ipo-stat-label">Price Band</span><span class="ipo-stat-value">₹${detail.priceBand}</span></div>` : ''}
                ${detail.openDate  ? `<div class="ipo-stat-card"><i class="fas fa-calendar-plus"></i><span class="ipo-stat-label">Opens</span><span class="ipo-stat-value">${formatIPODate(detail.openDate)}</span></div>` : ''}
                ${detail.closeDate ? `<div class="ipo-stat-card"><i class="fas fa-calendar-check"></i><span class="ipo-stat-label">Closes</span><span class="ipo-stat-value">${formatIPODate(detail.closeDate)}</span></div>` : ''}
                ${detail.listingDate ? `<div class="ipo-stat-card"><i class="fas fa-chart-line"></i><span class="ipo-stat-label">Listing</span><span class="ipo-stat-value">${formatIPODate(detail.listingDate)}</span></div>` : ''}
                ${detail.lotSize ? `<div class="ipo-stat-card"><i class="fas fa-layer-group"></i><span class="ipo-stat-label">Lot Size</span><span class="ipo-stat-value">${detail.lotSize} shares</span></div>` : ''}
                ${detail.gmp ? `<div class="ipo-stat-card highlight"><i class="fas fa-fire"></i><span class="ipo-stat-label">GMP</span><span class="ipo-stat-value">₹${detail.gmp}</span></div>` : ''}
            </div>

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
                <!-- Deep Analysis CTA -->
                <button class="ipo-deep-btn" onclick="openDeepAnalysis('${escapeAttr(detail.companyName)}', this)">
                    <i class="fas fa-microscope"></i> Deep Analysis
                    <span class="ipo-deep-badge">AI</span>
                </button>
            </div>

            <!-- Deep Analysis Panel (hidden by default) -->
            <div class="ipo-deep-panel hidden" id="ipoDeepPanel"></div>

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
                    ${renderSubCategory('Total', sub.total || sub.noOfTime)}
                </div>
            </div>` : ''}

            <!-- News & Sentiment -->
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
                        <div class="ipo-sentiment-negative" style="width: ${sent.total ? (sent.negative / sent.total * 100) : 33}%">${sent.negative || 0}</div>
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

// ===== Deep Analysis =====
let _deepDetail = null;

function openDeepAnalysis(companyName, btn) {
    const panel = document.getElementById('ipoDeepPanel');
    if (!panel) return;

    // Toggle
    if (!panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        btn.innerHTML = '<i class="fas fa-microscope"></i> Deep Analysis <span class="ipo-deep-badge">AI</span>';
        return;
    }

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Analyzing...';
    btn.disabled = true;

    // Use cached detail from last render
    const detail = _deepDetail;
    if (!detail) { btn.disabled = false; return; }

    setTimeout(() => {
        panel.classList.remove('hidden');
        panel.innerHTML = renderDeepAnalysis(detail);
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        btn.innerHTML = '<i class="fas fa-times"></i> Close Deep Analysis';
        btn.disabled = false;
    }, 900);
}

function renderDeepAnalysis(detail) {
    const s = detail.scoring || {};
    const bd = s.breakdown || {};
    const sub = detail.subscription;
    const fin = detail.financials || {};
    const val = detail.valuation || {};

    // Listing gain estimate from GMP
    const gmpVal = parseFloat((detail.gmp || '').replace(/[^\d.-]/g, '')) || 0;
    const maxPrice = detail.priceMax || parseFloat((detail.priceBand || '').split('-').pop()) || 0;
    const gmpPct = maxPrice > 0 && gmpVal > 0 ? ((gmpVal / maxPrice) * 100).toFixed(1) : null;

    // Risk level
    const riskScore = bd.risk || 5;
    const riskLabel = riskScore >= 8 ? 'Low' : riskScore >= 5 ? 'Medium' : 'High';
    const riskColor = riskScore >= 8 ? 'var(--accent-green)' : riskScore >= 5 ? 'var(--accent-yellow)' : 'var(--accent-red)';

    // Investor type recommendation
    const score = s.score || 50;
    const investorTypes = score >= 75
        ? [{ type: 'Aggressive', apply: true, reason: 'Strong fundamentals + high score — suitable for higher allocation' }, { type: 'Moderate', apply: true, reason: 'Good risk-reward balance for steady investors' }, { type: 'Conservative', apply: false, reason: 'May prefer established stocks over IPOs' }]
        : score >= 60
        ? [{ type: 'Aggressive', apply: true, reason: 'Moderate upside potential with manageable risk' }, { type: 'Moderate', apply: true, reason: 'Apply with moderate allocation' }, { type: 'Conservative', apply: false, reason: 'Wait for post-listing stability' }]
        : score >= 50
        ? [{ type: 'Aggressive', apply: true, reason: 'Only for those with high risk tolerance' }, { type: 'Moderate', apply: false, reason: 'Mixed signals — better opportunities may exist' }, { type: 'Conservative', apply: false, reason: 'Avoid — risk not justified' }]
        : [{ type: 'All Types', apply: false, reason: 'Low AI score — high risk relative to potential gain' }];

    // Subscription analysis
    const totalSub = parseFloat(sub?.total || sub?.noOfTime || 0);
    const subAnalysis = totalSub > 10 ? 'Heavily oversubscribed — allotment will be via lottery. Listing gain potential is high.'
        : totalSub > 3 ? 'Well subscribed — good demand signal. Fair chance of allotment.'
        : totalSub > 1 ? 'Moderately subscribed — allotment likely, but demand is not exceptional.'
        : totalSub > 0 ? 'Undersubscribed — below expectations. Proceed with caution.'
        : 'Subscription data not yet available.';

    // Investment checklist — null means data not available (shows as unknown, not fail)
    const checks = [
        { label: 'Company is profitable',  pass: fin.patMargin != null ? fin.patMargin > 0 : null,      note: fin.patMargin != null ? `PAT Margin: ${fin.patMargin}%` : 'Not yet listed — financials unavailable' },
        { label: 'Revenue is growing',     pass: fin.revenueGrowth != null ? fin.revenueGrowth > 0 : null, note: fin.revenueGrowth != null ? `Growth: ${fin.revenueGrowth}%` : 'Not yet listed — financials unavailable' },
        { label: 'Low debt levels',        pass: fin.debtToEquity != null ? fin.debtToEquity < 1 : null,  note: fin.debtToEquity != null ? `D/E: ${fin.debtToEquity}` : 'Not yet listed — financials unavailable' },
        { label: 'Reasonable valuation',   pass: val.peRatio != null ? val.peRatio < 40 : null,           note: val.peRatio != null ? `P/E: ${val.peRatio}x` : 'P/E not available for unlisted company' },
        { label: 'GMP is positive',        pass: detail.gmp ? gmpVal > 0 : null,                          note: gmpVal > 0 ? `GMP: ₹${gmpVal} (~${gmpPct}% premium)` : detail.gmp ? 'Zero/negative GMP' : 'No GMP data yet' },
        { label: 'Positive news sentiment',pass: (detail.sentiment?.score || 0) > 0 ? (detail.sentiment.score >= 55) : null, note: detail.sentiment?.score ? `Sentiment score: ${detail.sentiment.score}/100` : 'No news data' },
        { label: 'Subscribed above 1x',   pass: totalSub > 0 ? totalSub >= 1 : null,                     note: totalSub > 0 ? `${totalSub.toFixed(2)}x subscribed` : 'Subscription not yet open' },
    ];

    const passCount = checks.filter(c => c.pass === true).length;
    const totalChecks = checks.filter(c => c.pass !== null).length;

    return `
    <div class="ipo-deep-container">
        <div class="ipo-deep-header">
            <h3><i class="fas fa-microscope"></i> Deep Analysis — ${detail.companyName}</h3>
            <span class="ipo-deep-score-pill" style="background:${score >= 75 ? 'rgba(16,185,129,0.15)' : score >= 50 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)'}; color:${score >= 75 ? 'var(--accent-green)' : score >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)'}">
                ${score}/100 · ${s.verdict}
            </span>
        </div>

        <!-- Investment Checklist -->
        <div class="ipo-deep-section">
            <div class="ipo-deep-section-title"><i class="fas fa-clipboard-check"></i> Investment Checklist <span class="ipo-deep-check-count">${passCount}/${totalChecks} passed</span></div>
            <div class="ipo-deep-checklist">
                ${checks.map(c => `
                    <div class="ipo-deep-check-item ${c.pass === true ? 'pass' : c.pass === false ? 'fail' : 'unknown'}">
                        <i class="fas ${c.pass === true ? 'fa-check-circle' : c.pass === null ? 'fa-question-circle' : 'fa-times-circle'}"></i>
                        <div class="ipo-deep-check-info">
                            <span class="ipo-deep-check-label">${c.label}</span>
                            <span class="ipo-deep-check-note">${c.note}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- Listing Gain Estimate -->
        ${gmpPct ? `
        <div class="ipo-deep-section">
            <div class="ipo-deep-section-title"><i class="fas fa-rocket"></i> Listing Gain Estimate</div>
            <div class="ipo-deep-gain-card">
                <div class="ipo-deep-gain-main">
                    <span class="ipo-deep-gain-pct ${gmpVal > 0 ? 'up' : 'down'}">+${gmpPct}%</span>
                    <span class="ipo-deep-gain-label">Expected listing gain based on GMP ₹${gmpVal}</span>
                </div>
                <p class="ipo-deep-gain-note">Grey Market Premium reflects unofficial demand before listing. It's speculative and may differ from actual listing. Strong GMP (>10%) usually signals positive market sentiment.</p>
            </div>
        </div>` : ''}

        <!-- Subscription Insights -->
        ${totalSub > 0 ? `
        <div class="ipo-deep-section">
            <div class="ipo-deep-section-title"><i class="fas fa-users"></i> Subscription Analysis</div>
            <div class="ipo-deep-sub-insight">
                <div class="ipo-deep-sub-meter">
                    <div class="ipo-deep-sub-fill" style="width:${Math.min(100, totalSub * 5)}%; background:${totalSub > 10 ? 'var(--accent-green)' : totalSub > 3 ? 'var(--accent-yellow)' : 'var(--accent-red)'}"></div>
                </div>
                <span class="ipo-deep-sub-times">${totalSub.toFixed(2)}x subscribed</span>
                <p class="ipo-deep-sub-text">${subAnalysis}</p>
            </div>
        </div>` : ''}

        <!-- Investor Type Suitability -->
        <div class="ipo-deep-section">
            <div class="ipo-deep-section-title"><i class="fas fa-user-tie"></i> Suitable For</div>
            <div class="ipo-deep-investor-types">
                ${investorTypes.map(t => `
                    <div class="ipo-deep-investor-card ${t.apply ? 'apply' : 'skip'}">
                        <div class="ipo-deep-investor-header">
                            <span class="ipo-deep-investor-type">${t.type}</span>
                            <span class="ipo-deep-investor-verdict ${t.apply ? 'apply' : 'skip'}">${t.apply ? 'Apply' : 'Skip'}</span>
                        </div>
                        <p class="ipo-deep-investor-reason">${t.reason}</p>
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- Risk Analysis -->
        <div class="ipo-deep-section">
            <div class="ipo-deep-section-title"><i class="fas fa-shield-alt"></i> Risk Assessment</div>
            <div class="ipo-deep-risk-card">
                <div class="ipo-deep-risk-level" style="color:${riskColor}">
                    <span class="ipo-deep-risk-label">Risk Level</span>
                    <span class="ipo-deep-risk-value">${riskLabel}</span>
                </div>
                <ul class="ipo-deep-risk-list">
                    ${score < 50 ? '<li><i class="fas fa-exclamation-triangle"></i> AI score below 50 — more risks than opportunities identified</li>' : ''}
                    ${!fin.patMargin || fin.patMargin < 0 ? '<li><i class="fas fa-exclamation-triangle"></i> No confirmed profitability data</li>' : ''}
                    ${gmpVal <= 0 && detail.gmp ? '<li><i class="fas fa-exclamation-triangle"></i> Negative or zero GMP suggests subdued listing expectations</li>' : ''}
                    ${totalSub > 0 && totalSub < 1 ? '<li><i class="fas fa-exclamation-triangle"></i> Undersubscription increases listing loss risk</li>' : ''}
                    <li><i class="fas fa-info-circle" style="color:var(--accent-blue)"></i> Market conditions on listing day heavily influence actual gains</li>
                    <li><i class="fas fa-info-circle" style="color:var(--accent-blue)"></i> Always invest only what you can afford to lose in IPOs</li>
                </ul>
            </div>
        </div>

        <div class="ipo-deep-disclaimer">
            <i class="fas fa-robot"></i>
            <span>This deep analysis is generated by AI using publicly available data. It is <strong>not financial advice</strong>. Past IPO performance does not guarantee future results.</span>
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
