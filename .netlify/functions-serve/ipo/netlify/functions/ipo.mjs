
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/lib/mongodb.mjs
import { MongoClient } from "mongodb";
var cachedClient = null;
var cachedDb = null;
async function getDb() {
  if (cachedClient && cachedDb) {
    return cachedDb;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set");
  }
  const client = new MongoClient(uri, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5e3
  });
  await client.connect();
  const dbName = process.env.MONGODB_DB_NAME || "stock_analyzer";
  const db = client.db(dbName);
  cachedClient = client;
  cachedDb = db;
  return db;
}

// netlify/functions/ipo.mjs
var HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
function respond(status, body) {
  return { statusCode: status, headers: HEADERS, body: JSON.stringify(body) };
}
function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
function categorizeIPO(ipo) {
  const now = /* @__PURE__ */ new Date();
  const open = parseDate(ipo.openDate);
  const close = parseDate(ipo.closeDate);
  const listing = parseDate(ipo.listingDate);
  if (listing && listing <= now) return "listed";
  if (open && close && open <= now && close >= now) return "ongoing";
  if (open && open > now) return "upcoming";
  if (close && close < now && (!listing || listing > now)) return "upcoming";
  return "upcoming";
}
async function fetchIPOListFromWeb() {
  const ipos = [];
  try {
    const igResp = await fetch("https://www.investorgain.com/report/live-ipo-gmp/331/current-ipo/", {
      headers: { "User-Agent": USER_AGENT }
    });
    if (igResp.ok) {
      const html = await igResp.text();
      const parsed = parseInvestorgainHTML(html);
      ipos.push(...parsed);
    }
  } catch (e) {
    console.log("Investorgain fetch failed:", e.message);
  }
  try {
    const igResp2 = await fetch("https://www.investorgain.com/report/live-ipo-gmp/331/all/", {
      headers: { "User-Agent": USER_AGENT }
    });
    if (igResp2.ok) {
      const html = await igResp2.text();
      const parsed = parseInvestorgainHTML(html);
      for (const ipo of parsed) {
        if (!ipos.find((i) => i.companyName === ipo.companyName)) {
          ipos.push(ipo);
        }
      }
    }
  } catch (e) {
    console.log("Investorgain all fetch failed:", e.message);
  }
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
      const getText = (cell) => cell.replace(/<[^>]+>/g, "").trim();
      const name = getText(cells[0]);
      if (!name || name.length < 2) continue;
      const ipo = {
        companyName: name,
        priceBand: getText(cells[1]) || "",
        gmp: getText(cells[2]) || "",
        openDate: getText(cells[3]) || "",
        closeDate: cells[4] ? getText(cells[4]) : "",
        listingDate: cells[5] ? getText(cells[5]) : "",
        ipoSize: cells[6] ? getText(cells[6]) : "",
        lotSize: cells[7] ? getText(cells[7]) : "",
        source: "investorgain"
      };
      if (ipo.companyName.length > 2) {
        ipos.push(ipo);
      }
    }
  }
  return ipos;
}
async function fetchFromChittorgarh() {
  const ipos = [];
  try {
    const resp = await fetch("https://www.chittorgarh.com/report/ipo-in-india-702/702/", {
      headers: { "User-Agent": USER_AGENT }
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
      const getText = (cell) => cell.replace(/<[^>]+>/g, "").trim();
      ipos.push({
        companyName: getText(cells[0]),
        openDate: getText(cells[1]),
        closeDate: getText(cells[2]),
        ipoSize: getText(cells[3]),
        priceBand: getText(cells[4]),
        listingDate: getText(cells[5]) || "",
        gmp: "",
        lotSize: "",
        source: "chittorgarh"
      });
    }
  } catch (e) {
    console.log("Chittorgarh fetch failed:", e.message);
  }
  return ipos;
}
async function fetchSubscriptionData(companyName) {
  try {
    const resp = await fetch("https://www.nseindia.com/api/ipo-current-issue", {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Referer": "https://www.nseindia.com/market-data/all-upcoming-issues-ipo"
      }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (Array.isArray(data)) {
      const match = data.find((item) => {
        const name = (item.companyName || item.symbol || "").toLowerCase();
        return name.includes(companyName.toLowerCase().split(" ")[0]);
      });
      if (match) {
        return {
          qib: match.subscriptionQIB || match.qib || null,
          hni: match.subscriptionHNI || match.hni || null,
          retail: match.subscriptionRetail || match.retail || null,
          total: match.subscriptionTotal || match.total || null,
          employee: match.subscriptionEmployee || null,
          lastUpdated: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
    }
  } catch (e) {
    console.log("NSE subscription fetch failed:", e.message);
  }
  return null;
}
async function fetchIPONews(companyName) {
  const articles = [];
  const query = encodeURIComponent(`${companyName} IPO`);
  try {
    const resp = await fetch(`https://news.google.com/rss/search?q=${query}&hl=en-IN&gl=IN&ceid=IN:en`, {
      headers: { "User-Agent": USER_AGENT }
    });
    if (resp.ok) {
      const xml = await resp.text();
      const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
      for (const item of items.slice(0, 10)) {
        const title = (item.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "";
        const link = (item.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || "";
        const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || "";
        const source = (item.match(/<source[^>]*>([\s\S]*?)<\/source>/i) || [])[1] || "";
        const cleanTitle = title.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "");
        articles.push({
          title: cleanTitle,
          link: link.replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1"),
          date: pubDate,
          source: source.replace(/<[^>]+>/g, ""),
          sentiment: analyzeSingleSentiment(cleanTitle)
        });
      }
    }
  } catch (e) {
    console.log("News fetch failed:", e.message);
  }
  return articles;
}
function analyzeSingleSentiment(text) {
  const lower = text.toLowerCase();
  const bullish = [
    "subscribe",
    "strong",
    "buy",
    "positive",
    "oversubscribed",
    "demand",
    "premium",
    "listing gain",
    "grey market",
    "gmp",
    "boom",
    "surge",
    "rally",
    "bullish",
    "upbeat",
    "robust",
    "stellar",
    "blockbuster",
    "record",
    "bumper",
    "allotment",
    "apply",
    "recommend",
    "good",
    "attractive"
  ];
  const bearish = [
    "avoid",
    "risk",
    "concern",
    "overpriced",
    "expensive",
    "caution",
    "weak",
    "loss",
    "decline",
    "crash",
    "negative",
    "sell",
    "dump",
    "bearish",
    "poor",
    "disappointing",
    "flop",
    "below",
    "discount",
    "trouble",
    "debt",
    "warning",
    "fraud",
    "scam",
    "controversy"
  ];
  let score = 0;
  for (const w of bullish) {
    if (lower.includes(w)) score++;
  }
  for (const w of bearish) {
    if (lower.includes(w)) score--;
  }
  return score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
}
function computeNewsSentiment(articles) {
  if (!articles || articles.length === 0) return { score: 50, label: "neutral", positive: 0, negative: 0, neutral: 0 };
  let positive = 0, negative = 0, neutral = 0;
  for (const a of articles) {
    if (a.sentiment === "positive") positive++;
    else if (a.sentiment === "negative") negative++;
    else neutral++;
  }
  const total = articles.length;
  const sentimentScore = Math.round(positive / total * 100 + neutral / total * 50);
  return {
    score: Math.min(100, sentimentScore),
    label: sentimentScore >= 65 ? "positive" : sentimentScore >= 40 ? "neutral" : "negative",
    positive,
    negative,
    neutral,
    total
  };
}
function scoreIPO(ipo) {
  let score = 50;
  const pros = [];
  const cons = [];
  let fundScore = 15;
  if (ipo.financials) {
    const fin = ipo.financials;
    if (fin.revenueGrowth > 25) {
      fundScore += 8;
      pros.push("Strong revenue growth (>" + fin.revenueGrowth + "%)");
    } else if (fin.revenueGrowth > 10) {
      fundScore += 4;
      pros.push("Healthy revenue growth");
    } else if (fin.revenueGrowth < 0) {
      fundScore -= 6;
      cons.push("Revenue declining");
    }
    if (fin.patMargin > 15) {
      fundScore += 6;
      pros.push("High profit margins (" + fin.patMargin + "%)");
    } else if (fin.patMargin > 5) {
      fundScore += 2;
    } else if (fin.patMargin < 0) {
      fundScore -= 8;
      cons.push("Company is loss-making");
    }
    if (fin.roe > 20) {
      fundScore += 5;
      pros.push("Excellent ROE (" + fin.roe + "%)");
    } else if (fin.roe > 12) {
      fundScore += 2;
    } else if (fin.roe < 8) {
      fundScore -= 3;
      cons.push("Low return on equity");
    }
    if (fin.debtToEquity < 0.3) {
      fundScore += 4;
      pros.push("Low debt, clean balance sheet");
    } else if (fin.debtToEquity > 1.5) {
      fundScore -= 5;
      cons.push("High debt levels (D/E: " + fin.debtToEquity + ")");
    }
  }
  fundScore = Math.max(0, Math.min(30, fundScore));
  let industryScore = 10;
  const hotSectors = ["technology", "it", "fintech", "ev", "renewable", "solar", "green energy", "ai", "semiconductor", "defence", "healthcare", "pharma", "digital"];
  const coldSectors = ["real estate", "textile", "sugar", "paper", "mining"];
  const industry = (ipo.industry || "").toLowerCase();
  if (hotSectors.some((s) => industry.includes(s))) {
    industryScore += 8;
    pros.push("High-growth industry sector");
  }
  if (coldSectors.some((s) => industry.includes(s))) {
    industryScore -= 5;
    cons.push("Sector has limited growth outlook");
  }
  industryScore = Math.max(0, Math.min(20, industryScore));
  let valuationScore = 10;
  if (ipo.valuation) {
    if (ipo.valuation.peRatio) {
      if (ipo.valuation.peRatio < 15) {
        valuationScore += 8;
        pros.push("Attractively priced (P/E: " + ipo.valuation.peRatio + ")");
      } else if (ipo.valuation.peRatio < 25) {
        valuationScore += 4;
        pros.push("Reasonably valued");
      } else if (ipo.valuation.peRatio > 50) {
        valuationScore -= 7;
        cons.push("Expensive valuation (P/E: " + ipo.valuation.peRatio + ")");
      } else if (ipo.valuation.peRatio > 35) {
        valuationScore -= 3;
        cons.push("Premium pricing compared to peers");
      }
    }
    if (ipo.valuation.peerComparison === "underpriced") {
      valuationScore += 5;
      pros.push("Priced lower than listed peers");
    } else if (ipo.valuation.peerComparison === "overpriced") {
      valuationScore -= 5;
      cons.push("Overpriced compared to listed competitors");
    }
  }
  valuationScore = Math.max(0, Math.min(20, valuationScore));
  let sentimentScore = 5;
  if (ipo.sentiment) {
    if (ipo.sentiment.score >= 70) {
      sentimentScore = 9;
      pros.push("Very positive market buzz");
    } else if (ipo.sentiment.score >= 50) {
      sentimentScore = 6;
    } else if (ipo.sentiment.score < 35) {
      sentimentScore = 2;
      cons.push("Negative news sentiment");
    }
  }
  sentimentScore = Math.max(0, Math.min(10, sentimentScore));
  let subScore = 5;
  if (ipo.subscription) {
    const total = parseFloat(ipo.subscription.total) || 0;
    if (total > 20) {
      subScore = 10;
      pros.push("Massively oversubscribed (" + total + "x)");
    } else if (total > 5) {
      subScore = 8;
      pros.push("Strong subscription demand (" + total + "x)");
    } else if (total > 1) {
      subScore = 6;
    } else if (total > 0 && total < 0.5) {
      subScore = 2;
      cons.push("Very low subscription demand");
    }
    const qib = parseFloat(ipo.subscription.qib) || 0;
    if (qib > 10) {
      pros.push("Institutional investors showing high confidence");
    } else if (qib < 0.5 && qib > 0) {
      cons.push("Weak institutional interest");
    }
  }
  subScore = Math.max(0, Math.min(10, subScore));
  let riskScore = 8;
  const gmpVal = parseFloat((ipo.gmp || "").replace(/[^\d.-]/g, ""));
  if (!isNaN(gmpVal)) {
    if (gmpVal > 100) {
      riskScore = 10;
      pros.push("Very high GMP (\u20B9" + gmpVal + ") \u2014 strong listing expected");
    } else if (gmpVal > 30) {
      riskScore = 8;
      pros.push("Positive GMP (\u20B9" + gmpVal + ")");
    } else if (gmpVal > 0) {
      riskScore = 6;
    } else if (gmpVal <= 0) {
      riskScore = 3;
      cons.push("Zero or negative GMP \u2014 listing losses possible");
    }
  }
  const sizeStr = (ipo.ipoSize || "").replace(/[^\d.]/g, "");
  const sizeVal = parseFloat(sizeStr);
  if (!isNaN(sizeVal) && sizeVal > 5e3) {
    pros.push("Large IPO \u2014 likely institutional-quality company");
  }
  if (!isNaN(sizeVal) && sizeVal < 50) {
    cons.push("Very small IPO size \u2014 higher risk");
    riskScore -= 2;
  }
  riskScore = Math.max(0, Math.min(10, riskScore));
  score = fundScore + industryScore + valuationScore + sentimentScore + subScore + riskScore;
  score = Math.max(0, Math.min(100, score));
  let verdict, verdictColor;
  if (score >= 75) {
    verdict = "INVEST";
    verdictColor = "green";
  } else if (score >= 50) {
    verdict = "NEUTRAL";
    verdictColor = "yellow";
  } else {
    verdict = "AVOID";
    verdictColor = "red";
  }
  const summaryParts = [];
  if (score >= 75) summaryParts.push(`${ipo.companyName} looks like a strong IPO opportunity.`);
  else if (score >= 50) summaryParts.push(`${ipo.companyName} shows a mixed picture.`);
  else summaryParts.push(`${ipo.companyName} carries significant risks.`);
  if (pros.length > 0) summaryParts.push(pros[0] + ".");
  if (cons.length > 0) summaryParts.push("However, " + cons[0].toLowerCase() + ".");
  return {
    score,
    verdict,
    verdictColor,
    summary: summaryParts.join(" "),
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
async function fetchYahooData(companyName) {
  try {
    const searchTerm = encodeURIComponent(companyName + " NSE");
    const searchResp = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${searchTerm}&quotesCount=3&newsCount=0`, {
      headers: { "User-Agent": USER_AGENT }
    });
    if (!searchResp.ok) return null;
    const searchData = await searchResp.json();
    const quote = (searchData.quotes || []).find(
      (q) => q.exchange === "NSI" || q.exchange === "BSE" || q.exchange === "NSE"
    );
    if (!quote) return null;
    const symbol = quote.symbol;
    const fundResp = await fetch(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=summaryProfile,financialData,defaultKeyStatistics,earnings,incomeStatementHistory`, {
      headers: { "User-Agent": USER_AGENT }
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
      industry: sp.industry || "",
      sector: sp.sector || "",
      description: sp.longBusinessSummary || "",
      financials: {
        revenueGrowth: fd.revenueGrowth?.raw ? (fd.revenueGrowth.raw * 100).toFixed(1) : null,
        patMargin: fd.profitMargins?.raw ? (fd.profitMargins.raw * 100).toFixed(1) : null,
        roe: fd.returnOnEquity?.raw ? (fd.returnOnEquity.raw * 100).toFixed(1) : null,
        roce: fd.returnOnAssets?.raw ? (fd.returnOnAssets.raw * 100).toFixed(1) : null,
        debtToEquity: fd.debtToEquity?.raw || null,
        currentRatio: fd.currentRatio?.raw || null,
        revenue: fd.totalRevenue?.raw || null,
        ebitda: fd.ebitda?.raw || null
      },
      valuation: {
        peRatio: ks.forwardPE?.raw || ks.trailingPE?.raw || null,
        pbRatio: ks.priceToBook?.raw || null,
        marketCap: fd.marketCap?.raw || null
      },
      competitors: sp.industryKey ? await fetchPeers(sp.industryKey) : []
    };
  } catch (e) {
    console.log("Yahoo data fetch failed:", e.message);
    return null;
  }
}
async function fetchPeers(industryKey) {
  return [];
}
async function getCachedIPOList(db) {
  const cache = await db.collection("ipo_cache").findOne({ _id: "ipo_list" });
  if (cache && cache.updatedAt) {
    const age = Date.now() - new Date(cache.updatedAt).getTime();
    if (age < 30 * 60 * 1e3) {
      return cache.data;
    }
  }
  return null;
}
async function setCachedIPOList(db, data) {
  await db.collection("ipo_cache").updateOne(
    { _id: "ipo_list" },
    { $set: { data, updatedAt: /* @__PURE__ */ new Date() } },
    { upsert: true }
  );
}
async function getCachedIPODetail(db, name) {
  const key = "ipo_detail_" + name.replace(/\s+/g, "_").toLowerCase();
  const cache = await db.collection("ipo_cache").findOne({ _id: key });
  if (cache && cache.updatedAt) {
    const age = Date.now() - new Date(cache.updatedAt).getTime();
    if (age < 2 * 60 * 60 * 1e3) {
      return cache.data;
    }
  }
  return null;
}
async function setCachedIPODetail(db, name, data) {
  const key = "ipo_detail_" + name.replace(/\s+/g, "_").toLowerCase();
  await db.collection("ipo_cache").updateOne(
    { _id: key },
    { $set: { data, updatedAt: /* @__PURE__ */ new Date() } },
    { upsert: true }
  );
}
async function handler(req) {
  if (req.method === "OPTIONS") {
    return { statusCode: 204, headers: HEADERS };
  }
  const url = new URL(req.url, "https://localhost");
  const type = url.searchParams.get("type") || "list";
  try {
    let db;
    try {
      db = await getDb();
    } catch (e) {
      db = null;
    }
    switch (type) {
      case "list":
        return await handleList(db);
      case "detail":
        const name = url.searchParams.get("name");
        if (!name) return respond(400, { error: 'Missing "name" parameter' });
        return await handleDetail(db, name);
      case "news":
        const company = url.searchParams.get("name");
        if (!company) return respond(400, { error: 'Missing "name" parameter' });
        return await handleNews(company);
      case "refresh":
        return await handleRefresh(db);
      default:
        return respond(400, { error: "Invalid type. Use: list, detail, news, refresh" });
    }
  } catch (err) {
    console.error("IPO handler error:", err);
    return respond(500, { error: "Internal error", message: err.message });
  }
}
async function handleList(db) {
  if (db) {
    const cached = await getCachedIPOList(db);
    if (cached) return respond(200, cached);
  }
  let ipos = await fetchIPOListFromWeb();
  if (ipos.length === 0) {
    ipos = await fetchFromChittorgarh();
  }
  if (ipos.length === 0) {
    return respond(200, {
      upcoming: [],
      ongoing: [],
      listed: [],
      lastUpdated: (/* @__PURE__ */ new Date()).toISOString(),
      source: "fallback",
      message: "IPO data sources temporarily unavailable. Please try again later."
    });
  }
  const categorized = { upcoming: [], ongoing: [], listed: [] };
  for (const ipo of ipos) {
    ipo.category = categorizeIPO(ipo);
    const gmpStr = (ipo.gmp || "").replace(/[^\d.-]/g, "");
    ipo.gmpValue = parseFloat(gmpStr) || 0;
    const priceMatch = (ipo.priceBand || "").match(/(\d+)\s*[-–to]+\s*(\d+)/);
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
    lastUpdated: (/* @__PURE__ */ new Date()).toISOString(),
    source: "live"
  };
  if (db) {
    await setCachedIPOList(db, result).catch(() => {
    });
  }
  return respond(200, result);
}
async function handleDetail(db, companyName) {
  if (db) {
    const cached = await getCachedIPODetail(db, companyName);
    if (cached) return respond(200, cached);
  }
  const newsArticles = await fetchIPONews(companyName);
  const sentiment = computeNewsSentiment(newsArticles);
  const yahooData = await fetchYahooData(companyName);
  const subscription = await fetchSubscriptionData(companyName);
  const detail = {
    companyName,
    industry: yahooData?.industry || yahooData?.sector || "",
    description: yahooData?.description || "",
    symbol: yahooData?.symbol || "",
    financials: yahooData?.financials || null,
    valuation: yahooData?.valuation || null,
    sentiment,
    news: newsArticles.slice(0, 8),
    subscription,
    competitors: yahooData?.competitors || [],
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const scoring = scoreIPO({
    ...detail,
    gmp: "",
    // Will be populated from list data on frontend
    ipoSize: ""
  });
  detail.scoring = scoring;
  if (db) {
    await setCachedIPODetail(db, companyName, detail).catch(() => {
    });
  }
  return respond(200, detail);
}
async function handleNews(companyName) {
  const articles = await fetchIPONews(companyName);
  const sentiment = computeNewsSentiment(articles);
  return respond(200, { articles, sentiment });
}
async function handleRefresh(db) {
  if (db) {
    await db.collection("ipo_cache").deleteOne({ _id: "ipo_list" });
  }
  return await handleList(db);
}
export {
  handler as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9saWIvbW9uZ29kYi5tanMiLCAibmV0bGlmeS9mdW5jdGlvbnMvaXBvLm1qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgTW9uZ29DbGllbnQgfSBmcm9tICdtb25nb2RiJztcblxubGV0IGNhY2hlZENsaWVudCA9IG51bGw7XG5sZXQgY2FjaGVkRGIgPSBudWxsO1xuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0RGIoKSB7XG4gIGlmIChjYWNoZWRDbGllbnQgJiYgY2FjaGVkRGIpIHtcbiAgICByZXR1cm4gY2FjaGVkRGI7XG4gIH1cblxuICBjb25zdCB1cmkgPSBwcm9jZXNzLmVudi5NT05HT0RCX1VSSTtcbiAgaWYgKCF1cmkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ01PTkdPREJfVVJJIGVudmlyb25tZW50IHZhcmlhYmxlIGlzIG5vdCBzZXQnKTtcbiAgfVxuXG4gIGNvbnN0IGNsaWVudCA9IG5ldyBNb25nb0NsaWVudCh1cmksIHtcbiAgICBtYXhQb29sU2l6ZTogMSxcbiAgICBzZXJ2ZXJTZWxlY3Rpb25UaW1lb3V0TVM6IDUwMDAsXG4gIH0pO1xuXG4gIGF3YWl0IGNsaWVudC5jb25uZWN0KCk7XG5cbiAgY29uc3QgZGJOYW1lID0gcHJvY2Vzcy5lbnYuTU9OR09EQl9EQl9OQU1FIHx8ICdzdG9ja19hbmFseXplcic7XG4gIGNvbnN0IGRiID0gY2xpZW50LmRiKGRiTmFtZSk7XG5cbiAgY2FjaGVkQ2xpZW50ID0gY2xpZW50O1xuICBjYWNoZWREYiA9IGRiO1xuXG4gIHJldHVybiBkYjtcbn1cbiIsICIvLyA9PT09PSBJUE8gQW5hbHl6ZXIgXHUyMDE0IE5ldGxpZnkgU2VydmVybGVzcyBGdW5jdGlvbiA9PT09PVxuLy8gRmV0Y2hlcyBJUE8gZGF0YSBmcm9tIG11bHRpcGxlIHB1YmxpYyBzb3VyY2VzLCBjYWNoZXMgaW4gTW9uZ29EQlxuLy8gRW5kcG9pbnRzOiBsaXN0LCBkZXRhaWwsIHN1YnNjcmlwdGlvbiwgcmVmcmVzaFxuXG5pbXBvcnQgeyBnZXREYiB9IGZyb20gJy4uL2xpYi9tb25nb2RiLm1qcyc7XG5cbmNvbnN0IEhFQURFUlMgPSB7XG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24nLFxuICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG59O1xuXG5jb25zdCBVU0VSX0FHRU5UID0gJ01vemlsbGEvNS4wIChXaW5kb3dzIE5UIDEwLjA7IFdpbjY0OyB4NjQpIEFwcGxlV2ViS2l0LzUzNy4zNiAoS0hUTUwsIGxpa2UgR2Vja28pIENocm9tZS8xMjAuMC4wLjAgU2FmYXJpLzUzNy4zNic7XG5cbi8vID09PT09IEhlbHBlcnMgPT09PT1cbmZ1bmN0aW9uIHJlc3BvbmQoc3RhdHVzLCBib2R5KSB7XG4gICAgcmV0dXJuIHsgc3RhdHVzQ29kZTogc3RhdHVzLCBoZWFkZXJzOiBIRUFERVJTLCBib2R5OiBKU09OLnN0cmluZ2lmeShib2R5KSB9O1xufVxuXG5mdW5jdGlvbiBwYXJzZURhdGUoc3RyKSB7XG4gICAgaWYgKCFzdHIpIHJldHVybiBudWxsO1xuICAgIC8vIEhhbmRsZSBmb3JtYXRzOiBcIkFwciAwNywgMjAyNlwiLCBcIjA3IEFwciAyMDI2XCIsIFwiMjAyNi0wNC0wN1wiXG4gICAgY29uc3QgZCA9IG5ldyBEYXRlKHN0cik7XG4gICAgcmV0dXJuIGlzTmFOKGQuZ2V0VGltZSgpKSA/IG51bGwgOiBkO1xufVxuXG5mdW5jdGlvbiBkYXlzQmV0d2VlbihkMSwgZDIpIHtcbiAgICByZXR1cm4gTWF0aC5jZWlsKChkMiAtIGQxKSAvICgxMDAwICogNjAgKiA2MCAqIDI0KSk7XG59XG5cbmZ1bmN0aW9uIGNhdGVnb3JpemVJUE8oaXBvKSB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgICBjb25zdCBvcGVuID0gcGFyc2VEYXRlKGlwby5vcGVuRGF0ZSk7XG4gICAgY29uc3QgY2xvc2UgPSBwYXJzZURhdGUoaXBvLmNsb3NlRGF0ZSk7XG4gICAgY29uc3QgbGlzdGluZyA9IHBhcnNlRGF0ZShpcG8ubGlzdGluZ0RhdGUpO1xuXG4gICAgaWYgKGxpc3RpbmcgJiYgbGlzdGluZyA8PSBub3cpIHJldHVybiAnbGlzdGVkJztcbiAgICBpZiAob3BlbiAmJiBjbG9zZSAmJiBvcGVuIDw9IG5vdyAmJiBjbG9zZSA+PSBub3cpIHJldHVybiAnb25nb2luZyc7XG4gICAgaWYgKG9wZW4gJiYgb3BlbiA+IG5vdykgcmV0dXJuICd1cGNvbWluZyc7XG4gICAgaWYgKGNsb3NlICYmIGNsb3NlIDwgbm93ICYmICghbGlzdGluZyB8fCBsaXN0aW5nID4gbm93KSkgcmV0dXJuICd1cGNvbWluZyc7IC8vIGJldHdlZW4gY2xvc2UgYW5kIGxpc3RpbmdcbiAgICByZXR1cm4gJ3VwY29taW5nJztcbn1cblxuLy8gPT09PT0gSVBPIERhdGEgRmV0Y2hlciBcdTIwMTQgSW52ZXN0b3JnYWluIC8gUHVibGljIEFQSXMgPT09PT1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hJUE9MaXN0RnJvbVdlYigpIHtcbiAgICBjb25zdCBpcG9zID0gW107XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBTb3VyY2UgMTogSW52ZXN0b3JnYWluIElQTyBBUEkgKHB1YmxpYywgZnJlZSlcbiAgICAgICAgY29uc3QgaWdSZXNwID0gYXdhaXQgZmV0Y2goJ2h0dHBzOi8vd3d3LmludmVzdG9yZ2Fpbi5jb20vcmVwb3J0L2xpdmUtaXBvLWdtcC8zMzEvY3VycmVudC1pcG8vJywge1xuICAgICAgICAgICAgaGVhZGVyczogeyAnVXNlci1BZ2VudCc6IFVTRVJfQUdFTlQgfVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGlnUmVzcC5vaykge1xuICAgICAgICAgICAgY29uc3QgaHRtbCA9IGF3YWl0IGlnUmVzcC50ZXh0KCk7XG4gICAgICAgICAgICBjb25zdCBwYXJzZWQgPSBwYXJzZUludmVzdG9yZ2FpbkhUTUwoaHRtbCk7XG4gICAgICAgICAgICBpcG9zLnB1c2goLi4ucGFyc2VkKTtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ0ludmVzdG9yZ2FpbiBmZXRjaCBmYWlsZWQ6JywgZS5tZXNzYWdlKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBTb3VyY2UgMjogU01FICsgTWFpbmJvYXJkIElQT3MgZnJvbSBhbm90aGVyIGVuZHBvaW50XG4gICAgICAgIGNvbnN0IGlnUmVzcDIgPSBhd2FpdCBmZXRjaCgnaHR0cHM6Ly93d3cuaW52ZXN0b3JnYWluLmNvbS9yZXBvcnQvbGl2ZS1pcG8tZ21wLzMzMS9hbGwvJywge1xuICAgICAgICAgICAgaGVhZGVyczogeyAnVXNlci1BZ2VudCc6IFVTRVJfQUdFTlQgfVxuICAgICAgICB9KTtcbiAgICAgICAgaWYgKGlnUmVzcDIub2spIHtcbiAgICAgICAgICAgIGNvbnN0IGh0bWwgPSBhd2FpdCBpZ1Jlc3AyLnRleHQoKTtcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlSW52ZXN0b3JnYWluSFRNTChodG1sKTtcbiAgICAgICAgICAgIC8vIE1lcmdlLCBhdm9pZGluZyBkdXBsaWNhdGVzXG4gICAgICAgICAgICBmb3IgKGNvbnN0IGlwbyBvZiBwYXJzZWQpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWlwb3MuZmluZChpID0+IGkuY29tcGFueU5hbWUgPT09IGlwby5jb21wYW55TmFtZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgaXBvcy5wdXNoKGlwbyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmxvZygnSW52ZXN0b3JnYWluIGFsbCBmZXRjaCBmYWlsZWQ6JywgZS5tZXNzYWdlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gaXBvcztcbn1cblxuZnVuY3Rpb24gcGFyc2VJbnZlc3RvcmdhaW5IVE1MKGh0bWwpIHtcbiAgICBjb25zdCBpcG9zID0gW107XG5cbiAgICAvLyBFeHRyYWN0IHRhYmxlIHJvd3MgZnJvbSB0aGUgSFRNTFxuICAgIC8vIFBhdHRlcm46IExvb2sgZm9yIElQTyBkYXRhIGluIHRhYmxlIGZvcm1hdFxuICAgIGNvbnN0IHRhYmxlTWF0Y2ggPSBodG1sLm1hdGNoKC88dGFibGVbXj5dKmNsYXNzPVwiW15cIl0qdGFibGVbXlwiXSpcIltePl0qPihbXFxzXFxTXSo/KTxcXC90YWJsZT4vZ2kpO1xuICAgIGlmICghdGFibGVNYXRjaCkgcmV0dXJuIGlwb3M7XG5cbiAgICBmb3IgKGNvbnN0IHRhYmxlIG9mIHRhYmxlTWF0Y2gpIHtcbiAgICAgICAgY29uc3Qgcm93cyA9IHRhYmxlLm1hdGNoKC88dHJbXj5dKj4oW1xcc1xcU10qPyk8XFwvdHI+L2dpKTtcbiAgICAgICAgaWYgKCFyb3dzKSBjb250aW51ZTtcblxuICAgICAgICBmb3IgKGxldCBpID0gMTsgaSA8IHJvd3MubGVuZ3RoOyBpKyspIHsgLy8gU2tpcCBoZWFkZXIgcm93XG4gICAgICAgICAgICBjb25zdCBjZWxscyA9IHJvd3NbaV0ubWF0Y2goLzx0ZFtePl0qPihbXFxzXFxTXSo/KTxcXC90ZD4vZ2kpO1xuICAgICAgICAgICAgaWYgKCFjZWxscyB8fCBjZWxscy5sZW5ndGggPCA0KSBjb250aW51ZTtcblxuICAgICAgICAgICAgY29uc3QgZ2V0VGV4dCA9IChjZWxsKSA9PiBjZWxsLnJlcGxhY2UoLzxbXj5dKz4vZywgJycpLnRyaW0oKTtcbiAgICAgICAgICAgIGNvbnN0IG5hbWUgPSBnZXRUZXh0KGNlbGxzWzBdKTtcblxuICAgICAgICAgICAgaWYgKCFuYW1lIHx8IG5hbWUubGVuZ3RoIDwgMikgY29udGludWU7XG5cbiAgICAgICAgICAgIGNvbnN0IGlwbyA9IHtcbiAgICAgICAgICAgICAgICBjb21wYW55TmFtZTogbmFtZSxcbiAgICAgICAgICAgICAgICBwcmljZUJhbmQ6IGdldFRleHQoY2VsbHNbMV0pIHx8ICcnLFxuICAgICAgICAgICAgICAgIGdtcDogZ2V0VGV4dChjZWxsc1syXSkgfHwgJycsXG4gICAgICAgICAgICAgICAgb3BlbkRhdGU6IGdldFRleHQoY2VsbHNbM10pIHx8ICcnLFxuICAgICAgICAgICAgICAgIGNsb3NlRGF0ZTogY2VsbHNbNF0gPyBnZXRUZXh0KGNlbGxzWzRdKSA6ICcnLFxuICAgICAgICAgICAgICAgIGxpc3RpbmdEYXRlOiBjZWxsc1s1XSA/IGdldFRleHQoY2VsbHNbNV0pIDogJycsXG4gICAgICAgICAgICAgICAgaXBvU2l6ZTogY2VsbHNbNl0gPyBnZXRUZXh0KGNlbGxzWzZdKSA6ICcnLFxuICAgICAgICAgICAgICAgIGxvdFNpemU6IGNlbGxzWzddID8gZ2V0VGV4dChjZWxsc1s3XSkgOiAnJyxcbiAgICAgICAgICAgICAgICBzb3VyY2U6ICdpbnZlc3RvcmdhaW4nXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBpZiAoaXBvLmNvbXBhbnlOYW1lLmxlbmd0aCA+IDIpIHtcbiAgICAgICAgICAgICAgICBpcG9zLnB1c2goaXBvKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBpcG9zO1xufVxuXG4vLyA9PT09PSBDaGl0dG9yZ2FyaCBJUE8gU2NyYXBlciAoYmFja3VwKSA9PT09PVxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hGcm9tQ2hpdHRvcmdhcmgoKSB7XG4gICAgY29uc3QgaXBvcyA9IFtdO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcCA9IGF3YWl0IGZldGNoKCdodHRwczovL3d3dy5jaGl0dG9yZ2FyaC5jb20vcmVwb3J0L2lwby1pbi1pbmRpYS03MDIvNzAyLycsIHtcbiAgICAgICAgICAgIGhlYWRlcnM6IHsgJ1VzZXItQWdlbnQnOiBVU0VSX0FHRU5UIH1cbiAgICAgICAgfSk7XG4gICAgICAgIGlmICghcmVzcC5vaykgcmV0dXJuIGlwb3M7XG4gICAgICAgIGNvbnN0IGh0bWwgPSBhd2FpdCByZXNwLnRleHQoKTtcblxuICAgICAgICBjb25zdCB0YWJsZU1hdGNoID0gaHRtbC5tYXRjaCgvPHRhYmxlW14+XSppZD1cInJlcG9ydF90YWJsZVteXCJdKlwiW14+XSo+KFtcXHNcXFNdKj8pPFxcL3RhYmxlPi9pKTtcbiAgICAgICAgaWYgKCF0YWJsZU1hdGNoKSByZXR1cm4gaXBvcztcblxuICAgICAgICBjb25zdCByb3dzID0gdGFibGVNYXRjaFswXS5tYXRjaCgvPHRyW14+XSo+KFtcXHNcXFNdKj8pPFxcL3RyPi9naSk7XG4gICAgICAgIGlmICghcm93cykgcmV0dXJuIGlwb3M7XG5cbiAgICAgICAgZm9yIChsZXQgaSA9IDE7IGkgPCByb3dzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCBjZWxscyA9IHJvd3NbaV0ubWF0Y2goLzx0ZFtePl0qPihbXFxzXFxTXSo/KTxcXC90ZD4vZ2kpO1xuICAgICAgICAgICAgaWYgKCFjZWxscyB8fCBjZWxscy5sZW5ndGggPCA2KSBjb250aW51ZTtcblxuICAgICAgICAgICAgY29uc3QgZ2V0VGV4dCA9IChjZWxsKSA9PiBjZWxsLnJlcGxhY2UoLzxbXj5dKz4vZywgJycpLnRyaW0oKTtcblxuICAgICAgICAgICAgaXBvcy5wdXNoKHtcbiAgICAgICAgICAgICAgICBjb21wYW55TmFtZTogZ2V0VGV4dChjZWxsc1swXSksXG4gICAgICAgICAgICAgICAgb3BlbkRhdGU6IGdldFRleHQoY2VsbHNbMV0pLFxuICAgICAgICAgICAgICAgIGNsb3NlRGF0ZTogZ2V0VGV4dChjZWxsc1syXSksXG4gICAgICAgICAgICAgICAgaXBvU2l6ZTogZ2V0VGV4dChjZWxsc1szXSksXG4gICAgICAgICAgICAgICAgcHJpY2VCYW5kOiBnZXRUZXh0KGNlbGxzWzRdKSxcbiAgICAgICAgICAgICAgICBsaXN0aW5nRGF0ZTogZ2V0VGV4dChjZWxsc1s1XSkgfHwgJycsXG4gICAgICAgICAgICAgICAgZ21wOiAnJyxcbiAgICAgICAgICAgICAgICBsb3RTaXplOiAnJyxcbiAgICAgICAgICAgICAgICBzb3VyY2U6ICdjaGl0dG9yZ2FyaCdcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmxvZygnQ2hpdHRvcmdhcmggZmV0Y2ggZmFpbGVkOicsIGUubWVzc2FnZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGlwb3M7XG59XG5cbi8vID09PT09IE5TRSBJUE8gU3Vic2NyaXB0aW9uIERhdGEgPT09PT1cbmFzeW5jIGZ1bmN0aW9uIGZldGNoU3Vic2NyaXB0aW9uRGF0YShjb21wYW55TmFtZSkge1xuICAgIHRyeSB7XG4gICAgICAgIC8vIE5TRSBwdWJsaWMgQVBJIGZvciBJUE8gc3Vic2NyaXB0aW9uXG4gICAgICAgIGNvbnN0IHJlc3AgPSBhd2FpdCBmZXRjaCgnaHR0cHM6Ly93d3cubnNlaW5kaWEuY29tL2FwaS9pcG8tY3VycmVudC1pc3N1ZScsIHtcbiAgICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICAgICAnVXNlci1BZ2VudCc6IFVTRVJfQUdFTlQsXG4gICAgICAgICAgICAgICAgJ0FjY2VwdCc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgICAgICAnUmVmZXJlcic6ICdodHRwczovL3d3dy5uc2VpbmRpYS5jb20vbWFya2V0LWRhdGEvYWxsLXVwY29taW5nLWlzc3Vlcy1pcG8nXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICghcmVzcC5vaykgcmV0dXJuIG51bGw7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZXNwLmpzb24oKTtcblxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShkYXRhKSkge1xuICAgICAgICAgICAgY29uc3QgbWF0Y2ggPSBkYXRhLmZpbmQoaXRlbSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgbmFtZSA9IChpdGVtLmNvbXBhbnlOYW1lIHx8IGl0ZW0uc3ltYm9sIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgICAgICAgIHJldHVybiBuYW1lLmluY2x1ZGVzKGNvbXBhbnlOYW1lLnRvTG93ZXJDYXNlKCkuc3BsaXQoJyAnKVswXSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgaWYgKG1hdGNoKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgICAgICAgcWliOiBtYXRjaC5zdWJzY3JpcHRpb25RSUIgfHwgbWF0Y2gucWliIHx8IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIGhuaTogbWF0Y2guc3Vic2NyaXB0aW9uSE5JIHx8IG1hdGNoLmhuaSB8fCBudWxsLFxuICAgICAgICAgICAgICAgICAgICByZXRhaWw6IG1hdGNoLnN1YnNjcmlwdGlvblJldGFpbCB8fCBtYXRjaC5yZXRhaWwgfHwgbnVsbCxcbiAgICAgICAgICAgICAgICAgICAgdG90YWw6IG1hdGNoLnN1YnNjcmlwdGlvblRvdGFsIHx8IG1hdGNoLnRvdGFsIHx8IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIGVtcGxveWVlOiBtYXRjaC5zdWJzY3JpcHRpb25FbXBsb3llZSB8fCBudWxsLFxuICAgICAgICAgICAgICAgICAgICBsYXN0VXBkYXRlZDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ05TRSBzdWJzY3JpcHRpb24gZmV0Y2ggZmFpbGVkOicsIGUubWVzc2FnZSk7XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xufVxuXG4vLyA9PT09PSBOZXdzIEZldGNoZXIgZm9yIElQTyA9PT09PVxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hJUE9OZXdzKGNvbXBhbnlOYW1lKSB7XG4gICAgY29uc3QgYXJ0aWNsZXMgPSBbXTtcbiAgICBjb25zdCBxdWVyeSA9IGVuY29kZVVSSUNvbXBvbmVudChgJHtjb21wYW55TmFtZX0gSVBPYCk7XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBHb29nbGUgTmV3cyBSU1NcbiAgICAgICAgY29uc3QgcmVzcCA9IGF3YWl0IGZldGNoKGBodHRwczovL25ld3MuZ29vZ2xlLmNvbS9yc3Mvc2VhcmNoP3E9JHtxdWVyeX0maGw9ZW4tSU4mZ2w9SU4mY2VpZD1JTjplbmAsIHtcbiAgICAgICAgICAgIGhlYWRlcnM6IHsgJ1VzZXItQWdlbnQnOiBVU0VSX0FHRU5UIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHJlc3Aub2spIHtcbiAgICAgICAgICAgIGNvbnN0IHhtbCA9IGF3YWl0IHJlc3AudGV4dCgpO1xuICAgICAgICAgICAgY29uc3QgaXRlbXMgPSB4bWwubWF0Y2goLzxpdGVtPihbXFxzXFxTXSo/KTxcXC9pdGVtPi9naSkgfHwgW107XG5cbiAgICAgICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBpdGVtcy5zbGljZSgwLCAxMCkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCB0aXRsZSA9IChpdGVtLm1hdGNoKC88dGl0bGU+KFtcXHNcXFNdKj8pPFxcL3RpdGxlPi9pKSB8fCBbXSlbMV0gfHwgJyc7XG4gICAgICAgICAgICAgICAgY29uc3QgbGluayA9IChpdGVtLm1hdGNoKC88bGluaz4oW1xcc1xcU10qPyk8XFwvbGluaz4vaSkgfHwgW10pWzFdIHx8ICcnO1xuICAgICAgICAgICAgICAgIGNvbnN0IHB1YkRhdGUgPSAoaXRlbS5tYXRjaCgvPHB1YkRhdGU+KFtcXHNcXFNdKj8pPFxcL3B1YkRhdGU+L2kpIHx8IFtdKVsxXSB8fCAnJztcbiAgICAgICAgICAgICAgICBjb25zdCBzb3VyY2UgPSAoaXRlbS5tYXRjaCgvPHNvdXJjZVtePl0qPihbXFxzXFxTXSo/KTxcXC9zb3VyY2U+L2kpIHx8IFtdKVsxXSB8fCAnJztcblxuICAgICAgICAgICAgICAgIGNvbnN0IGNsZWFuVGl0bGUgPSB0aXRsZS5yZXBsYWNlKC88IVxcW0NEQVRBXFxbKC4qPylcXF1cXF0+L2csICckMScpLnJlcGxhY2UoLzxbXj5dKz4vZywgJycpO1xuXG4gICAgICAgICAgICAgICAgYXJ0aWNsZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgICAgIHRpdGxlOiBjbGVhblRpdGxlLFxuICAgICAgICAgICAgICAgICAgICBsaW5rOiBsaW5rLnJlcGxhY2UoLzwhXFxbQ0RBVEFcXFsoLio/KVxcXVxcXT4vZywgJyQxJyksXG4gICAgICAgICAgICAgICAgICAgIGRhdGU6IHB1YkRhdGUsXG4gICAgICAgICAgICAgICAgICAgIHNvdXJjZTogc291cmNlLnJlcGxhY2UoLzxbXj5dKz4vZywgJycpLFxuICAgICAgICAgICAgICAgICAgICBzZW50aW1lbnQ6IGFuYWx5emVTaW5nbGVTZW50aW1lbnQoY2xlYW5UaXRsZSlcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ05ld3MgZmV0Y2ggZmFpbGVkOicsIGUubWVzc2FnZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFydGljbGVzO1xufVxuXG5mdW5jdGlvbiBhbmFseXplU2luZ2xlU2VudGltZW50KHRleHQpIHtcbiAgICBjb25zdCBsb3dlciA9IHRleHQudG9Mb3dlckNhc2UoKTtcblxuICAgIGNvbnN0IGJ1bGxpc2ggPSBbJ3N1YnNjcmliZScsICdzdHJvbmcnLCAnYnV5JywgJ3Bvc2l0aXZlJywgJ292ZXJzdWJzY3JpYmVkJywgJ2RlbWFuZCcsICdwcmVtaXVtJywgJ2xpc3RpbmcgZ2FpbicsXG4gICAgICAgICdncmV5IG1hcmtldCcsICdnbXAnLCAnYm9vbScsICdzdXJnZScsICdyYWxseScsICdidWxsaXNoJywgJ3VwYmVhdCcsICdyb2J1c3QnLCAnc3RlbGxhcicsICdibG9ja2J1c3RlcicsXG4gICAgICAgICdyZWNvcmQnLCAnYnVtcGVyJywgJ2FsbG90bWVudCcsICdhcHBseScsICdyZWNvbW1lbmQnLCAnZ29vZCcsICdhdHRyYWN0aXZlJ107XG5cbiAgICBjb25zdCBiZWFyaXNoID0gWydhdm9pZCcsICdyaXNrJywgJ2NvbmNlcm4nLCAnb3ZlcnByaWNlZCcsICdleHBlbnNpdmUnLCAnY2F1dGlvbicsICd3ZWFrJywgJ2xvc3MnLCAnZGVjbGluZScsXG4gICAgICAgICdjcmFzaCcsICduZWdhdGl2ZScsICdzZWxsJywgJ2R1bXAnLCAnYmVhcmlzaCcsICdwb29yJywgJ2Rpc2FwcG9pbnRpbmcnLCAnZmxvcCcsICdiZWxvdycsICdkaXNjb3VudCcsXG4gICAgICAgICd0cm91YmxlJywgJ2RlYnQnLCAnd2FybmluZycsICdmcmF1ZCcsICdzY2FtJywgJ2NvbnRyb3ZlcnN5J107XG5cbiAgICBsZXQgc2NvcmUgPSAwO1xuICAgIGZvciAoY29uc3QgdyBvZiBidWxsaXNoKSB7IGlmIChsb3dlci5pbmNsdWRlcyh3KSkgc2NvcmUrKzsgfVxuICAgIGZvciAoY29uc3QgdyBvZiBiZWFyaXNoKSB7IGlmIChsb3dlci5pbmNsdWRlcyh3KSkgc2NvcmUtLTsgfVxuXG4gICAgcmV0dXJuIHNjb3JlID4gMCA/ICdwb3NpdGl2ZScgOiBzY29yZSA8IDAgPyAnbmVnYXRpdmUnIDogJ25ldXRyYWwnO1xufVxuXG5mdW5jdGlvbiBjb21wdXRlTmV3c1NlbnRpbWVudChhcnRpY2xlcykge1xuICAgIGlmICghYXJ0aWNsZXMgfHwgYXJ0aWNsZXMubGVuZ3RoID09PSAwKSByZXR1cm4geyBzY29yZTogNTAsIGxhYmVsOiAnbmV1dHJhbCcsIHBvc2l0aXZlOiAwLCBuZWdhdGl2ZTogMCwgbmV1dHJhbDogMCB9O1xuXG4gICAgbGV0IHBvc2l0aXZlID0gMCwgbmVnYXRpdmUgPSAwLCBuZXV0cmFsID0gMDtcbiAgICBmb3IgKGNvbnN0IGEgb2YgYXJ0aWNsZXMpIHtcbiAgICAgICAgaWYgKGEuc2VudGltZW50ID09PSAncG9zaXRpdmUnKSBwb3NpdGl2ZSsrO1xuICAgICAgICBlbHNlIGlmIChhLnNlbnRpbWVudCA9PT0gJ25lZ2F0aXZlJykgbmVnYXRpdmUrKztcbiAgICAgICAgZWxzZSBuZXV0cmFsKys7XG4gICAgfVxuXG4gICAgY29uc3QgdG90YWwgPSBhcnRpY2xlcy5sZW5ndGg7XG4gICAgY29uc3Qgc2VudGltZW50U2NvcmUgPSBNYXRoLnJvdW5kKCgocG9zaXRpdmUgLyB0b3RhbCkgKiAxMDAgKyAobmV1dHJhbCAvIHRvdGFsKSAqIDUwKSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBzY29yZTogTWF0aC5taW4oMTAwLCBzZW50aW1lbnRTY29yZSksXG4gICAgICAgIGxhYmVsOiBzZW50aW1lbnRTY29yZSA+PSA2NSA/ICdwb3NpdGl2ZScgOiBzZW50aW1lbnRTY29yZSA+PSA0MCA/ICduZXV0cmFsJyA6ICduZWdhdGl2ZScsXG4gICAgICAgIHBvc2l0aXZlLCBuZWdhdGl2ZSwgbmV1dHJhbCxcbiAgICAgICAgdG90YWxcbiAgICB9O1xufVxuXG4vLyA9PT09PSBJUE8gU2NvcmluZyBFbmdpbmUgPT09PT1cbmZ1bmN0aW9uIHNjb3JlSVBPKGlwbykge1xuICAgIGxldCBzY29yZSA9IDUwOyAvLyBTdGFydCBuZXV0cmFsXG4gICAgY29uc3QgcHJvcyA9IFtdO1xuICAgIGNvbnN0IGNvbnMgPSBbXTtcblxuICAgIC8vIDEuIEZVTkRBTUVOVEFMUyAoMzAgcG9pbnRzIG1heClcbiAgICBsZXQgZnVuZFNjb3JlID0gMTU7IC8vIFN0YXJ0IG1pZFxuXG4gICAgaWYgKGlwby5maW5hbmNpYWxzKSB7XG4gICAgICAgIGNvbnN0IGZpbiA9IGlwby5maW5hbmNpYWxzO1xuXG4gICAgICAgIC8vIFJldmVudWUgZ3Jvd3RoXG4gICAgICAgIGlmIChmaW4ucmV2ZW51ZUdyb3d0aCA+IDI1KSB7IGZ1bmRTY29yZSArPSA4OyBwcm9zLnB1c2goJ1N0cm9uZyByZXZlbnVlIGdyb3d0aCAoPicgKyBmaW4ucmV2ZW51ZUdyb3d0aCArICclKScpOyB9XG4gICAgICAgIGVsc2UgaWYgKGZpbi5yZXZlbnVlR3Jvd3RoID4gMTApIHsgZnVuZFNjb3JlICs9IDQ7IHByb3MucHVzaCgnSGVhbHRoeSByZXZlbnVlIGdyb3d0aCcpOyB9XG4gICAgICAgIGVsc2UgaWYgKGZpbi5yZXZlbnVlR3Jvd3RoIDwgMCkgeyBmdW5kU2NvcmUgLT0gNjsgY29ucy5wdXNoKCdSZXZlbnVlIGRlY2xpbmluZycpOyB9XG5cbiAgICAgICAgLy8gUHJvZml0YWJpbGl0eVxuICAgICAgICBpZiAoZmluLnBhdE1hcmdpbiA+IDE1KSB7IGZ1bmRTY29yZSArPSA2OyBwcm9zLnB1c2goJ0hpZ2ggcHJvZml0IG1hcmdpbnMgKCcgKyBmaW4ucGF0TWFyZ2luICsgJyUpJyk7IH1cbiAgICAgICAgZWxzZSBpZiAoZmluLnBhdE1hcmdpbiA+IDUpIHsgZnVuZFNjb3JlICs9IDI7IH1cbiAgICAgICAgZWxzZSBpZiAoZmluLnBhdE1hcmdpbiA8IDApIHsgZnVuZFNjb3JlIC09IDg7IGNvbnMucHVzaCgnQ29tcGFueSBpcyBsb3NzLW1ha2luZycpOyB9XG5cbiAgICAgICAgLy8gUk9FXG4gICAgICAgIGlmIChmaW4ucm9lID4gMjApIHsgZnVuZFNjb3JlICs9IDU7IHByb3MucHVzaCgnRXhjZWxsZW50IFJPRSAoJyArIGZpbi5yb2UgKyAnJSknKTsgfVxuICAgICAgICBlbHNlIGlmIChmaW4ucm9lID4gMTIpIHsgZnVuZFNjb3JlICs9IDI7IH1cbiAgICAgICAgZWxzZSBpZiAoZmluLnJvZSA8IDgpIHsgZnVuZFNjb3JlIC09IDM7IGNvbnMucHVzaCgnTG93IHJldHVybiBvbiBlcXVpdHknKTsgfVxuXG4gICAgICAgIC8vIERlYnRcbiAgICAgICAgaWYgKGZpbi5kZWJ0VG9FcXVpdHkgPCAwLjMpIHsgZnVuZFNjb3JlICs9IDQ7IHByb3MucHVzaCgnTG93IGRlYnQsIGNsZWFuIGJhbGFuY2Ugc2hlZXQnKTsgfVxuICAgICAgICBlbHNlIGlmIChmaW4uZGVidFRvRXF1aXR5ID4gMS41KSB7IGZ1bmRTY29yZSAtPSA1OyBjb25zLnB1c2goJ0hpZ2ggZGVidCBsZXZlbHMgKEQvRTogJyArIGZpbi5kZWJ0VG9FcXVpdHkgKyAnKScpOyB9XG4gICAgfVxuICAgIGZ1bmRTY29yZSA9IE1hdGgubWF4KDAsIE1hdGgubWluKDMwLCBmdW5kU2NvcmUpKTtcblxuICAgIC8vIDIuIElORFVTVFJZIFBPVEVOVElBTCAoMjAgcG9pbnRzIG1heClcbiAgICBsZXQgaW5kdXN0cnlTY29yZSA9IDEwO1xuICAgIGNvbnN0IGhvdFNlY3RvcnMgPSBbJ3RlY2hub2xvZ3knLCAnaXQnLCAnZmludGVjaCcsICdldicsICdyZW5ld2FibGUnLCAnc29sYXInLCAnZ3JlZW4gZW5lcmd5JywgJ2FpJywgJ3NlbWljb25kdWN0b3InLCAnZGVmZW5jZScsICdoZWFsdGhjYXJlJywgJ3BoYXJtYScsICdkaWdpdGFsJ107XG4gICAgY29uc3QgY29sZFNlY3RvcnMgPSBbJ3JlYWwgZXN0YXRlJywgJ3RleHRpbGUnLCAnc3VnYXInLCAncGFwZXInLCAnbWluaW5nJ107XG5cbiAgICBjb25zdCBpbmR1c3RyeSA9IChpcG8uaW5kdXN0cnkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKGhvdFNlY3RvcnMuc29tZShzID0+IGluZHVzdHJ5LmluY2x1ZGVzKHMpKSkgeyBpbmR1c3RyeVNjb3JlICs9IDg7IHByb3MucHVzaCgnSGlnaC1ncm93dGggaW5kdXN0cnkgc2VjdG9yJyk7IH1cbiAgICBpZiAoY29sZFNlY3RvcnMuc29tZShzID0+IGluZHVzdHJ5LmluY2x1ZGVzKHMpKSkgeyBpbmR1c3RyeVNjb3JlIC09IDU7IGNvbnMucHVzaCgnU2VjdG9yIGhhcyBsaW1pdGVkIGdyb3d0aCBvdXRsb29rJyk7IH1cblxuICAgIGluZHVzdHJ5U2NvcmUgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigyMCwgaW5kdXN0cnlTY29yZSkpO1xuXG4gICAgLy8gMy4gVkFMVUFUSU9OICgyMCBwb2ludHMgbWF4KVxuICAgIGxldCB2YWx1YXRpb25TY29yZSA9IDEwO1xuXG4gICAgaWYgKGlwby52YWx1YXRpb24pIHtcbiAgICAgICAgaWYgKGlwby52YWx1YXRpb24ucGVSYXRpbykge1xuICAgICAgICAgICAgaWYgKGlwby52YWx1YXRpb24ucGVSYXRpbyA8IDE1KSB7IHZhbHVhdGlvblNjb3JlICs9IDg7IHByb3MucHVzaCgnQXR0cmFjdGl2ZWx5IHByaWNlZCAoUC9FOiAnICsgaXBvLnZhbHVhdGlvbi5wZVJhdGlvICsgJyknKTsgfVxuICAgICAgICAgICAgZWxzZSBpZiAoaXBvLnZhbHVhdGlvbi5wZVJhdGlvIDwgMjUpIHsgdmFsdWF0aW9uU2NvcmUgKz0gNDsgcHJvcy5wdXNoKCdSZWFzb25hYmx5IHZhbHVlZCcpOyB9XG4gICAgICAgICAgICBlbHNlIGlmIChpcG8udmFsdWF0aW9uLnBlUmF0aW8gPiA1MCkgeyB2YWx1YXRpb25TY29yZSAtPSA3OyBjb25zLnB1c2goJ0V4cGVuc2l2ZSB2YWx1YXRpb24gKFAvRTogJyArIGlwby52YWx1YXRpb24ucGVSYXRpbyArICcpJyk7IH1cbiAgICAgICAgICAgIGVsc2UgaWYgKGlwby52YWx1YXRpb24ucGVSYXRpbyA+IDM1KSB7IHZhbHVhdGlvblNjb3JlIC09IDM7IGNvbnMucHVzaCgnUHJlbWl1bSBwcmljaW5nIGNvbXBhcmVkIHRvIHBlZXJzJyk7IH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChpcG8udmFsdWF0aW9uLnBlZXJDb21wYXJpc29uID09PSAndW5kZXJwcmljZWQnKSB7IHZhbHVhdGlvblNjb3JlICs9IDU7IHByb3MucHVzaCgnUHJpY2VkIGxvd2VyIHRoYW4gbGlzdGVkIHBlZXJzJyk7IH1cbiAgICAgICAgZWxzZSBpZiAoaXBvLnZhbHVhdGlvbi5wZWVyQ29tcGFyaXNvbiA9PT0gJ292ZXJwcmljZWQnKSB7IHZhbHVhdGlvblNjb3JlIC09IDU7IGNvbnMucHVzaCgnT3ZlcnByaWNlZCBjb21wYXJlZCB0byBsaXN0ZWQgY29tcGV0aXRvcnMnKTsgfVxuICAgIH1cbiAgICB2YWx1YXRpb25TY29yZSA9IE1hdGgubWF4KDAsIE1hdGgubWluKDIwLCB2YWx1YXRpb25TY29yZSkpO1xuXG4gICAgLy8gNC4gU0VOVElNRU5UICgxMCBwb2ludHMgbWF4KVxuICAgIGxldCBzZW50aW1lbnRTY29yZSA9IDU7XG5cbiAgICBpZiAoaXBvLnNlbnRpbWVudCkge1xuICAgICAgICBpZiAoaXBvLnNlbnRpbWVudC5zY29yZSA+PSA3MCkgeyBzZW50aW1lbnRTY29yZSA9IDk7IHByb3MucHVzaCgnVmVyeSBwb3NpdGl2ZSBtYXJrZXQgYnV6eicpOyB9XG4gICAgICAgIGVsc2UgaWYgKGlwby5zZW50aW1lbnQuc2NvcmUgPj0gNTApIHsgc2VudGltZW50U2NvcmUgPSA2OyB9XG4gICAgICAgIGVsc2UgaWYgKGlwby5zZW50aW1lbnQuc2NvcmUgPCAzNSkgeyBzZW50aW1lbnRTY29yZSA9IDI7IGNvbnMucHVzaCgnTmVnYXRpdmUgbmV3cyBzZW50aW1lbnQnKTsgfVxuICAgIH1cbiAgICBzZW50aW1lbnRTY29yZSA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEwLCBzZW50aW1lbnRTY29yZSkpO1xuXG4gICAgLy8gNS4gU1VCU0NSSVBUSU9OIERFTUFORCAoMTAgcG9pbnRzIG1heClcbiAgICBsZXQgc3ViU2NvcmUgPSA1O1xuXG4gICAgaWYgKGlwby5zdWJzY3JpcHRpb24pIHtcbiAgICAgICAgY29uc3QgdG90YWwgPSBwYXJzZUZsb2F0KGlwby5zdWJzY3JpcHRpb24udG90YWwpIHx8IDA7XG4gICAgICAgIGlmICh0b3RhbCA+IDIwKSB7IHN1YlNjb3JlID0gMTA7IHByb3MucHVzaCgnTWFzc2l2ZWx5IG92ZXJzdWJzY3JpYmVkICgnICsgdG90YWwgKyAneCknKTsgfVxuICAgICAgICBlbHNlIGlmICh0b3RhbCA+IDUpIHsgc3ViU2NvcmUgPSA4OyBwcm9zLnB1c2goJ1N0cm9uZyBzdWJzY3JpcHRpb24gZGVtYW5kICgnICsgdG90YWwgKyAneCknKTsgfVxuICAgICAgICBlbHNlIGlmICh0b3RhbCA+IDEpIHsgc3ViU2NvcmUgPSA2OyB9XG4gICAgICAgIGVsc2UgaWYgKHRvdGFsID4gMCAmJiB0b3RhbCA8IDAuNSkgeyBzdWJTY29yZSA9IDI7IGNvbnMucHVzaCgnVmVyeSBsb3cgc3Vic2NyaXB0aW9uIGRlbWFuZCcpOyB9XG5cbiAgICAgICAgY29uc3QgcWliID0gcGFyc2VGbG9hdChpcG8uc3Vic2NyaXB0aW9uLnFpYikgfHwgMDtcbiAgICAgICAgaWYgKHFpYiA+IDEwKSB7IHByb3MucHVzaCgnSW5zdGl0dXRpb25hbCBpbnZlc3RvcnMgc2hvd2luZyBoaWdoIGNvbmZpZGVuY2UnKTsgfVxuICAgICAgICBlbHNlIGlmIChxaWIgPCAwLjUgJiYgcWliID4gMCkgeyBjb25zLnB1c2goJ1dlYWsgaW5zdGl0dXRpb25hbCBpbnRlcmVzdCcpOyB9XG4gICAgfVxuICAgIHN1YlNjb3JlID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAsIHN1YlNjb3JlKSk7XG5cbiAgICAvLyA2LiBSSVNLIEZBQ1RPUlMgKDEwIHBvaW50cyBtYXggXHUyMDE0IGRlZHVjdGlvbnMpXG4gICAgbGV0IHJpc2tTY29yZSA9IDg7XG5cbiAgICAvLyBHTVAgYW5hbHlzaXNcbiAgICBjb25zdCBnbXBWYWwgPSBwYXJzZUZsb2F0KChpcG8uZ21wIHx8ICcnKS5yZXBsYWNlKC9bXlxcZC4tXS9nLCAnJykpO1xuICAgIGlmICghaXNOYU4oZ21wVmFsKSkge1xuICAgICAgICBpZiAoZ21wVmFsID4gMTAwKSB7IHJpc2tTY29yZSA9IDEwOyBwcm9zLnB1c2goJ1ZlcnkgaGlnaCBHTVAgKFx1MjBCOScgKyBnbXBWYWwgKyAnKSBcdTIwMTQgc3Ryb25nIGxpc3RpbmcgZXhwZWN0ZWQnKTsgfVxuICAgICAgICBlbHNlIGlmIChnbXBWYWwgPiAzMCkgeyByaXNrU2NvcmUgPSA4OyBwcm9zLnB1c2goJ1Bvc2l0aXZlIEdNUCAoXHUyMEI5JyArIGdtcFZhbCArICcpJyk7IH1cbiAgICAgICAgZWxzZSBpZiAoZ21wVmFsID4gMCkgeyByaXNrU2NvcmUgPSA2OyB9XG4gICAgICAgIGVsc2UgaWYgKGdtcFZhbCA8PSAwKSB7IHJpc2tTY29yZSA9IDM7IGNvbnMucHVzaCgnWmVybyBvciBuZWdhdGl2ZSBHTVAgXHUyMDE0IGxpc3RpbmcgbG9zc2VzIHBvc3NpYmxlJyk7IH1cbiAgICB9XG5cbiAgICAvLyBJUE8gc2l6ZVxuICAgIGNvbnN0IHNpemVTdHIgPSAoaXBvLmlwb1NpemUgfHwgJycpLnJlcGxhY2UoL1teXFxkLl0vZywgJycpO1xuICAgIGNvbnN0IHNpemVWYWwgPSBwYXJzZUZsb2F0KHNpemVTdHIpO1xuICAgIGlmICghaXNOYU4oc2l6ZVZhbCkgJiYgc2l6ZVZhbCA+IDUwMDApIHsgcHJvcy5wdXNoKCdMYXJnZSBJUE8gXHUyMDE0IGxpa2VseSBpbnN0aXR1dGlvbmFsLXF1YWxpdHkgY29tcGFueScpOyB9XG4gICAgaWYgKCFpc05hTihzaXplVmFsKSAmJiBzaXplVmFsIDwgNTApIHsgY29ucy5wdXNoKCdWZXJ5IHNtYWxsIElQTyBzaXplIFx1MjAxNCBoaWdoZXIgcmlzaycpOyByaXNrU2NvcmUgLT0gMjsgfVxuXG4gICAgcmlza1Njb3JlID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oMTAsIHJpc2tTY29yZSkpO1xuXG4gICAgLy8gRklOQUwgU0NPUkVcbiAgICBzY29yZSA9IGZ1bmRTY29yZSArIGluZHVzdHJ5U2NvcmUgKyB2YWx1YXRpb25TY29yZSArIHNlbnRpbWVudFNjb3JlICsgc3ViU2NvcmUgKyByaXNrU2NvcmU7XG4gICAgc2NvcmUgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxMDAsIHNjb3JlKSk7XG5cbiAgICAvLyBWZXJkaWN0XG4gICAgbGV0IHZlcmRpY3QsIHZlcmRpY3RDb2xvcjtcbiAgICBpZiAoc2NvcmUgPj0gNzUpIHsgdmVyZGljdCA9ICdJTlZFU1QnOyB2ZXJkaWN0Q29sb3IgPSAnZ3JlZW4nOyB9XG4gICAgZWxzZSBpZiAoc2NvcmUgPj0gNTApIHsgdmVyZGljdCA9ICdORVVUUkFMJzsgdmVyZGljdENvbG9yID0gJ3llbGxvdyc7IH1cbiAgICBlbHNlIHsgdmVyZGljdCA9ICdBVk9JRCc7IHZlcmRpY3RDb2xvciA9ICdyZWQnOyB9XG5cbiAgICAvLyBTdW1tYXJ5XG4gICAgY29uc3Qgc3VtbWFyeVBhcnRzID0gW107XG4gICAgaWYgKHNjb3JlID49IDc1KSBzdW1tYXJ5UGFydHMucHVzaChgJHtpcG8uY29tcGFueU5hbWV9IGxvb2tzIGxpa2UgYSBzdHJvbmcgSVBPIG9wcG9ydHVuaXR5LmApO1xuICAgIGVsc2UgaWYgKHNjb3JlID49IDUwKSBzdW1tYXJ5UGFydHMucHVzaChgJHtpcG8uY29tcGFueU5hbWV9IHNob3dzIGEgbWl4ZWQgcGljdHVyZS5gKTtcbiAgICBlbHNlIHN1bW1hcnlQYXJ0cy5wdXNoKGAke2lwby5jb21wYW55TmFtZX0gY2FycmllcyBzaWduaWZpY2FudCByaXNrcy5gKTtcblxuICAgIGlmIChwcm9zLmxlbmd0aCA+IDApIHN1bW1hcnlQYXJ0cy5wdXNoKHByb3NbMF0gKyAnLicpO1xuICAgIGlmIChjb25zLmxlbmd0aCA+IDApIHN1bW1hcnlQYXJ0cy5wdXNoKCdIb3dldmVyLCAnICsgY29uc1swXS50b0xvd2VyQ2FzZSgpICsgJy4nKTtcblxuICAgIHJldHVybiB7XG4gICAgICAgIHNjb3JlLFxuICAgICAgICB2ZXJkaWN0LFxuICAgICAgICB2ZXJkaWN0Q29sb3IsXG4gICAgICAgIHN1bW1hcnk6IHN1bW1hcnlQYXJ0cy5qb2luKCcgJyksXG4gICAgICAgIHByb3M6IHByb3Muc2xpY2UoMCwgNiksXG4gICAgICAgIGNvbnM6IGNvbnMuc2xpY2UoMCwgNiksXG4gICAgICAgIGJyZWFrZG93bjoge1xuICAgICAgICAgICAgZnVuZGFtZW50YWxzOiBmdW5kU2NvcmUsXG4gICAgICAgICAgICBpbmR1c3RyeTogaW5kdXN0cnlTY29yZSxcbiAgICAgICAgICAgIHZhbHVhdGlvbjogdmFsdWF0aW9uU2NvcmUsXG4gICAgICAgICAgICBzZW50aW1lbnQ6IHNlbnRpbWVudFNjb3JlLFxuICAgICAgICAgICAgc3Vic2NyaXB0aW9uOiBzdWJTY29yZSxcbiAgICAgICAgICAgIHJpc2s6IHJpc2tTY29yZVxuICAgICAgICB9XG4gICAgfTtcbn1cblxuLy8gPT09PT0gVHJ5IHRvIGdldCBwZWVyL2ZpbmFuY2lhbCBpbmZvIGZyb20gWWFob28gPT09PT1cbmFzeW5jIGZ1bmN0aW9uIGZldGNoWWFob29EYXRhKGNvbXBhbnlOYW1lKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgLy8gU2VhcmNoIGZvciB0aGUgY29tcGFueSBvbiBZYWhvb1xuICAgICAgICBjb25zdCBzZWFyY2hUZXJtID0gZW5jb2RlVVJJQ29tcG9uZW50KGNvbXBhbnlOYW1lICsgJyBOU0UnKTtcbiAgICAgICAgY29uc3Qgc2VhcmNoUmVzcCA9IGF3YWl0IGZldGNoKGBodHRwczovL3F1ZXJ5Mi5maW5hbmNlLnlhaG9vLmNvbS92MS9maW5hbmNlL3NlYXJjaD9xPSR7c2VhcmNoVGVybX0mcXVvdGVzQ291bnQ9MyZuZXdzQ291bnQ9MGAsIHtcbiAgICAgICAgICAgIGhlYWRlcnM6IHsgJ1VzZXItQWdlbnQnOiBVU0VSX0FHRU5UIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKCFzZWFyY2hSZXNwLm9rKSByZXR1cm4gbnVsbDtcbiAgICAgICAgY29uc3Qgc2VhcmNoRGF0YSA9IGF3YWl0IHNlYXJjaFJlc3AuanNvbigpO1xuXG4gICAgICAgIGNvbnN0IHF1b3RlID0gKHNlYXJjaERhdGEucXVvdGVzIHx8IFtdKS5maW5kKHEgPT5cbiAgICAgICAgICAgIHEuZXhjaGFuZ2UgPT09ICdOU0knIHx8IHEuZXhjaGFuZ2UgPT09ICdCU0UnIHx8IHEuZXhjaGFuZ2UgPT09ICdOU0UnXG4gICAgICAgICk7XG5cbiAgICAgICAgaWYgKCFxdW90ZSkgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgY29uc3Qgc3ltYm9sID0gcXVvdGUuc3ltYm9sO1xuXG4gICAgICAgIC8vIEZldGNoIGZ1bmRhbWVudGFsc1xuICAgICAgICBjb25zdCBmdW5kUmVzcCA9IGF3YWl0IGZldGNoKGBodHRwczovL3F1ZXJ5Mi5maW5hbmNlLnlhaG9vLmNvbS92MTAvZmluYW5jZS9xdW90ZVN1bW1hcnkvJHtzeW1ib2x9P21vZHVsZXM9c3VtbWFyeVByb2ZpbGUsZmluYW5jaWFsRGF0YSxkZWZhdWx0S2V5U3RhdGlzdGljcyxlYXJuaW5ncyxpbmNvbWVTdGF0ZW1lbnRIaXN0b3J5YCwge1xuICAgICAgICAgICAgaGVhZGVyczogeyAnVXNlci1BZ2VudCc6IFVTRVJfQUdFTlQgfVxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoIWZ1bmRSZXNwLm9rKSByZXR1cm4gbnVsbDtcbiAgICAgICAgY29uc3QgZnVuZERhdGEgPSBhd2FpdCBmdW5kUmVzcC5qc29uKCk7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGZ1bmREYXRhPy5xdW90ZVN1bW1hcnk/LnJlc3VsdD8uWzBdO1xuICAgICAgICBpZiAoIXJlc3VsdCkgcmV0dXJuIG51bGw7XG5cbiAgICAgICAgY29uc3QgZmQgPSByZXN1bHQuZmluYW5jaWFsRGF0YSB8fCB7fTtcbiAgICAgICAgY29uc3Qga3MgPSByZXN1bHQuZGVmYXVsdEtleVN0YXRpc3RpY3MgfHwge307XG4gICAgICAgIGNvbnN0IHNwID0gcmVzdWx0LnN1bW1hcnlQcm9maWxlIHx8IHt9O1xuXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBzeW1ib2wsXG4gICAgICAgICAgICBpbmR1c3RyeTogc3AuaW5kdXN0cnkgfHwgJycsXG4gICAgICAgICAgICBzZWN0b3I6IHNwLnNlY3RvciB8fCAnJyxcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBzcC5sb25nQnVzaW5lc3NTdW1tYXJ5IHx8ICcnLFxuICAgICAgICAgICAgZmluYW5jaWFsczoge1xuICAgICAgICAgICAgICAgIHJldmVudWVHcm93dGg6IGZkLnJldmVudWVHcm93dGg/LnJhdyA/IChmZC5yZXZlbnVlR3Jvd3RoLnJhdyAqIDEwMCkudG9GaXhlZCgxKSA6IG51bGwsXG4gICAgICAgICAgICAgICAgcGF0TWFyZ2luOiBmZC5wcm9maXRNYXJnaW5zPy5yYXcgPyAoZmQucHJvZml0TWFyZ2lucy5yYXcgKiAxMDApLnRvRml4ZWQoMSkgOiBudWxsLFxuICAgICAgICAgICAgICAgIHJvZTogZmQucmV0dXJuT25FcXVpdHk/LnJhdyA/IChmZC5yZXR1cm5PbkVxdWl0eS5yYXcgKiAxMDApLnRvRml4ZWQoMSkgOiBudWxsLFxuICAgICAgICAgICAgICAgIHJvY2U6IGZkLnJldHVybk9uQXNzZXRzPy5yYXcgPyAoZmQucmV0dXJuT25Bc3NldHMucmF3ICogMTAwKS50b0ZpeGVkKDEpIDogbnVsbCxcbiAgICAgICAgICAgICAgICBkZWJ0VG9FcXVpdHk6IGZkLmRlYnRUb0VxdWl0eT8ucmF3IHx8IG51bGwsXG4gICAgICAgICAgICAgICAgY3VycmVudFJhdGlvOiBmZC5jdXJyZW50UmF0aW8/LnJhdyB8fCBudWxsLFxuICAgICAgICAgICAgICAgIHJldmVudWU6IGZkLnRvdGFsUmV2ZW51ZT8ucmF3IHx8IG51bGwsXG4gICAgICAgICAgICAgICAgZWJpdGRhOiBmZC5lYml0ZGE/LnJhdyB8fCBudWxsLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHZhbHVhdGlvbjoge1xuICAgICAgICAgICAgICAgIHBlUmF0aW86IGtzLmZvcndhcmRQRT8ucmF3IHx8IGtzLnRyYWlsaW5nUEU/LnJhdyB8fCBudWxsLFxuICAgICAgICAgICAgICAgIHBiUmF0aW86IGtzLnByaWNlVG9Cb29rPy5yYXcgfHwgbnVsbCxcbiAgICAgICAgICAgICAgICBtYXJrZXRDYXA6IGZkLm1hcmtldENhcD8ucmF3IHx8IG51bGwsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgY29tcGV0aXRvcnM6IHNwLmluZHVzdHJ5S2V5ID8gYXdhaXQgZmV0Y2hQZWVycyhzcC5pbmR1c3RyeUtleSkgOiBbXVxuICAgICAgICB9O1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5sb2coJ1lhaG9vIGRhdGEgZmV0Y2ggZmFpbGVkOicsIGUubWVzc2FnZSk7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hQZWVycyhpbmR1c3RyeUtleSkge1xuICAgIC8vIFRoaXMgaXMgYSBzaW1wbGlmaWVkIHBlZXIgbG9va3VwXG4gICAgcmV0dXJuIFtdOyAvLyBZYWhvbyBkb2Vzbid0IGVhc2lseSBleHBvc2UgdGhpcyB3aXRob3V0IGF1dGhcbn1cblxuLy8gPT09PT0gTW9uZ29EQiBDYWNoZSBPcGVyYXRpb25zID09PT09XG5hc3luYyBmdW5jdGlvbiBnZXRDYWNoZWRJUE9MaXN0KGRiKSB7XG4gICAgY29uc3QgY2FjaGUgPSBhd2FpdCBkYi5jb2xsZWN0aW9uKCdpcG9fY2FjaGUnKS5maW5kT25lKHsgX2lkOiAnaXBvX2xpc3QnIH0pO1xuICAgIGlmIChjYWNoZSAmJiBjYWNoZS51cGRhdGVkQXQpIHtcbiAgICAgICAgY29uc3QgYWdlID0gRGF0ZS5ub3coKSAtIG5ldyBEYXRlKGNhY2hlLnVwZGF0ZWRBdCkuZ2V0VGltZSgpO1xuICAgICAgICBpZiAoYWdlIDwgMzAgKiA2MCAqIDEwMDApIHsgLy8gMzAgbWluIGNhY2hlXG4gICAgICAgICAgICByZXR1cm4gY2FjaGUuZGF0YTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbnVsbDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gc2V0Q2FjaGVkSVBPTGlzdChkYiwgZGF0YSkge1xuICAgIGF3YWl0IGRiLmNvbGxlY3Rpb24oJ2lwb19jYWNoZScpLnVwZGF0ZU9uZShcbiAgICAgICAgeyBfaWQ6ICdpcG9fbGlzdCcgfSxcbiAgICAgICAgeyAkc2V0OiB7IGRhdGEsIHVwZGF0ZWRBdDogbmV3IERhdGUoKSB9IH0sXG4gICAgICAgIHsgdXBzZXJ0OiB0cnVlIH1cbiAgICApO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRDYWNoZWRJUE9EZXRhaWwoZGIsIG5hbWUpIHtcbiAgICBjb25zdCBrZXkgPSAnaXBvX2RldGFpbF8nICsgbmFtZS5yZXBsYWNlKC9cXHMrL2csICdfJykudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBjYWNoZSA9IGF3YWl0IGRiLmNvbGxlY3Rpb24oJ2lwb19jYWNoZScpLmZpbmRPbmUoeyBfaWQ6IGtleSB9KTtcbiAgICBpZiAoY2FjaGUgJiYgY2FjaGUudXBkYXRlZEF0KSB7XG4gICAgICAgIGNvbnN0IGFnZSA9IERhdGUubm93KCkgLSBuZXcgRGF0ZShjYWNoZS51cGRhdGVkQXQpLmdldFRpbWUoKTtcbiAgICAgICAgaWYgKGFnZSA8IDIgKiA2MCAqIDYwICogMTAwMCkgeyAvLyAyIGhvdXIgY2FjaGUgZm9yIGRldGFpbHNcbiAgICAgICAgICAgIHJldHVybiBjYWNoZS5kYXRhO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzZXRDYWNoZWRJUE9EZXRhaWwoZGIsIG5hbWUsIGRhdGEpIHtcbiAgICBjb25zdCBrZXkgPSAnaXBvX2RldGFpbF8nICsgbmFtZS5yZXBsYWNlKC9cXHMrL2csICdfJykudG9Mb3dlckNhc2UoKTtcbiAgICBhd2FpdCBkYi5jb2xsZWN0aW9uKCdpcG9fY2FjaGUnKS51cGRhdGVPbmUoXG4gICAgICAgIHsgX2lkOiBrZXkgfSxcbiAgICAgICAgeyAkc2V0OiB7IGRhdGEsIHVwZGF0ZWRBdDogbmV3IERhdGUoKSB9IH0sXG4gICAgICAgIHsgdXBzZXJ0OiB0cnVlIH1cbiAgICApO1xufVxuXG4vLyA9PT09PSBNYWluIEhhbmRsZXIgPT09PT1cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZXIocmVxKSB7XG4gICAgaWYgKHJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgICAgICByZXR1cm4geyBzdGF0dXNDb2RlOiAyMDQsIGhlYWRlcnM6IEhFQURFUlMgfTtcbiAgICB9XG5cbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcS51cmwsICdodHRwczovL2xvY2FsaG9zdCcpO1xuICAgIGNvbnN0IHR5cGUgPSB1cmwuc2VhcmNoUGFyYW1zLmdldCgndHlwZScpIHx8ICdsaXN0JztcblxuICAgIHRyeSB7XG4gICAgICAgIGxldCBkYjtcbiAgICAgICAgdHJ5IHsgZGIgPSBhd2FpdCBnZXREYigpOyB9IGNhdGNoIChlKSB7IGRiID0gbnVsbDsgfVxuXG4gICAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICAgICAgY2FzZSAnbGlzdCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZUxpc3QoZGIpO1xuXG4gICAgICAgICAgICBjYXNlICdkZXRhaWwnOlxuICAgICAgICAgICAgICAgIGNvbnN0IG5hbWUgPSB1cmwuc2VhcmNoUGFyYW1zLmdldCgnbmFtZScpO1xuICAgICAgICAgICAgICAgIGlmICghbmFtZSkgcmV0dXJuIHJlc3BvbmQoNDAwLCB7IGVycm9yOiAnTWlzc2luZyBcIm5hbWVcIiBwYXJhbWV0ZXInIH0pO1xuICAgICAgICAgICAgICAgIHJldHVybiBhd2FpdCBoYW5kbGVEZXRhaWwoZGIsIG5hbWUpO1xuXG4gICAgICAgICAgICBjYXNlICduZXdzJzpcbiAgICAgICAgICAgICAgICBjb25zdCBjb21wYW55ID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoJ25hbWUnKTtcbiAgICAgICAgICAgICAgICBpZiAoIWNvbXBhbnkpIHJldHVybiByZXNwb25kKDQwMCwgeyBlcnJvcjogJ01pc3NpbmcgXCJuYW1lXCIgcGFyYW1ldGVyJyB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm4gYXdhaXQgaGFuZGxlTmV3cyhjb21wYW55KTtcblxuICAgICAgICAgICAgY2FzZSAncmVmcmVzaCc6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZVJlZnJlc2goZGIpO1xuXG4gICAgICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgICAgIHJldHVybiByZXNwb25kKDQwMCwgeyBlcnJvcjogJ0ludmFsaWQgdHlwZS4gVXNlOiBsaXN0LCBkZXRhaWwsIG5ld3MsIHJlZnJlc2gnIH0pO1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ0lQTyBoYW5kbGVyIGVycm9yOicsIGVycik7XG4gICAgICAgIHJldHVybiByZXNwb25kKDUwMCwgeyBlcnJvcjogJ0ludGVybmFsIGVycm9yJywgbWVzc2FnZTogZXJyLm1lc3NhZ2UgfSk7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVMaXN0KGRiKSB7XG4gICAgLy8gVHJ5IGNhY2hlIGZpcnN0XG4gICAgaWYgKGRiKSB7XG4gICAgICAgIGNvbnN0IGNhY2hlZCA9IGF3YWl0IGdldENhY2hlZElQT0xpc3QoZGIpO1xuICAgICAgICBpZiAoY2FjaGVkKSByZXR1cm4gcmVzcG9uZCgyMDAsIGNhY2hlZCk7XG4gICAgfVxuXG4gICAgLy8gRmV0Y2ggZnJlc2ggZGF0YVxuICAgIGxldCBpcG9zID0gYXdhaXQgZmV0Y2hJUE9MaXN0RnJvbVdlYigpO1xuXG4gICAgLy8gSWYgcHJpbWFyeSBzb3VyY2UgZmFpbHMsIHRyeSBiYWNrdXBcbiAgICBpZiAoaXBvcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgaXBvcyA9IGF3YWl0IGZldGNoRnJvbUNoaXR0b3JnYXJoKCk7XG4gICAgfVxuXG4gICAgLy8gSWYgc3RpbGwgbm8gZGF0YSwgcmV0dXJuIGZhbGxiYWNrXG4gICAgaWYgKGlwb3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHJldHVybiByZXNwb25kKDIwMCwge1xuICAgICAgICAgICAgdXBjb21pbmc6IFtdLCBvbmdvaW5nOiBbXSwgbGlzdGVkOiBbXSxcbiAgICAgICAgICAgIGxhc3RVcGRhdGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICBzb3VyY2U6ICdmYWxsYmFjaycsXG4gICAgICAgICAgICBtZXNzYWdlOiAnSVBPIGRhdGEgc291cmNlcyB0ZW1wb3JhcmlseSB1bmF2YWlsYWJsZS4gUGxlYXNlIHRyeSBhZ2FpbiBsYXRlci4nXG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIENhdGVnb3JpemVcbiAgICBjb25zdCBjYXRlZ29yaXplZCA9IHsgdXBjb21pbmc6IFtdLCBvbmdvaW5nOiBbXSwgbGlzdGVkOiBbXSB9O1xuICAgIGZvciAoY29uc3QgaXBvIG9mIGlwb3MpIHtcbiAgICAgICAgaXBvLmNhdGVnb3J5ID0gY2F0ZWdvcml6ZUlQTyhpcG8pO1xuXG4gICAgICAgIC8vIFBhcnNlIEdNUCB2YWx1ZVxuICAgICAgICBjb25zdCBnbXBTdHIgPSAoaXBvLmdtcCB8fCAnJykucmVwbGFjZSgvW15cXGQuLV0vZywgJycpO1xuICAgICAgICBpcG8uZ21wVmFsdWUgPSBwYXJzZUZsb2F0KGdtcFN0cikgfHwgMDtcblxuICAgICAgICAvLyBQYXJzZSBwcmljZSBiYW5kXG4gICAgICAgIGNvbnN0IHByaWNlTWF0Y2ggPSAoaXBvLnByaWNlQmFuZCB8fCAnJykubWF0Y2goLyhcXGQrKVxccypbLVx1MjAxM3RvXStcXHMqKFxcZCspLyk7XG4gICAgICAgIGlmIChwcmljZU1hdGNoKSB7XG4gICAgICAgICAgICBpcG8ucHJpY2VNaW4gPSBwYXJzZUludChwcmljZU1hdGNoWzFdKTtcbiAgICAgICAgICAgIGlwby5wcmljZU1heCA9IHBhcnNlSW50KHByaWNlTWF0Y2hbMl0pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGNhdGVnb3JpemVkW2lwby5jYXRlZ29yeV0pIHtcbiAgICAgICAgICAgIGNhdGVnb3JpemVkW2lwby5jYXRlZ29yeV0ucHVzaChpcG8pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY2F0ZWdvcml6ZWQudXBjb21pbmcucHVzaChpcG8pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVzdWx0ID0ge1xuICAgICAgICAuLi5jYXRlZ29yaXplZCxcbiAgICAgICAgdG90YWw6IGlwb3MubGVuZ3RoLFxuICAgICAgICBsYXN0VXBkYXRlZDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICBzb3VyY2U6ICdsaXZlJ1xuICAgIH07XG5cbiAgICAvLyBDYWNoZSBpdFxuICAgIGlmIChkYikge1xuICAgICAgICBhd2FpdCBzZXRDYWNoZWRJUE9MaXN0KGRiLCByZXN1bHQpLmNhdGNoKCgpID0+IHt9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzcG9uZCgyMDAsIHJlc3VsdCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZURldGFpbChkYiwgY29tcGFueU5hbWUpIHtcbiAgICAvLyBUcnkgY2FjaGVcbiAgICBpZiAoZGIpIHtcbiAgICAgICAgY29uc3QgY2FjaGVkID0gYXdhaXQgZ2V0Q2FjaGVkSVBPRGV0YWlsKGRiLCBjb21wYW55TmFtZSk7XG4gICAgICAgIGlmIChjYWNoZWQpIHJldHVybiByZXNwb25kKDIwMCwgY2FjaGVkKTtcbiAgICB9XG5cbiAgICAvLyBGZXRjaCBuZXdzXG4gICAgY29uc3QgbmV3c0FydGljbGVzID0gYXdhaXQgZmV0Y2hJUE9OZXdzKGNvbXBhbnlOYW1lKTtcbiAgICBjb25zdCBzZW50aW1lbnQgPSBjb21wdXRlTmV3c1NlbnRpbWVudChuZXdzQXJ0aWNsZXMpO1xuXG4gICAgLy8gVHJ5IFlhaG9vIGZvciBmaW5hbmNpYWwgZGF0YVxuICAgIGNvbnN0IHlhaG9vRGF0YSA9IGF3YWl0IGZldGNoWWFob29EYXRhKGNvbXBhbnlOYW1lKTtcblxuICAgIC8vIEZldGNoIHN1YnNjcmlwdGlvbiBkYXRhXG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uID0gYXdhaXQgZmV0Y2hTdWJzY3JpcHRpb25EYXRhKGNvbXBhbnlOYW1lKTtcblxuICAgIC8vIEJ1aWxkIGRldGFpbCBvYmplY3RcbiAgICBjb25zdCBkZXRhaWwgPSB7XG4gICAgICAgIGNvbXBhbnlOYW1lLFxuICAgICAgICBpbmR1c3RyeTogeWFob29EYXRhPy5pbmR1c3RyeSB8fCB5YWhvb0RhdGE/LnNlY3RvciB8fCAnJyxcbiAgICAgICAgZGVzY3JpcHRpb246IHlhaG9vRGF0YT8uZGVzY3JpcHRpb24gfHwgJycsXG4gICAgICAgIHN5bWJvbDogeWFob29EYXRhPy5zeW1ib2wgfHwgJycsXG4gICAgICAgIGZpbmFuY2lhbHM6IHlhaG9vRGF0YT8uZmluYW5jaWFscyB8fCBudWxsLFxuICAgICAgICB2YWx1YXRpb246IHlhaG9vRGF0YT8udmFsdWF0aW9uIHx8IG51bGwsXG4gICAgICAgIHNlbnRpbWVudCxcbiAgICAgICAgbmV3czogbmV3c0FydGljbGVzLnNsaWNlKDAsIDgpLFxuICAgICAgICBzdWJzY3JpcHRpb24sXG4gICAgICAgIGNvbXBldGl0b3JzOiB5YWhvb0RhdGE/LmNvbXBldGl0b3JzIHx8IFtdLFxuICAgICAgICBmZXRjaGVkQXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIH07XG5cbiAgICAvLyBTY29yZSBpdFxuICAgIGNvbnN0IHNjb3JpbmcgPSBzY29yZUlQTyh7XG4gICAgICAgIC4uLmRldGFpbCxcbiAgICAgICAgZ21wOiAnJywgLy8gV2lsbCBiZSBwb3B1bGF0ZWQgZnJvbSBsaXN0IGRhdGEgb24gZnJvbnRlbmRcbiAgICAgICAgaXBvU2l6ZTogJydcbiAgICB9KTtcblxuICAgIGRldGFpbC5zY29yaW5nID0gc2NvcmluZztcblxuICAgIC8vIENhY2hlXG4gICAgaWYgKGRiKSB7XG4gICAgICAgIGF3YWl0IHNldENhY2hlZElQT0RldGFpbChkYiwgY29tcGFueU5hbWUsIGRldGFpbCkuY2F0Y2goKCkgPT4ge30pO1xuICAgIH1cblxuICAgIHJldHVybiByZXNwb25kKDIwMCwgZGV0YWlsKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaGFuZGxlTmV3cyhjb21wYW55TmFtZSkge1xuICAgIGNvbnN0IGFydGljbGVzID0gYXdhaXQgZmV0Y2hJUE9OZXdzKGNvbXBhbnlOYW1lKTtcbiAgICBjb25zdCBzZW50aW1lbnQgPSBjb21wdXRlTmV3c1NlbnRpbWVudChhcnRpY2xlcyk7XG4gICAgcmV0dXJuIHJlc3BvbmQoMjAwLCB7IGFydGljbGVzLCBzZW50aW1lbnQgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVJlZnJlc2goZGIpIHtcbiAgICAvLyBGb3JjZSByZWZyZXNoIGJ5IGNsZWFyaW5nIGNhY2hlXG4gICAgaWYgKGRiKSB7XG4gICAgICAgIGF3YWl0IGRiLmNvbGxlY3Rpb24oJ2lwb19jYWNoZScpLmRlbGV0ZU9uZSh7IF9pZDogJ2lwb19saXN0JyB9KTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IGhhbmRsZUxpc3QoZGIpO1xufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7OztBQUFBLFNBQVMsbUJBQW1CO0FBRTVCLElBQUksZUFBZTtBQUNuQixJQUFJLFdBQVc7QUFFZixlQUFzQixRQUFRO0FBQzVCLE1BQUksZ0JBQWdCLFVBQVU7QUFDNUIsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLE1BQU0sUUFBUSxJQUFJO0FBQ3hCLE1BQUksQ0FBQyxLQUFLO0FBQ1IsVUFBTSxJQUFJLE1BQU0sNkNBQTZDO0FBQUEsRUFDL0Q7QUFFQSxRQUFNLFNBQVMsSUFBSSxZQUFZLEtBQUs7QUFBQSxJQUNsQyxhQUFhO0FBQUEsSUFDYiwwQkFBMEI7QUFBQSxFQUM1QixDQUFDO0FBRUQsUUFBTSxPQUFPLFFBQVE7QUFFckIsUUFBTSxTQUFTLFFBQVEsSUFBSSxtQkFBbUI7QUFDOUMsUUFBTSxLQUFLLE9BQU8sR0FBRyxNQUFNO0FBRTNCLGlCQUFlO0FBQ2YsYUFBVztBQUVYLFNBQU87QUFDVDs7O0FDdkJBLElBQU0sVUFBVTtBQUFBLEVBQ1osK0JBQStCO0FBQUEsRUFDL0IsZ0NBQWdDO0FBQUEsRUFDaEMsZ0JBQWdCO0FBQ3BCO0FBRUEsSUFBTSxhQUFhO0FBR25CLFNBQVMsUUFBUSxRQUFRLE1BQU07QUFDM0IsU0FBTyxFQUFFLFlBQVksUUFBUSxTQUFTLFNBQVMsTUFBTSxLQUFLLFVBQVUsSUFBSSxFQUFFO0FBQzlFO0FBRUEsU0FBUyxVQUFVLEtBQUs7QUFDcEIsTUFBSSxDQUFDLElBQUssUUFBTztBQUVqQixRQUFNLElBQUksSUFBSSxLQUFLLEdBQUc7QUFDdEIsU0FBTyxNQUFNLEVBQUUsUUFBUSxD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
