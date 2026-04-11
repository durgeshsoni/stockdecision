// ===== Client-Side Router =====
// Maps URL paths to app sections and keeps browser history in sync.

const ROUTE_MAP = {
    '/':          'home',
    '/ipo':       'ipo',
    '/screener':  'screener',
    '/dashboard': 'dashboard',
};

// Called by each section's show function to push the URL.
function setRoute(path) {
    if (window.location.pathname !== path) {
        history.pushState({ path }, '', path);
    }
}

// Dispatch a path → call the right show function.
// replaceHistory=true is used on initial page load (no extra history entry).
function navigateTo(path, replaceHistory) {
    const base = path.split('?')[0].replace(/\/$/, '') || '/';

    if (replaceHistory) {
        history.replaceState({ path: base }, '', base === '/' ? '/' : base);
    }

    // /stock/SYMBOL
    if (base.startsWith('/stock/')) {
        const symbol = decodeURIComponent(base.slice(7));
        const input = document.getElementById('stockInput');
        if (input) input.value = symbol;
        // Defer so DOM is ready
        setTimeout(() => { if (typeof startAnalysis === 'function') startAnalysis(); }, 0);
        return;
    }

    switch (base) {
        case '/ipo':
            if (typeof showIPOSection === 'function') showIPOSection();
            break;
        case '/screener':
            if (typeof showScreener === 'function') showScreener();
            break;
        case '/dashboard':
            if (typeof showDashboard === 'function') showDashboard();
            break;
        default:
            if (typeof goHome === 'function') goHome();
    }
}

// Browser back / forward buttons
window.addEventListener('popstate', (e) => {
    const path = e.state?.path || window.location.pathname;
    navigateTo(path, false);
});

// On first load, route to whatever URL the user opened directly
window.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;
    if (path && path !== '/') {
        navigateTo(path, true);
    }
});
