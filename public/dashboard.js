// ===== Dashboard & Alerts Management =====

// ===== API Helper =====

async function authApiCall(func, action, body = null) {
    const token = await getAuthToken();
    if (!token) { showLoginModal(); throw new Error('Login required'); }
    const url = `/api/${func}?action=${action}`;
    const opts = {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    };
    if (body) {
        opts.method = 'POST';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (res.status === 401) { showLoginModal(); throw new Error('Session expired'); }
    if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `Error ${res.status}`);
    }
    return res.json();
}

// ===== Dashboard =====

async function showDashboard() {
    const user = getCurrentUser();
    if (!user) { showLoginModal(); return; }

    // Hide other screens, show dashboard
    const welcome = document.getElementById('welcomeScreen');
    const beginner = document.getElementById('beginnerContent');
    const pro = document.getElementById('mainContent');
    const dashboard = document.getElementById('dashboardContent');

    if (welcome) welcome.classList.add('hidden');
    if (beginner) beginner.classList.add('hidden');
    if (pro) pro.classList.add('hidden');
    if (dashboard) dashboard.classList.remove('hidden');

    // Show loading state
    setDashboardLoading(true);

    try {
        const response = await authApiCall('user', 'dashboard');
        const data = response.dashboard || response;
        renderRecentSearches(data.recentSearches || []);
        renderWatchlist(data.watchlist || []);
        renderActiveAlerts(data.activeAlerts || []);
        renderFrequentStocks(data.frequentStocks || []);
    } catch (err) {
        console.error('Dashboard load error:', err);
        if (err.message !== 'Login required' && err.message !== 'Session expired') {
            showToast('Failed to load dashboard', 'error');
        }
    } finally {
        setDashboardLoading(false);
    }
}

function hideDashboard() {
    const dashboard = document.getElementById('dashboardContent');
    const welcome = document.getElementById('welcomeScreen');
    if (dashboard) dashboard.classList.add('hidden');
    if (welcome) welcome.classList.remove('hidden');
}

function setDashboardLoading(loading) {
    const grids = ['watchlistGrid', 'activeAlerts', 'recentSearches', 'frequentStocks'];
    grids.forEach(id => {
        const el = document.getElementById(id);
        if (el && loading) {
            el.innerHTML = '<div class="dash-loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>';
        }
    });
}

// ===== Render Functions =====

function renderRecentSearches(searches) {
    const container = document.getElementById('recentSearches');
    if (!container) return;

    if (!searches.length) {
        container.innerHTML = '<div class="dash-empty"><i class="fas fa-search"></i> No recent searches</div>';
        return;
    }

    container.innerHTML = searches.slice(0, 5).map(s => `
        <div class="dash-item clickable" onclick="analyzeFromDashboard('${s.symbol}')">
            <div class="dash-item-info">
                <span class="symbol">${s.symbol}</span>
                <span class="name">${s.name || ''}</span>
            </div>
            <div class="dash-item-meta">
                <span class="time">${formatTimeAgo(s.timestamp)}</span>
                <i class="fas fa-chevron-right"></i>
            </div>
        </div>
    `).join('');
}

function renderWatchlist(items) {
    const container = document.getElementById('watchlistGrid');
    if (!container) return;

    if (!items.length) {
        container.innerHTML = '<div class="dash-empty"><i class="fas fa-star"></i> Watchlist is empty. Analyze a stock and add it!</div>';
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="dash-item">
            <div class="dash-item-info clickable" onclick="analyzeFromDashboard('${item.symbol}')">
                <span class="symbol">${item.symbol}</span>
                <span class="name">${item.name || ''}</span>
            </div>
            <div class="dash-item-actions">
                <button class="dash-btn dash-btn-alert" onclick="showAlertModal('${item.symbol}', '${item.name || ''}', null, '${item.currency || 'INR'}')" title="Set Alert">
                    <i class="fas fa-bell"></i>
                </button>
                <button class="dash-btn dash-btn-remove" onclick="removeFromWatchlist('${item.symbol}')" title="Remove">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function renderActiveAlerts(alerts) {
    const container = document.getElementById('activeAlerts');
    if (!container) return;

    if (!alerts.length) {
        container.innerHTML = '<div class="dash-empty"><i class="fas fa-bell-slash"></i> No active alerts</div>';
        return;
    }

    container.innerHTML = alerts.map(alert => {
        const progress = calculateAlertProgress(alert);
        const dirIcon = alert.condition === 'above' ? 'fa-arrow-up' : 'fa-arrow-down';
        const dirClass = alert.condition === 'above' ? 'alert-up' : 'alert-down';
        return `
            <div class="dash-item dash-alert-item ${dirClass}">
                <div class="dash-item-info">
                    <span class="symbol">${alert.symbol}</span>
                    <span class="alert-condition">
                        <i class="fas ${dirIcon}"></i>
                        ${alert.condition} ${alert.currencySymbol || ''}${alert.targetPrice}
                    </span>
                </div>
                <div class="dash-alert-progress">
                    <div class="alert-progress-bar">
                        <div class="alert-progress-fill" style="width:${progress}%"></div>
                    </div>
                    <span class="alert-progress-text">${progress}%</span>
                </div>
                <button class="dash-btn dash-btn-cancel" onclick="cancelAlert('${alert.id}')" title="Cancel Alert">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    }).join('');
}

function renderFrequentStocks(stocks) {
    const container = document.getElementById('frequentStocks');
    if (!container) return;

    if (!stocks.length) {
        container.innerHTML = '<div class="dash-empty"><i class="fas fa-fire"></i> Start analyzing stocks to see trends</div>';
        return;
    }

    container.innerHTML = stocks.slice(0, 5).map(s => `
        <div class="dash-item clickable" onclick="analyzeFromDashboard('${s.symbol}')">
            <div class="dash-item-info">
                <span class="symbol">${s.symbol}</span>
                <span class="name">${s.name || ''}</span>
            </div>
            <div class="dash-item-count">
                <span class="count-badge">${s.count}x</span>
            </div>
        </div>
    `).join('');
}

// ===== Watchlist Actions =====

async function addToWatchlist(symbol, name) {
    try {
        await authApiCall('user', 'watchlist-add', { symbol, name });
        showToast(`${symbol} added to watchlist`, 'success');
    } catch (err) {
        if (err.message !== 'Login required' && err.message !== 'Session expired') {
            showToast(err.message || 'Failed to add to watchlist', 'error');
        }
    }
}

async function removeFromWatchlist(symbol) {
    try {
        await authApiCall('user', 'watchlist-remove', { symbol });
        showToast(`${symbol} removed from watchlist`, 'success');
        // Refresh dashboard if visible
        const dashboard = document.getElementById('dashboardContent');
        if (dashboard && !dashboard.classList.contains('hidden')) {
            showDashboard();
        }
    } catch (err) {
        if (err.message !== 'Login required' && err.message !== 'Session expired') {
            showToast(err.message || 'Failed to remove', 'error');
        }
    }
}

// ===== Alert Functions =====

let currentAlertData = {};

function showAlertModal(symbol, name, currentPrice, currency) {
    currentAlertData = { symbol, name, currentPrice, currency };

    const modal = document.getElementById('alertModal');
    const stockName = document.getElementById('alertStockName');
    const stockPrice = document.getElementById('alertStockPrice');
    const currencySymbol = document.getElementById('alertCurrencySymbol');
    const targetInput = document.getElementById('alertTargetPrice');
    const conditionSelect = document.getElementById('alertCondition');

    if (stockName) stockName.textContent = `${symbol} - ${name}`;
    if (stockPrice) stockPrice.textContent = currentPrice ? `Current: ${getCurrencySymbol(currency)}${currentPrice}` : '';
    if (currencySymbol) currencySymbol.textContent = getCurrencySymbol(currency);
    if (targetInput) targetInput.value = '';
    if (conditionSelect) conditionSelect.value = 'above';
    if (modal) modal.classList.remove('hidden');
}

function closeAlertModal() {
    const modal = document.getElementById('alertModal');
    if (modal) modal.classList.add('hidden');
    currentAlertData = {};
}

async function createAlert() {
    const conditionSelect = document.getElementById('alertCondition');
    const targetInput = document.getElementById('alertTargetPrice');

    const condition = conditionSelect ? conditionSelect.value : 'above';
    const targetPrice = targetInput ? parseFloat(targetInput.value) : NaN;

    if (isNaN(targetPrice) || targetPrice <= 0) {
        showToast('Enter a valid target price', 'error');
        return;
    }

    try {
        await authApiCall('alerts', 'create', {
            symbol: currentAlertData.symbol,
            name: currentAlertData.name,
            condition,
            targetPrice,
            currentPrice: currentAlertData.currentPrice,
            currency: currentAlertData.currency
        });
        closeAlertModal();
        showToast(`Alert created for ${currentAlertData.symbol}`, 'success');
        // Refresh dashboard if visible
        const dashboard = document.getElementById('dashboardContent');
        if (dashboard && !dashboard.classList.contains('hidden')) {
            showDashboard();
        }
    } catch (err) {
        if (err.message !== 'Login required' && err.message !== 'Session expired') {
            showToast(err.message || 'Failed to create alert', 'error');
        }
    }
}

async function cancelAlert(alertId) {
    try {
        await authApiCall('alerts', 'cancel', { alertId });
        showToast('Alert cancelled', 'success');
        // Refresh dashboard if visible
        const dashboard = document.getElementById('dashboardContent');
        if (dashboard && !dashboard.classList.contains('hidden')) {
            showDashboard();
        }
    } catch (err) {
        if (err.message !== 'Login required' && err.message !== 'Session expired') {
            showToast(err.message || 'Failed to cancel alert', 'error');
        }
    }
}

async function showAlerts() {
    // Show dashboard with focus on alerts
    await showDashboard();
    const alertsSection = document.getElementById('activeAlerts');
    if (alertsSection) {
        alertsSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// ===== Helpers =====

function analyzeFromDashboard(symbol) {
    hideDashboard();
    const input = document.getElementById('stockInput');
    if (input) {
        input.value = symbol;
        // Trigger analysis
        const analyzeBtn = document.getElementById('analyzeBtn');
        if (analyzeBtn) analyzeBtn.click();
    }
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return new Date(timestamp).toLocaleDateString();
}

function calculateAlertProgress(alert) {
    if (!alert.currentPrice || !alert.targetPrice || !alert.createdPrice) return 0;
    const total = Math.abs(alert.targetPrice - alert.createdPrice);
    if (total === 0) return 100;
    const current = Math.abs(alert.currentPrice - alert.createdPrice);
    return Math.min(100, Math.round((current / total) * 100));
}

function getCurrencySymbol(currency) {
    const symbols = { INR: '\u20B9', USD: '$', EUR: '\u20AC', GBP: '\u00A3', JPY: '\u00A5' };
    return symbols[currency] || currency || '\u20B9';
}
