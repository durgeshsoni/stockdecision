# StockDecision — AI-Powered Stock Analysis Platform

> Smart stock analysis for Indian & US markets. Built with Netlify serverless functions, Firebase Auth, MongoDB Atlas, and a rule-based AI chat engine.

---

## 🗂️ Project Structure

```
stock-analyzer/
├── public/                         # All frontend files (Netlify publishes this)
│   ├── index.html                  # Main HTML — single-page app
│   ├── style.css                   # All styles (dark theme, CSS variables)
│   ├── app.js                      # Core logic — stock analysis engine, search, UI
│   ├── auth.js                     # Firebase Auth (Google + Phone OTP)
│   ├── dashboard.js                # User dashboard — watchlist, search history, alerts
│   ├── screener.js                 # Stock screener — filter by sector, PE, ROE, MCap
│   ├── chat.js                     # AI chat assistant (rule-based, no paid API)
│   └── ipo.js                      # IPO Analyzer — listing, detail view, scoring
│
├── netlify/
│   ├── functions/                  # Netlify serverless functions (ESM .mjs)
│   │   ├── yahoo.mjs               # Yahoo Finance proxy (chart, fundamentals, news, screener)
│   │   ├── auth.mjs                # User auth & profile management
│   │   ├── alerts.mjs              # Price alert CRUD
│   │   ├── user.mjs                # Search history, watchlist, dashboard data
│   │   ├── ipo.mjs                 # IPO data fetching, scoring, caching
│   │   └── check-alerts.mts       # Scheduled function — runs every 15 min
│   └── lib/
│       ├── mongodb.mjs             # MongoDB connection with pooling
│       └── firebase-admin.mjs      # Firebase Admin SDK for token verification
│
├── server.js                       # Local dev server (Node.js, port 3000)
├── netlify.toml                    # Netlify build & redirect config
├── package.json                    # Dependencies
└── .gitignore
```

---

## ⚙️ Environment Variables

Create a **`.env`** file in the root (never commit this). Required for both local dev and Netlify:

```env
# MongoDB Atlas
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
MONGODB_DB_NAME=stock_analyzer

# Firebase Admin SDK (for server-side token verification)
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nXXX\n-----END PRIVATE KEY-----\n"

# Resend (for price alert email notifications)
RESEND_API_KEY=re_xxxxxxxxxxxx
RESEND_FROM_EMAIL=alerts@yourdomain.com
```

> **On Netlify**: Add these in **Site Settings → Environment Variables**. They are automatically injected into serverless functions.

> **Locally**: The `server.js` dev server does NOT load `.env` automatically. Install `dotenv` or export variables manually if you need backend features locally:
> ```bash
> export MONGODB_URI="your-uri"
> node server.js
> ```

---

## 🚀 Getting Started (Local Dev)

### Prerequisites
- Node.js >= 18.0.0 (tested with Node 25 via Homebrew)
- npm

### 1. Clone & Install

```bash
git clone https://github.com/your-username/stock-analyzer.git
cd stock-analyzer
npm install
```

### 2. Run Local Server

```bash
node server.js
# or
npm start
```

Open **http://localhost:3000**

> The local dev server (`server.js`) serves files from `public/` and proxies Yahoo Finance API calls. MongoDB/Firebase features won't work locally without env vars, but core stock analysis and IPO browsing work without any credentials.

### 3. Run with Netlify CLI (Full Feature Dev)

For full serverless function support locally:

```bash
# Install Netlify CLI globally
npm install -g netlify-cli

# Login to Netlify
netlify login

# Link to your site
netlify link

# Run with all functions + env vars loaded
netlify dev
```

---

## 🌐 Deploying to Netlify

### Manual CLI Deploy

```bash
# Make sure you're logged in
netlify login

# Deploy to production
netlify deploy --prod
```

> If Node is not in PATH (common on Mac with Homebrew):
> ```bash
> export PATH="/opt/homebrew/opt/node@25/bin:$PATH"
> /opt/homebrew/bin/netlify deploy --prod
> ```

### Auto Deploy (Recommended)

1. Push to GitHub
2. Connect repo to Netlify (Site Settings → Build & Deploy → Link repository)
3. Set build settings:
   - **Publish directory**: `public`
   - **Functions directory**: `netlify/functions`
4. Add all environment variables in Netlify dashboard
5. Every `git push` to `main` will auto-deploy

---

## 🔧 Third-Party Services Setup

### Firebase (Authentication)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a project → Enable **Authentication**
3. Enable providers: **Google** and **Phone**
4. Go to Project Settings → **Service Accounts** → Generate new private key (download JSON)
5. Add `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` to env vars
6. In `public/auth.js`, update the `firebaseConfig` object with your Web API Key, Auth Domain, etc.
7. Add your domain to **Authorized Domains** in Firebase Auth settings

### MongoDB Atlas

1. Create a free cluster at [MongoDB Atlas](https://cloud.mongodb.com)
2. Create a database user with read/write access
3. Whitelist IP: `0.0.0.0/0` (for Netlify serverless — they use dynamic IPs)
4. Get connection string → add as `MONGODB_URI`
5. Collections created automatically on first use:
   - `users` — user profiles
   - `search_history` — per-user search logs
   - `watchlist` — saved stocks
   - `alerts` — price alerts
   - `alert_history` — triggered alert logs
   - `ipo_cache` — cached IPO data (30 min TTL)

### Resend (Email Alerts)

1. Sign up at [resend.com](https://resend.com)
2. Verify your domain (or use their sandbox for testing)
3. Create an API key → add as `RESEND_API_KEY`
4. Set `RESEND_FROM_EMAIL` to a verified sender address

---

## 🧠 Architecture & Key Concepts

### API Flow

```
Frontend (public/)
    ↓  fetch("/api/chart?symbol=RELIANCE.NS")
netlify.toml redirect
    ↓  /.netlify/functions/yahoo?type=chart&symbol=RELIANCE.NS
yahoo.mjs (serverless)
    ↓  proxies to Yahoo Finance API
Returns JSON to frontend
```

All API calls go through `apiGet(endpoint, params)` in `app.js`:
```js
async function apiGet(endpoint, params) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`/api/${endpoint}?${qs}`);
    return res.json();
}
```

### Stock Analysis Engine (`app.js → runAnalysis()`)

Scores each stock 0–100 using:
- **Technical Score (45%)**: SMA 20/50/200, RSI, MACD, Bollinger Bands, Volume
- **Fundamental Score (55%)**: PE ratio, ROE, Debt/Equity, Profit Margin, Revenue Growth, Dividend Yield

Verdict mapping:
| Score | Verdict | Action |
|-------|---------|--------|
| 72–100 | Strong Bullish | Strong Buy |
| 60–71 | Bullish | Buy |
| 52–59 | Slightly Bullish | Buy-Hold |
| 45–51 | Neutral | Hold-Watch |
| 35–44 | Slightly Bearish | Hold-Exit |
| 0–34 | Bearish | Sell-Avoid |

### IPO Scoring Engine (`netlify/functions/ipo.mjs → scoreIPO()`)

| Factor | Weight |
|--------|--------|
| Fundamentals (revenue growth, margins, ROE, debt) | 30 pts |
| Industry Potential | 20 pts |
| Valuation (P/E vs peers) | 20 pts |
| News Sentiment | 10 pts |
| Subscription Demand | 10 pts |
| Risk / GMP | 10 pts |

Verdict: **75+** = INVEST · **50–74** = NEUTRAL · **<50** = AVOID

### AI Chat (`public/chat.js`)

Rule-based, no paid API needed. Intents: `analyze`, `compare`, `dividend`, `sector`, `recommend`, `price`, `help`. Uses `runAnalysis()` and Yahoo Finance data to give real-time, natural responses.

---

## 📱 Features Overview

| Feature | Location | Notes |
|---------|----------|-------|
| Stock Search & Analysis | `app.js` | 70+ Indian & US stocks in `STOCK_DB` |
| Beginner / Pro Mode | `app.js` | Beginner = simple verdict, Pro = full technical+fundamental cards |
| AI Chat Assistant | `chat.js` | Click "Analyze with AI" in navbar |
| Stock Screener | `screener.js` | Filter by sector, PE, ROE, MCap, dividend, 1Y performance |
| IPO Analyzer | `ipo.js` + `ipo.mjs` | Lists Ongoing/Upcoming/Listed IPOs with AI scoring |
| Price Alerts | `alerts.mjs` | Email notifications via Resend, checked every 15 min |
| Watchlist | `user.mjs` | Up to 30 stocks, requires Firebase login |
| Dashboard | `dashboard.js` | Recent searches, most searched, watchlist, alerts |
| Ticker Bar | `app.js` | Indian indices only (Nifty 50, Sensex, Bank Nifty, etc.) |
| Google/Phone Login | `auth.js` | Firebase Auth with invisible reCAPTCHA for OTP |

---

## 🤖 Working with Claude Code on This Project

This project was built with Claude Code. Here's context to help Claude understand the codebase quickly:

### Key Patterns
- **No build step** — pure HTML/CSS/JS frontend, no React/Vue/webpack
- **Netlify Functions** must be `.mjs` (ESM format), not CommonJS
- **`apiGet(endpoint, params)`** is the standard way to call backend from frontend
- **CSS variables** are defined in `:root` in `style.css` — always use them (`var(--accent-blue)`, `var(--bg-card)`, etc.)
- **Dark theme only** — all colors use CSS variables from the dark theme palette
- **Section visibility** pattern: all sections have `class="hidden"`, toggle with `.classList.add/remove('hidden')`
- **Auth check**: use `getCurrentUser()` from `auth.js` — returns Firebase user or null

### Adding a New Section/Feature
1. Add HTML section in `public/index.html` with `id="xyzContent" class="hidden"`
2. Add show/hide functions that follow the pattern in `screener.js`
3. Update `goHome()` in `app.js` to include the new section ID in the hide array
4. Update all other `showX()` functions to hide the new section too
5. Add a nav button in the header's `.header-right` div
6. Add to mobile bottom bar if relevant
7. Add CSS in `style.css` (after the screener section)
8. Create `public/xyz.js` and add `<script src="xyz.js">` at bottom of `index.html`

### Adding a New Netlify Function
1. Create `netlify/functions/xyz.mjs`
2. Export a default async function: `export default async function handler(req) { ... }`
3. Add redirect in `netlify.toml`
4. Handle locally in `server.js` if needed for dev

### Common Gotchas
- The `server.js` serves from **`public/`** directory — edit files there, not root
- `check-alerts.mts` is TypeScript — Netlify handles compilation, don't rename it
- Firebase reCAPTCHA requires a DOM element — always reset it before OTP retries
- MongoDB connection uses `maxPoolSize: 1` for serverless compatibility
- Yahoo Finance has rate limits — the proxy tries `query2` first, falls back to `query1`

---

## 📦 Dependencies

| Package | Purpose |
|---------|---------|
| `firebase-admin` | Server-side Firebase token verification |
| `mongodb` | MongoDB Atlas connection |
| `resend` | Email sending for price alerts |

**Frontend CDNs** (no npm install needed):
- Chart.js 4.4.0 — price charts
- Font Awesome 6.4.0 — icons
- Google Fonts (Inter) — typography
- Firebase 10.8.0 (compat SDK) — auth

---

## 🛠️ Scripts

```bash
npm start          # Start local dev server (port 3000)
npm run dev        # Same as start

netlify dev        # Start with Netlify CLI (full serverless support)
netlify deploy --prod   # Deploy to production
```

---

## ⚠️ Important Notes

- **Financial Disclaimer**: This tool is for educational purposes only. Not financial advice.
- **Yahoo Finance**: Data is fetched via Yahoo Finance's unofficial API. No API key needed, but rate limits apply.
- **IPO Data**: Scraped from public sources (Investorgain, Chittorgarh). May occasionally be unavailable.
- **Phone Auth**: Requires a real phone number. Firebase free tier has OTP limits.
- **Alerts**: Price alert emails require Resend setup and a verified domain.

---

*Built with ❤️ by Durgesh Soni*
