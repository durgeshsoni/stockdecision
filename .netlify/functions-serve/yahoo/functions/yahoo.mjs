
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/yahoo.mjs
var HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=300"
};
async function yahooGet(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    redirect: "follow"
  });
  return { status: res.status, text: await res.text() };
}
function extractQuoteSummary(html) {
  const regex = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const content = match[1];
    if (!content.includes('"quoteSummary"') && !content.includes("trailingPE")) continue;
    try {
      const outer = JSON.parse(content);
      const inner = typeof outer.body === "string" ? JSON.parse(outer.body) : outer;
      if (inner.quoteSummary?.result?.[0]) return inner.quoteSummary.result[0];
    } catch {
      continue;
    }
  }
  return null;
}
function parseGoogleNewsRSS(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < 10) {
    const item = match[1];
    const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'") || "";
    const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
    const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
    const source = item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "";
    if (title && title !== "Google News") {
      items.push({ title, link, pubDate, source });
    }
  }
  return items;
}
function analyzeSentiment(newsItems) {
  const bullish = ["buy", "upgrade", "bullish", "surge", "jump", "rally", "soar", "gain", "profit", "growth", "beat", "strong", "positive", "upside", "target", "outperform", "record high", "breakout", "recovery", "boom", "optimistic"];
  const bearish = ["sell", "downgrade", "bearish", "crash", "fall", "drop", "decline", "loss", "weak", "negative", "downside", "underperform", "warning", "risk", "war", "tension", "sanction", "inflation", "recession", "crisis", "slump", "fear", "concern", "plunge", "dump", "worst", "layoff", "fraud", "scam"];
  const neutral = ["hold", "mixed", "flat", "steady", "unchanged", "stable"];
  let bullCount = 0, bearCount = 0, neutralCount = 0;
  const analyzed = newsItems.map((item) => {
    const text = (item.title || "").toLowerCase();
    let sentiment = "neutral";
    let score = 0;
    for (const w of bullish) {
      if (text.includes(w)) {
        score += 1;
      }
    }
    for (const w of bearish) {
      if (text.includes(w)) {
        score -= 1;
      }
    }
    if (score > 0) {
      sentiment = "bullish";
      bullCount++;
    } else if (score < 0) {
      sentiment = "bearish";
      bearCount++;
    } else {
      neutralCount++;
    }
    return { ...item, sentiment, score };
  });
  const total = analyzed.length || 1;
  const overallScore = (bullCount - bearCount) / total * 100;
  const overallSentiment = overallScore > 20 ? "bullish" : overallScore < -20 ? "bearish" : "neutral";
  return {
    items: analyzed,
    summary: { bullish: bullCount, bearish: bearCount, neutral: neutralCount, total: analyzed.length },
    overallScore: Math.round(overallScore),
    overallSentiment
  };
}
var yahoo_default = async (req) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const symbol = url.searchParams.get("symbol");
  if (!symbol && !["news", "stockofday", "screener"].includes(type)) return new Response(JSON.stringify({ error: "symbol required" }), { status: 400, headers: HEADERS });
  try {
    if (type === "chart") {
      const range = url.searchParams.get("range") || "1y";
      const interval = url.searchParams.get("interval") || "1d";
      let r = await yahooGet(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
      if (r.status === 429) r = await yahooGet(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
      if (r.status === 429) return new Response(JSON.stringify({ error: "Yahoo rate limit. Try again in 1 min." }), { status: 429, headers: HEADERS });
      return new Response(r.text, { status: 200, headers: HEADERS });
    }
    if (type === "fundamentals") {
      const r = await yahooGet(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`);
      const summary = extractQuoteSummary(r.text);
      return new Response(JSON.stringify(summary || {}), { status: 200, headers: HEADERS });
    }
    if (type === "insights") {
      const r = await yahooGet(`https://query2.finance.yahoo.com/ws/insights/v2/finance/insights?symbol=${encodeURIComponent(symbol)}`);
      return new Response(r.text, { status: 200, headers: HEADERS });
    }
    if (type === "news") {
      const companyName = url.searchParams.get("name") || symbol;
      const isIndian = symbol?.endsWith(".NS") || symbol?.endsWith(".BO");
      const fetches = [];
      if (symbol) {
        fetches.push(
          yahooGet(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=6&quotesCount=0`).then((r) => {
            try {
              return JSON.parse(r.text).news || [];
            } catch {
              return [];
            }
          }).catch(() => [])
        );
      } else {
        fetches.push(Promise.resolve([]));
      }
      const cleanName = companyName.replace(/\.NS|\.BO/g, "").replace(/Ltd\.?|Inc\.?|Corp\.?|Limited/gi, "").trim();
      fetches.push(
        yahooGet(`https://news.google.com/rss/search?q=${encodeURIComponent(cleanName + " stock")}&hl=en-IN&gl=IN&ceid=IN:en`).then((r) => parseGoogleNewsRSS(r.text)).catch(() => [])
      );
      const marketQuery = isIndian ? "Indian stock market Nifty Sensex today" : "stock market today US";
      fetches.push(
        yahooGet(`https://news.google.com/rss/search?q=${encodeURIComponent(marketQuery)}&hl=en-IN&gl=IN&ceid=IN:en`).then((r) => parseGoogleNewsRSS(r.text)).catch(() => [])
      );
      fetches.push(
        yahooGet(`https://news.google.com/rss/search?q=${encodeURIComponent("world economy trade war geopolitics market impact")}&hl=en&gl=US&ceid=US:en`).then((r) => parseGoogleNewsRSS(r.text)).catch(() => [])
      );
      const [yahooNews, companyNews, marketNews, worldNews] = await Promise.all(fetches);
      const normalizedYahoo = (yahooNews || []).map((n) => ({
        title: n.title || "",
        link: n.link || "",
        source: n.publisher || "",
        pubDate: n.providerPublishTime ? new Date(n.providerPublishTime * 1e3).toUTCString() : ""
      }));
      const stockSentiment = analyzeSentiment([...normalizedYahoo, ...companyNews]);
      const marketSentiment = analyzeSentiment(marketNews);
      const worldSentiment = analyzeSentiment(worldNews);
      const combinedScore = Math.round(
        stockSentiment.overallScore * 0.5 + marketSentiment.overallScore * 0.3 + worldSentiment.overallScore * 0.2
      );
      const result = {
        stock: {
          items: stockSentiment.items.slice(0, 8),
          summary: stockSentiment.summary,
          sentiment: stockSentiment.overallSentiment,
          score: stockSentiment.overallScore
        },
        market: {
          items: marketSentiment.items.slice(0, 6),
          summary: marketSentiment.summary,
          sentiment: marketSentiment.overallSentiment,
          score: marketSentiment.overallScore
        },
        world: {
          items: worldSentiment.items.slice(0, 6),
          summary: worldSentiment.summary,
          sentiment: worldSentiment.overallSentiment,
          score: worldSentiment.overallScore
        },
        combined: {
          score: combinedScore,
          sentiment: combinedScore > 20 ? "bullish" : combinedScore < -20 ? "bearish" : "neutral",
          bestTimeToBuy: combinedScore > 15 ? "Yes - News sentiment is positive" : combinedScore > -15 ? "Neutral - No strong news signal" : "No - Negative news sentiment, wait for clarity"
        }
      };
      return new Response(JSON.stringify(result), { status: 200, headers: HEADERS });
    }
    if (type === "stockofday") {
      const SOTD_POOL = [
        "RELIANCE.NS",
        "TCS.NS",
        "HDFCBANK.NS",
        "INFY.NS",
        "ICICIBANK.NS",
        "SBIN.NS",
        "BHARTIARTL.NS",
        "ITC.NS",
        "TATAMOTORS.NS",
        "BAJFINANCE.NS",
        "LT.NS",
        "SUNPHARMA.NS",
        "TITAN.NS",
        "HCLTECH.NS",
        "ADANIENT.NS",
        "AAPL",
        "MSFT",
        "GOOGL",
        "TSLA",
        "NVDA"
      ];
      const dateStr = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      let hash = 0;
      for (let i = 0; i < dateStr.length; i++) hash += dateStr.charCodeAt(i);
      let pickIndex = hash % SOTD_POOL.length;
      let sotdSymbol = SOTD_POOL[pickIndex];
      let chartData, summaryData, retried = false;
      const fetchSOTD = async (sym) => {
        const [chartRes, fundRes] = await Promise.all([
          yahooGet(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d&includePrePost=false`),
          yahooGet(`https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/`)
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
        pickIndex = (pickIndex + 1) % SOTD_POOL.length;
        sotdSymbol = SOTD_POOL[pickIndex];
        retried = true;
        try {
          const result = await fetchSOTD(sotdSymbol);
          chartData = result.chart;
          summaryData = result.summary;
        } catch (e2) {
          return new Response(JSON.stringify({ error: "Failed to fetch stock of the day: " + e2.message }), { status: 500, headers: HEADERS });
        }
      }
      const meta = chartData?.chart?.result?.[0]?.meta || {};
      const indicators = chartData?.chart?.result?.[0]?.indicators?.quote?.[0] || {};
      const timestamps = chartData?.chart?.result?.[0]?.timestamp || [];
      const price = meta.regularMarketPrice || 0;
      const previousClose = meta.chartPreviousClose || meta.previousClose || 0;
      const change = price - previousClose;
      const changePct = previousClose ? change / previousClose * 100 : 0;
      const currency = meta.currency || "USD";
      const volumes = (indicators.volume || []).filter((v) => v != null);
      const volume = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
      const avgVolume = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 1;
      const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;
      const defaultKeyStats = summaryData?.defaultKeyStatistics || {};
      const financialData = summaryData?.financialData || {};
      const summaryProfile = summaryData?.summaryProfile || {};
      const priceModule = summaryData?.price || {};
      const summaryDetail = summaryData?.summaryDetail || {};
      const name = priceModule.shortName || priceModule.longName || sotdSymbol;
      const sector = summaryProfile.sector || "N/A";
      const pe = summaryDetail?.trailingPE?.raw || defaultKeyStats?.trailingPE?.raw || null;
      const eps = defaultKeyStats?.trailingEps?.raw || financialData?.earningsPerShare?.raw || null;
      const high52 = summaryDetail?.fiftyTwoWeekHigh?.raw || null;
      const low52 = summaryDetail?.fiftyTwoWeekLow?.raw || null;
      const trendingScore = Math.abs(changePct) * volumeRatio;
      let verdict;
      if (changePct > 2) verdict = "Surging Today";
      else if (changePct > 0) verdict = "Trending Up";
      else if (changePct > -2) verdict = "Slight Dip";
      else verdict = "Under Pressure";
      const sotdHeaders = { ...HEADERS, "Cache-Control": "public, max-age=3600" };
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
        currency
      }), { status: 200, headers: sotdHeaders });
    }
    if (type === "screener") {
      const symbolsParam = url.searchParams.get("symbols");
      if (!symbolsParam) {
        return new Response(JSON.stringify({ error: "symbols parameter required for screener" }), { status: 400, headers: HEADERS });
      }
      const symbolsList = symbolsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
      if (symbolsList.length === 0) {
        return new Response(JSON.stringify({ error: "No valid symbols provided" }), { status: 400, headers: HEADERS });
      }
      const fetchPromises = symbolsList.map(async (sym) => {
        const [chartRes, fundRes] = await Promise.allSettled([
          yahooGet(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false`).then((r) => JSON.parse(r.text)),
          yahooGet(`https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/`).then((r) => extractQuoteSummary(r.text))
        ]);
        return {
          symbol: sym,
          chart: chartRes.status === "fulfilled" ? chartRes.value : null,
          summary: fundRes.status === "fulfilled" ? fundRes.value : null
        };
      });
      const settledResults = await Promise.allSettled(fetchPromises);
      const results = settledResults.filter((r) => r.status === "fulfilled").map((r) => r.value);
      const screenerHeaders = { ...HEADERS, "Cache-Control": "public, max-age=600" };
      return new Response(JSON.stringify({ results }), { status: 200, headers: screenerHeaders });
    }
    return new Response(JSON.stringify({ error: "Invalid type" }), { status: 400, headers: HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: HEADERS });
  }
};
export {
  yahoo_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMveWFob28ubWpzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvLyBOZXRsaWZ5IFNlcnZlcmxlc3MgRnVuY3Rpb24gLSBZYWhvbyBGaW5hbmNlICsgTmV3cyBQcm94eVxuLy8gSGFuZGxlczogY2hhcnQsIGZ1bmRhbWVudGFscywgaW5zaWdodHMsIG5ld3NcblxuY29uc3QgSEVBREVSUyA9IHtcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCcsXG4gICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAnQ2FjaGUtQ29udHJvbCc6ICdwdWJsaWMsIG1heC1hZ2U9MzAwJyxcbn07XG5cbmFzeW5jIGZ1bmN0aW9uIHlhaG9vR2V0KHVybCkge1xuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgICBoZWFkZXJzOiB7ICdVc2VyLUFnZW50JzogJ01vemlsbGEvNS4wIChNYWNpbnRvc2g7IEludGVsIE1hYyBPUyBYIDEwXzE1XzcpIEFwcGxlV2ViS2l0LzUzNy4zNicgfSxcbiAgICAgICAgcmVkaXJlY3Q6ICdmb2xsb3cnLFxuICAgIH0pO1xuICAgIHJldHVybiB7IHN0YXR1czogcmVzLnN0YXR1cywgdGV4dDogYXdhaXQgcmVzLnRleHQoKSB9O1xufVxuXG5mdW5jdGlvbiBleHRyYWN0UXVvdGVTdW1tYXJ5KGh0bWwpIHtcbiAgICBjb25zdCByZWdleCA9IC88c2NyaXB0W14+XSp0eXBlPVwiYXBwbGljYXRpb25cXC9qc29uXCJbXj5dKj4oW1xcc1xcU10qPyk8XFwvc2NyaXB0Pi9nO1xuICAgIGxldCBtYXRjaDtcbiAgICB3aGlsZSAoKG1hdGNoID0gcmVnZXguZXhlYyhodG1sKSkgIT09IG51bGwpIHtcbiAgICAgICAgY29uc3QgY29udGVudCA9IG1hdGNoWzFdO1xuICAgICAgICBpZiAoIWNvbnRlbnQuaW5jbHVkZXMoJ1wicXVvdGVTdW1tYXJ5XCInKSAmJiAhY29udGVudC5pbmNsdWRlcygndHJhaWxpbmdQRScpKSBjb250aW51ZTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IG91dGVyID0gSlNPTi5wYXJzZShjb250ZW50KTtcbiAgICAgICAgICAgIGNvbnN0IGlubmVyID0gdHlwZW9mIG91dGVyLmJvZHkgPT09ICdzdHJpbmcnID8gSlNPTi5wYXJzZShvdXRlci5ib2R5KSA6IG91dGVyO1xuICAgICAgICAgICAgaWYgKGlubmVyLnF1b3RlU3VtbWFyeT8ucmVzdWx0Py5bMF0pIHJldHVybiBpbm5lci5xdW90ZVN1bW1hcnkucmVzdWx0WzBdO1xuICAgICAgICB9IGNhdGNoIHsgY29udGludWU7IH1cbiAgICB9XG4gICAgcmV0dXJuIG51bGw7XG59XG5cbi8vIFBhcnNlIEdvb2dsZSBOZXdzIFJTUyBYTUwgaW50byBKU09OXG5mdW5jdGlvbiBwYXJzZUdvb2dsZU5ld3NSU1MoeG1sKSB7XG4gICAgY29uc3QgaXRlbXMgPSBbXTtcbiAgICBjb25zdCBpdGVtUmVnZXggPSAvPGl0ZW0+KFtcXHNcXFNdKj8pPFxcL2l0ZW0+L2c7XG4gICAgbGV0IG1hdGNoO1xuICAgIHdoaWxlICgobWF0Y2ggPSBpdGVtUmVnZXguZXhlYyh4bWwpKSAhPT0gbnVsbCAmJiBpdGVtcy5sZW5ndGggPCAxMCkge1xuICAgICAgICBjb25zdCBpdGVtID0gbWF0Y2hbMV07XG4gICAgICAgIGNvbnN0IHRpdGxlID0gaXRlbS5tYXRjaCgvPHRpdGxlPihbXFxzXFxTXSo/KTxcXC90aXRsZT4vKT8uWzFdPy5yZXBsYWNlKC8mYW1wOy9nLCcmJykucmVwbGFjZSgvJmx0Oy9nLCc8JykucmVwbGFjZSgvJmd0Oy9nLCc+JykucmVwbGFjZSgvJnF1b3Q7L2csJ1wiJykucmVwbGFjZSgvJiMzOTsvZyxcIidcIikgfHwgJyc7XG4gICAgICAgIGNvbnN0IGxpbmsgPSBpdGVtLm1hdGNoKC88bGluaz4oW1xcc1xcU10qPyk8XFwvbGluaz4vKT8uWzFdIHx8ICcnO1xuICAgICAgICBjb25zdCBwdWJEYXRlID0gaXRlbS5tYXRjaCgvPHB1YkRhdGU+KFtcXHNcXFNdKj8pPFxcL3B1YkRhdGU+Lyk/LlsxXSB8fCAnJztcbiAgICAgICAgY29uc3Qgc291cmNlID0gaXRlbS5tYXRjaCgvPHNvdXJjZVtePl0qPihbXFxzXFxTXSo/KTxcXC9zb3VyY2U+Lyk/LlsxXSB8fCAnJztcbiAgICAgICAgaWYgKHRpdGxlICYmIHRpdGxlICE9PSAnR29vZ2xlIE5ld3MnKSB7XG4gICAgICAgICAgICBpdGVtcy5wdXNoKHsgdGl0bGUsIGxpbmssIHB1YkRhdGUsIHNvdXJjZSB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gaXRlbXM7XG59XG5cbi8vIFNpbXBsZSBrZXl3b3JkLWJhc2VkIHNlbnRpbWVudCBhbmFseXNpc1xuZnVuY3Rpb24gYW5hbHl6ZVNlbnRpbWVudChuZXdzSXRlbXMpIHtcbiAgICBjb25zdCBidWxsaXNoID0gWydidXknLCd1cGdyYWRlJywnYnVsbGlzaCcsJ3N1cmdlJywnanVtcCcsJ3JhbGx5Jywnc29hcicsJ2dhaW4nLCdwcm9maXQnLCdncm93dGgnLCdiZWF0Jywnc3Ryb25nJywncG9zaXRpdmUnLCd1cHNpZGUnLCd0YXJnZXQnLCdvdXRwZXJmb3JtJywncmVjb3JkIGhpZ2gnLCdicmVha291dCcsJ3JlY292ZXJ5JywnYm9vbScsJ29wdGltaXN0aWMnXTtcbiAgICBjb25zdCBiZWFyaXNoID0gWydzZWxsJywnZG93bmdyYWRlJywnYmVhcmlzaCcsJ2NyYXNoJywnZmFsbCcsJ2Ryb3AnLCdkZWNsaW5lJywnbG9zcycsJ3dlYWsnLCduZWdhdGl2ZScsJ2Rvd25zaWRlJywndW5kZXJwZXJmb3JtJywnd2FybmluZycsJ3Jpc2snLCd3YXInLCd0ZW5zaW9uJywnc2FuY3Rpb24nLCdpbmZsYXRpb24nLCdyZWNlc3Npb24nLCdjcmlzaXMnLCdzbHVtcCcsJ2ZlYXInLCdjb25jZXJuJywncGx1bmdlJywnZHVtcCcsJ3dvcnN0JywnbGF5b2ZmJywnZnJhdWQnLCdzY2FtJ107XG4gICAgY29uc3QgbmV1dHJhbCA9IFsnaG9sZCcsJ21peGVkJywnZmxhdCcsJ3N0ZWFkeScsJ3VuY2hhbmdlZCcsJ3N0YWJsZSddO1xuXG4gICAgbGV0IGJ1bGxDb3VudCA9IDAsIGJlYXJDb3VudCA9IDAsIG5ldXRyYWxDb3VudCA9IDA7XG4gICAgY29uc3QgYW5hbHl6ZWQgPSBuZXdzSXRlbXMubWFwKGl0ZW0gPT4ge1xuICAgICAgICBjb25zdCB0ZXh0ID0gKGl0ZW0udGl0bGUgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGxldCBzZW50aW1lbnQgPSAnbmV1dHJhbCc7XG4gICAgICAgIGxldCBzY29yZSA9IDA7XG4gICAgICAgIGZvciAoY29uc3QgdyBvZiBidWxsaXNoKSB7IGlmICh0ZXh0LmluY2x1ZGVzKHcpKSB7IHNjb3JlICs9IDE7IH0gfVxuICAgICAgICBmb3IgKGNvbnN0IHcgb2YgYmVhcmlzaCkgeyBpZiAodGV4dC5pbmNsdWRlcyh3KSkgeyBzY29yZSAtPSAxOyB9IH1cbiAgICAgICAgaWYgKHNjb3JlID4gMCkgeyBzZW50aW1lbnQgPSAnYnVsbGlzaCc7IGJ1bGxDb3VudCsrOyB9XG4gICAgICAgIGVsc2UgaWYgKHNjb3JlIDwgMCkgeyBzZW50aW1lbnQgPSAnYmVhcmlzaCc7IGJlYXJDb3VudCsrOyB9XG4gICAgICAgIGVsc2UgeyBuZXV0cmFsQ291bnQrKzsgfVxuICAgICAgICByZXR1cm4geyAuLi5pdGVtLCBzZW50aW1lbnQsIHNjb3JlIH07XG4gICAgfSk7XG5cbiAgICBjb25zdCB0b3RhbCA9IGFuYWx5emVkLmxlbmd0aCB8fCAxO1xuICAgIGNvbnN0IG92ZXJhbGxTY29yZSA9ICgoYnVsbENvdW50IC0gYmVhckNvdW50KSAvIHRvdGFsKSAqIDEwMDsgLy8gLTEwMCB0byArMTAwXG4gICAgY29uc3Qgb3ZlcmFsbFNlbnRpbWVudCA9IG92ZXJhbGxTY29yZSA+IDIwID8gJ2J1bGxpc2gnIDogb3ZlcmFsbFNjb3JlIDwgLTIwID8gJ2JlYXJpc2gnIDogJ25ldXRyYWwnO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgICAgaXRlbXM6IGFuYWx5emVkLFxuICAgICAgICBzdW1tYXJ5OiB7IGJ1bGxpc2g6IGJ1bGxDb3VudCwgYmVhcmlzaDogYmVhckNvdW50LCBuZXV0cmFsOiBuZXV0cmFsQ291bnQsIHRvdGFsOiBhbmFseXplZC5sZW5ndGggfSxcbiAgICAgICAgb3ZlcmFsbFNjb3JlOiBNYXRoLnJvdW5kKG92ZXJhbGxTY29yZSksXG4gICAgICAgIG92ZXJhbGxTZW50aW1lbnQsXG4gICAgfTtcbn1cblxuZXhwb3J0IGRlZmF1bHQgYXN5bmMgKHJlcSkgPT4ge1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxLnVybCk7XG4gICAgY29uc3QgdHlwZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KCd0eXBlJyk7XG4gICAgY29uc3Qgc3ltYm9sID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoJ3N5bWJvbCcpO1xuXG4gICAgaWYgKCFzeW1ib2wgJiYgIVsnbmV3cycsICdzdG9ja29mZGF5JywgJ3NjcmVlbmVyJ10uaW5jbHVkZXModHlwZSkpIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ3N5bWJvbCByZXF1aXJlZCcgfSksIHsgc3RhdHVzOiA0MDAsIGhlYWRlcnM6IEhFQURFUlMgfSk7XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBDSEFSVFxuICAgICAgICBpZiAodHlwZSA9PT0gJ2NoYXJ0Jykge1xuICAgICAgICAgICAgY29uc3QgcmFuZ2UgPSB1cmwuc2VhcmNoUGFyYW1zLmdldCgncmFuZ2UnKSB8fCAnMXknO1xuICAgICAgICAgICAgY29uc3QgaW50ZXJ2YWwgPSB1cmwuc2VhcmNoUGFyYW1zLmdldCgnaW50ZXJ2YWwnKSB8fCAnMWQnO1xuICAgICAgICAgICAgbGV0IHIgPSBhd2FpdCB5YWhvb0dldChgaHR0cHM6Ly9xdWVyeTIuZmluYW5jZS55YWhvby5jb20vdjgvZmluYW5jZS9jaGFydC8ke2VuY29kZVVSSUNvbXBvbmVudChzeW1ib2wpfT9yYW5nZT0ke3JhbmdlfSZpbnRlcnZhbD0ke2ludGVydmFsfSZpbmNsdWRlUHJlUG9zdD1mYWxzZWApO1xuICAgICAgICAgICAgaWYgKHIuc3RhdHVzID09PSA0MjkpIHIgPSBhd2FpdCB5YWhvb0dldChgaHR0cHM6Ly9xdWVyeTEuZmluYW5jZS55YWhvby5jb20vdjgvZmluYW5jZS9jaGFydC8ke2VuY29kZVVSSUNvbXBvbmVudChzeW1ib2wpfT9yYW5nZT0ke3JhbmdlfSZpbnRlcnZhbD0ke2ludGVydmFsfSZpbmNsdWRlUHJlUG9zdD1mYWxzZWApO1xuICAgICAgICAgICAgaWYgKHIuc3RhdHVzID09PSA0MjkpIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1lhaG9vIHJhdGUgbGltaXQuIFRyeSBhZ2FpbiBpbiAxIG1pbi4nIH0pLCB7IHN0YXR1czogNDI5LCBoZWFkZXJzOiBIRUFERVJTIH0pO1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShyLnRleHQsIHsgc3RhdHVzOiAyMDAsIGhlYWRlcnM6IEhFQURFUlMgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBGVU5EQU1FTlRBTFNcbiAgICAgICAgaWYgKHR5cGUgPT09ICdmdW5kYW1lbnRhbHMnKSB7XG4gICAgICAgICAgICBjb25zdCByID0gYXdhaXQgeWFob29HZXQoYGh0dHBzOi8vZmluYW5jZS55YWhvby5jb20vcXVvdGUvJHtlbmNvZGVVUklDb21wb25lbnQoc3ltYm9sKX0vYCk7XG4gICAgICAgICAgICBjb25zdCBzdW1tYXJ5ID0gZXh0cmFjdFF1b3RlU3VtbWFyeShyLnRleHQpO1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeShzdW1tYXJ5IHx8IHt9KSwgeyBzdGF0dXM6IDIwMCwgaGVhZGVyczogSEVBREVSUyB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIElOU0lHSFRTXG4gICAgICAgIGlmICh0eXBlID09PSAnaW5zaWdodHMnKSB7XG4gICAgICAgICAgICBjb25zdCByID0gYXdhaXQgeWFob29HZXQoYGh0dHBzOi8vcXVlcnkyLmZpbmFuY2UueWFob28uY29tL3dzL2luc2lnaHRzL3YyL2ZpbmFuY2UvaW5zaWdodHM/c3ltYm9sPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHN5bWJvbCl9YCk7XG4gICAgICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKHIudGV4dCwgeyBzdGF0dXM6IDIwMCwgaGVhZGVyczogSEVBREVSUyB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE5FV1MgLSBGZXRjaGVzIHN0b2NrLXNwZWNpZmljICsgbWFya2V0ICsgd29ybGQgbmV3c1xuICAgICAgICBpZiAodHlwZSA9PT0gJ25ld3MnKSB7XG4gICAgICAgICAgICBjb25zdCBjb21wYW55TmFtZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KCduYW1lJykgfHwgc3ltYm9sO1xuICAgICAgICAgICAgY29uc3QgaXNJbmRpYW4gPSBzeW1ib2w/LmVuZHNXaXRoKCcuTlMnKSB8fCBzeW1ib2w/LmVuZHNXaXRoKCcuQk8nKTtcblxuICAgICAgICAgICAgLy8gRmV0Y2ggbXVsdGlwbGUgbmV3cyBzb3VyY2VzIGluIHBhcmFsbGVsXG4gICAgICAgICAgICBjb25zdCBmZXRjaGVzID0gW107XG5cbiAgICAgICAgICAgIC8vIDEuIFN0b2NrLXNwZWNpZmljIG5ld3MgZnJvbSBZYWhvbyBzZWFyY2hcbiAgICAgICAgICAgIGlmIChzeW1ib2wpIHtcbiAgICAgICAgICAgICAgICBmZXRjaGVzLnB1c2goXG4gICAgICAgICAgICAgICAgICAgIHlhaG9vR2V0KGBodHRwczovL3F1ZXJ5Mi5maW5hbmNlLnlhaG9vLmNvbS92MS9maW5hbmNlL3NlYXJjaD9xPSR7ZW5jb2RlVVJJQ29tcG9uZW50KHN5bWJvbCl9Jm5ld3NDb3VudD02JnF1b3Rlc0NvdW50PTBgKVxuICAgICAgICAgICAgICAgICAgICAgICAgLnRoZW4ociA9PiB7IHRyeSB7IHJldHVybiBKU09OLnBhcnNlKHIudGV4dCkubmV3cyB8fCBbXTsgfSBjYXRjaCB7IHJldHVybiBbXTsgfSB9KVxuICAgICAgICAgICAgICAgICAgICAgICAgLmNhdGNoKCgpID0+IFtdKVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGZldGNoZXMucHVzaChQcm9taXNlLnJlc29sdmUoW10pKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gMi4gQ29tcGFueS1zcGVjaWZpYyBuZXdzIGZyb20gR29vZ2xlIE5ld3NcbiAgICAgICAgICAgIGNvbnN0IGNsZWFuTmFtZSA9IGNvbXBhbnlOYW1lLnJlcGxhY2UoL1xcLk5TfFxcLkJPL2csICcnKS5yZXBsYWNlKC9MdGRcXC4/fEluY1xcLj98Q29ycFxcLj98TGltaXRlZC9naSwgJycpLnRyaW0oKTtcbiAgICAgICAgICAgIGZldGNoZXMucHVzaChcbiAgICAgICAgICAgICAgICB5YWhvb0dldChgaHR0cHM6Ly9uZXdzLmdvb2dsZS5jb20vcnNzL3NlYXJjaD9xPSR7ZW5jb2RlVVJJQ29tcG9uZW50KGNsZWFuTmFtZSArICcgc3RvY2snKX0maGw9ZW4tSU4mZ2w9SU4mY2VpZD1JTjplbmApXG4gICAgICAgICAgICAgICAgICAgIC50aGVuKHIgPT4gcGFyc2VHb29nbGVOZXdzUlNTKHIudGV4dCkpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaCgoKSA9PiBbXSlcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIC8vIDMuIE1hcmtldCBuZXdzIChJbmRpYSBmb2N1c2VkIGlmIEluZGlhbiBzdG9jaylcbiAgICAgICAgICAgIGNvbnN0IG1hcmtldFF1ZXJ5ID0gaXNJbmRpYW4gPyAnSW5kaWFuIHN0b2NrIG1hcmtldCBOaWZ0eSBTZW5zZXggdG9kYXknIDogJ3N0b2NrIG1hcmtldCB0b2RheSBVUyc7XG4gICAgICAgICAgICBmZXRjaGVzLnB1c2goXG4gICAgICAgICAgICAgICAgeWFob29HZXQoYGh0dHBzOi8vbmV3cy5nb29nbGUuY29tL3Jzcy9zZWFyY2g/cT0ke2VuY29kZVVSSUNvbXBvbmVudChtYXJrZXRRdWVyeSl9JmhsPWVuLUlOJmdsPUlOJmNlaWQ9SU46ZW5gKVxuICAgICAgICAgICAgICAgICAgICAudGhlbihyID0+IHBhcnNlR29vZ2xlTmV3c1JTUyhyLnRleHQpKVxuICAgICAgICAgICAgICAgICAgICAuY2F0Y2goKCkgPT4gW10pXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyA0LiBXb3JsZCBldmVudHMgLyBnZW9wb2xpdGljcyBhZmZlY3RpbmcgbWFya2V0c1xuICAgICAgICAgICAgZmV0Y2hlcy5wdXNoKFxuICAgICAgICAgICAgICAgIHlhaG9vR2V0KGBodHRwczovL25ld3MuZ29vZ2xlLmNvbS9yc3Mvc2VhcmNoP3E9JHtlbmNvZGVVUklDb21wb25lbnQoJ3dvcmxkIGVjb25vbXkgdHJhZGUgd2FyIGdlb3BvbGl0aWNzIG1hcmtldCBpbXBhY3QnKX0maGw9ZW4mZ2w9VVMmY2VpZD1VUzplbmApXG4gICAgICAgICAgICAgICAgICAgIC50aGVuKHIgPT4gcGFyc2VHb29nbGVOZXdzUlNTKHIudGV4dCkpXG4gICAgICAgICAgICAgICAgICAgIC5jYXRjaCgoKSA9PiBbXSlcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGNvbnN0IFt5YWhvb05ld3MsIGNvbXBhbnlOZXdzLCBtYXJrZXROZXdzLCB3b3JsZE5ld3NdID0gYXdhaXQgUHJvbWlzZS5hbGwoZmV0Y2hlcyk7XG5cbiAgICAgICAgICAgIC8vIE5vcm1hbGl6ZSBZYWhvbyBuZXdzIGZvcm1hdFxuICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZFlhaG9vID0gKHlhaG9vTmV3cyB8fCBbXSkubWFwKG4gPT4gKHtcbiAgICAgICAgICAgICAgICB0aXRsZTogbi50aXRsZSB8fCAnJyxcbiAgICAgICAgICAgICAgICBsaW5rOiBuLmxpbmsgfHwgJycsXG4gICAgICAgICAgICAgICAgc291cmNlOiBuLnB1Ymxpc2hlciB8fCAnJyxcbiAgICAgICAgICAgICAgICBwdWJEYXRlOiBuLnByb3ZpZGVyUHVibGlzaFRpbWUgPyBuZXcgRGF0ZShuLnByb3ZpZGVyUHVibGlzaFRpbWUgKiAxMDAwKS50b1VUQ1N0cmluZygpIDogJycsXG4gICAgICAgICAgICB9KSk7XG5cbiAgICAgICAgICAgIC8vIEFuYWx5emUgc2VudGltZW50IGZvciBlYWNoIGNhdGVnb3J5XG4gICAgICAgICAgICBjb25zdCBzdG9ja1NlbnRpbWVudCA9IGFuYWx5emVTZW50aW1lbnQoWy4uLm5vcm1hbGl6ZWRZYWhvbywgLi4uY29tcGFueU5ld3NdKTtcbiAgICAgICAgICAgIGNvbnN0IG1hcmtldFNlbnRpbWVudCA9IGFuYWx5emVTZW50aW1lbnQobWFya2V0TmV3cyk7XG4gICAgICAgICAgICBjb25zdCB3b3JsZFNlbnRpbWVudCA9IGFuYWx5emVTZW50aW1lbnQod29ybGROZXdzKTtcblxuICAgICAgICAgICAgLy8gQ29tYmluZWQgc2NvcmVcbiAgICAgICAgICAgIGNvbnN0IGNvbWJpbmVkU2NvcmUgPSBNYXRoLnJvdW5kKFxuICAgICAgICAgICAgICAgIHN0b2NrU2VudGltZW50Lm92ZXJhbGxTY29yZSAqIDAuNSArXG4gICAgICAgICAgICAgICAgbWFya2V0U2VudGltZW50Lm92ZXJhbGxTY29yZSAqIDAuMyArXG4gICAgICAgICAgICAgICAgd29ybGRTZW50aW1lbnQub3ZlcmFsbFNjb3JlICogMC4yXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBjb25zdCByZXN1bHQgPSB7XG4gICAgICAgICAgICAgICAgc3RvY2s6IHtcbiAgICAgICAgICAgICAgICAgICAgaXRlbXM6IHN0b2NrU2VudGltZW50Lml0ZW1zLnNsaWNlKDAsIDgpLFxuICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiBzdG9ja1NlbnRpbWVudC5zdW1tYXJ5LFxuICAgICAgICAgICAgICAgICAgICBzZW50aW1lbnQ6IHN0b2NrU2VudGltZW50Lm92ZXJhbGxTZW50aW1lbnQsXG4gICAgICAgICAgICAgICAgICAgIHNjb3JlOiBzdG9ja1NlbnRpbWVudC5vdmVyYWxsU2NvcmUsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBtYXJrZXQ6IHtcbiAgICAgICAgICAgICAgICAgICAgaXRlbXM6IG1hcmtldFNlbnRpbWVudC5pdGVtcy5zbGljZSgwLCA2KSxcbiAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogbWFya2V0U2VudGltZW50LnN1bW1hcnksXG4gICAgICAgICAgICAgICAgICAgIHNlbnRpbWVudDogbWFya2V0U2VudGltZW50Lm92ZXJhbGxTZW50aW1lbnQsXG4gICAgICAgICAgICAgICAgICAgIHNjb3JlOiBtYXJrZXRTZW50aW1lbnQub3ZlcmFsbFNjb3JlLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgd29ybGQ6IHtcbiAgICAgICAgICAgICAgICAgICAgaXRlbXM6IHdvcmxkU2VudGltZW50Lml0ZW1zLnNsaWNlKDAsIDYpLFxuICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiB3b3JsZFNlbnRpbWVudC5zdW1tYXJ5LFxuICAgICAgICAgICAgICAgICAgICBzZW50aW1lbnQ6IHdvcmxkU2VudGltZW50Lm92ZXJhbGxTZW50aW1lbnQsXG4gICAgICAgICAgICAgICAgICAgIHNjb3JlOiB3b3JsZFNlbnRpbWVudC5vdmVyYWxsU2NvcmUsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBjb21iaW5lZDoge1xuICAgICAgICAgICAgICAgICAgICBzY29yZTogY29tYmluZWRTY29yZSxcbiAgICAgICAgICAgICAgICAgICAgc2VudGltZW50OiBjb21iaW5lZFNjb3JlID4gMjAgPyAnYnVsbGlzaCcgOiBjb21iaW5lZFNjb3JlIDwgLTIwID8gJ2JlYXJpc2gnIDogJ25ldXRyYWwnLFxuICAgICAgICAgICAgICAgICAgICBiZXN0VGltZVRvQnV5OiBjb21iaW5lZFNjb3JlID4gMTUgPyAnWWVzIC0gTmV3cyBzZW50aW1lbnQgaXMgcG9zaXRpdmUnIDpcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29tYmluZWRTY29yZSA+IC0xNSA/ICdOZXV0cmFsIC0gTm8gc3Ryb25nIG5ld3Mgc2lnbmFsJyA6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdObyAtIE5lZ2F0aXZlIG5ld3Mgc2VudGltZW50LCB3YWl0IGZvciBjbGFyaXR5JyxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeShyZXN1bHQpLCB7IHN0YXR1czogMjAwLCBoZWFkZXJzOiBIRUFERVJTIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gU1RPQ0sgT0YgVEhFIERBWVxuICAgICAgICBpZiAodHlwZSA9PT0gJ3N0b2Nrb2ZkYXknKSB7XG4gICAgICAgICAgICBjb25zdCBTT1REX1BPT0wgPSBbXG4gICAgICAgICAgICAgICAgJ1JFTElBTkNFLk5TJywgJ1RDUy5OUycsICdIREZDQkFOSy5OUycsICdJTkZZLk5TJywgJ0lDSUNJQkFOSy5OUycsXG4gICAgICAgICAgICAgICAgJ1NCSU4uTlMnLCAnQkhBUlRJQVJUTC5OUycsICdJVEMuTlMnLCAnVEFUQU1PVE9SUy5OUycsICdCQUpGSU5BTkNFLk5TJyxcbiAgICAgICAgICAgICAgICAnTFQuTlMnLCAnU1VOUEhBUk1BLk5TJywgJ1RJVEFOLk5TJywgJ0hDTFRFQ0guTlMnLCAnQURBTklFTlQuTlMnLFxuICAgICAgICAgICAgICAgICdBQVBMJywgJ01TRlQnLCAnR09PR0wnLCAnVFNMQScsICdOVkRBJ1xuICAgICAgICAgICAgXTtcblxuICAgICAgICAgICAgY29uc3QgZGF0ZVN0ciA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCk7XG4gICAgICAgICAgICBsZXQgaGFzaCA9IDA7XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRhdGVTdHIubGVuZ3RoOyBpKyspIGhhc2ggKz0gZGF0ZVN0ci5jaGFyQ29kZUF0KGkpO1xuICAgICAgICAgICAgbGV0IHBpY2tJbmRleCA9IGhhc2ggJSBTT1REX1BPT0wubGVuZ3RoO1xuXG4gICAgICAgICAgICBsZXQgc290ZFN5bWJvbCA9IFNPVERfUE9PTFtwaWNrSW5kZXhdO1xuICAgICAgICAgICAgbGV0IGNoYXJ0RGF0YSwgc3VtbWFyeURhdGEsIHJldHJpZWQgPSBmYWxzZTtcblxuICAgICAgICAgICAgY29uc3QgZmV0Y2hTT1REID0gYXN5bmMgKHN5bSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IFtjaGFydFJlcywgZnVuZFJlc10gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgICAgICAgICAgICAgICAgIHlhaG9vR2V0KGBodHRwczovL3F1ZXJ5Mi5maW5hbmNlLnlhaG9vLmNvbS92OC9maW5hbmNlL2NoYXJ0LyR7ZW5jb2RlVVJJQ29tcG9uZW50KHN5bSl9P3JhbmdlPTVkJmludGVydmFsPTFkJmluY2x1ZGVQcmVQb3N0PWZhbHNlYCksXG4gICAgICAgICAgICAgICAgICAgIHlhaG9vR2V0KGBodHRwczovL2ZpbmFuY2UueWFob28uY29tL3F1b3RlLyR7ZW5jb2RlVVJJQ29tcG9uZW50KHN5bSl9L2ApLFxuICAgICAgICAgICAgICAgIF0pO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNoYXJ0ID0gSlNPTi5wYXJzZShjaGFydFJlcy50ZXh0KTtcbiAgICAgICAgICAgICAgICBjb25zdCBzdW1tYXJ5ID0gZXh0cmFjdFF1b3RlU3VtbWFyeShmdW5kUmVzLnRleHQpO1xuICAgICAgICAgICAgICAgIHJldHVybiB7IGNoYXJ0LCBzdW1tYXJ5IH07XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGZldGNoU09URChzb3RkU3ltYm9sKTtcbiAgICAgICAgICAgICAgICBjaGFydERhdGEgPSByZXN1bHQuY2hhcnQ7XG4gICAgICAgICAgICAgICAgc3VtbWFyeURhdGEgPSByZXN1bHQuc3VtbWFyeTtcbiAgICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgICAgIC8vIFJldHJ5IHdpdGggbmV4dCBzdG9jayBpbiBwb29sXG4gICAgICAgICAgICAgICAgcGlja0luZGV4ID0gKHBpY2tJbmRleCArIDEpICUgU09URF9QT09MLmxlbmd0aDtcbiAgICAgICAgICAgICAgICBzb3RkU3ltYm9sID0gU09URF9QT09MW3BpY2tJbmRleF07XG4gICAgICAgICAgICAgICAgcmV0cmllZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZmV0Y2hTT1REKHNvdGRTeW1ib2wpO1xuICAgICAgICAgICAgICAgICAgICBjaGFydERhdGEgPSByZXN1bHQuY2hhcnQ7XG4gICAgICAgICAgICAgICAgICAgIHN1bW1hcnlEYXRhID0gcmVzdWx0LnN1bW1hcnk7XG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZTIpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnRmFpbGVkIHRvIGZldGNoIHN0b2NrIG9mIHRoZSBkYXk6ICcgKyBlMi5tZXNzYWdlIH0pLCB7IHN0YXR1czogNTAwLCBoZWFkZXJzOiBIRUFERVJTIH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgbWV0YSA9IGNoYXJ0RGF0YT8uY2hhcnQ/LnJlc3VsdD8uWzBdPy5tZXRhIHx8IHt9O1xuICAgICAgICAgICAgY29uc3QgaW5kaWNhdG9ycyA9IGNoYXJ0RGF0YT8uY2hhcnQ/LnJlc3VsdD8uWzBdPy5pbmRpY2F0b3JzPy5xdW90ZT8uWzBdIHx8IHt9O1xuICAgICAgICAgICAgY29uc3QgdGltZXN0YW1wcyA9IGNoYXJ0RGF0YT8uY2hhcnQ/LnJlc3VsdD8uWzBdPy50aW1lc3RhbXAgfHwgW107XG5cbiAgICAgICAgICAgIGNvbnN0IHByaWNlID0gbWV0YS5yZWd1bGFyTWFya2V0UHJpY2UgfHwgMDtcbiAgICAgICAgICAgIGNvbnN0IHByZXZpb3VzQ2xvc2UgPSBtZXRhLmNoYXJ0UHJldmlvdXNDbG9zZSB8fCBtZXRhLnByZXZpb3VzQ2xvc2UgfHwgMDtcbiAgICAgICAgICAgIGNvbnN0IGNoYW5nZSA9IHByaWNlIC0gcHJldmlvdXNDbG9zZTtcbiAgICAgICAgICAgIGNvbnN0IGNoYW5nZVBjdCA9IHByZXZpb3VzQ2xvc2UgPyAoKGNoYW5nZSAvIHByZXZpb3VzQ2xvc2UpICogMTAwKSA6IDA7XG4gICAgICAgICAgICBjb25zdCBjdXJyZW5jeSA9IG1ldGEuY3VycmVuY3kgfHwgJ1VTRCc7XG5cbiAgICAgICAgICAgIC8vIEdldCBsYXRlc3Qgdm9sdW1lIGFuZCBjb21wdXRlIGF2ZXJhZ2Ugdm9sdW1lIGZyb20gY2hhcnQgZGF0YVxuICAgICAgICAgICAgY29uc3Qgdm9sdW1lcyA9IChpbmRpY2F0b3JzLnZvbHVtZSB8fCBbXSkuZmlsdGVyKHYgPT4gdiAhPSBudWxsKTtcbiAgICAgICAgICAgIGNvbnN0IHZvbHVtZSA9IHZvbHVtZXMubGVuZ3RoID4gMCA/IHZvbHVtZXNbdm9sdW1lcy5sZW5ndGggLSAxXSA6IDA7XG4gICAgICAgICAgICBjb25zdCBhdmdWb2x1bWUgPSB2b2x1bWVzLmxlbmd0aCA+IDAgPyB2b2x1bWVzLnJlZHVjZSgoYSwgYikgPT4gYSArIGIsIDApIC8gdm9sdW1lcy5sZW5ndGggOiAxO1xuICAgICAgICAgICAgY29uc3Qgdm9sdW1lUmF0aW8gPSBhdmdWb2x1bWUgPiAwID8gdm9sdW1lIC8gYXZnVm9sdW1lIDogMTtcblxuICAgICAgICAgICAgLy8gRXh0cmFjdCBmdW5kYW1lbnRhbHMgZnJvbSBzdW1tYXJ5XG4gICAgICAgICAgICBjb25zdCBkZWZhdWx0S2V5U3RhdHMgPSBzdW1tYXJ5RGF0YT8uZGVmYXVsdEtleVN0YXRpc3RpY3MgfHwge307XG4gICAgICAgICAgICBjb25zdCBmaW5hbmNpYWxEYXRhID0gc3VtbWFyeURhdGE/LmZpbmFuY2lhbERhdGEgfHwge307XG4gICAgICAgICAgICBjb25zdCBzdW1tYXJ5UHJvZmlsZSA9IHN1bW1hcnlEYXRhPy5zdW1tYXJ5UHJvZmlsZSB8fCB7fTtcbiAgICAgICAgICAgIGNvbnN0IHByaWNlTW9kdWxlID0gc3VtbWFyeURhdGE/LnByaWNlIHx8IHt9O1xuICAgICAgICAgICAgY29uc3Qgc3VtbWFyeURldGFpbCA9IHN1bW1hcnlEYXRhPy5zdW1tYXJ5RGV0YWlsIHx8IHt9O1xuXG4gICAgICAgICAgICBjb25zdCBuYW1lID0gcHJpY2VNb2R1bGUuc2hvcnROYW1lIHx8IHByaWNlTW9kdWxlLmxvbmdOYW1lIHx8IHNvdGRTeW1ib2w7XG4gICAgICAgICAgICBjb25zdCBzZWN0b3IgPSBzdW1tYXJ5UHJvZmlsZS5zZWN0b3IgfHwgJ04vQSc7XG4gICAgICAgICAgICBjb25zdCBwZSA9IHN1bW1hcnlEZXRhaWw/LnRyYWlsaW5nUEU/LnJhdyB8fCBkZWZhdWx0S2V5U3RhdHM/LnRyYWlsaW5nUEU/LnJhdyB8fCBudWxsO1xuICAgICAgICAgICAgY29uc3QgZXBzID0gZGVmYXVsdEtleVN0YXRzPy50cmFpbGluZ0Vwcz8ucmF3IHx8IGZpbmFuY2lhbERhdGE/LmVhcm5pbmdzUGVyU2hhcmU/LnJhdyB8fCBudWxsO1xuICAgICAgICAgICAgY29uc3QgaGlnaDUyID0gc3VtbWFyeURldGFpbD8uZmlmdHlUd29XZWVrSGlnaD8ucmF3IHx8IG51bGw7XG4gICAgICAgICAgICBjb25zdCBsb3c1MiA9IHN1bW1hcnlEZXRhaWw/LmZpZnR5VHdvV2Vla0xvdz8ucmF3IHx8IG51bGw7XG5cbiAgICAgICAgICAgIC8vIFRyZW5kaW5nIHNjb3JlIGFuZCB2ZXJkaWN0XG4gICAgICAgICAgICBjb25zdCB0cmVuZGluZ1Njb3JlID0gTWF0aC5hYnMoY2hhbmdlUGN0KSAqIHZvbHVtZVJhdGlvO1xuICAgICAgICAgICAgbGV0IHZlcmRpY3Q7XG4gICAgICAgICAgICBpZiAoY2hhbmdlUGN0ID4gMikgdmVyZGljdCA9ICdTdXJnaW5nIFRvZGF5JztcbiAgICAgICAgICAgIGVsc2UgaWYgKGNoYW5nZVBjdCA+IDApIHZlcmRpY3QgPSAnVHJlbmRpbmcgVXAnO1xuICAgICAgICAgICAgZWxzZSBpZiAoY2hhbmdlUGN0ID4gLTIpIHZlcmRpY3QgPSAnU2xpZ2h0IERpcCc7XG4gICAgICAgICAgICBlbHNlIHZlcmRpY3QgPSAnVW5kZXIgUHJlc3N1cmUnO1xuXG4gICAgICAgICAgICBjb25zdCBzb3RkSGVhZGVycyA9IHsgLi4uSEVBREVSUywgJ0NhY2hlLUNvbnRyb2wnOiAncHVibGljLCBtYXgtYWdlPTM2MDAnIH07XG5cbiAgICAgICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICAgIHN5bWJvbDogc290ZFN5bWJvbCxcbiAgICAgICAgICAgICAgICBuYW1lLFxuICAgICAgICAgICAgICAgIHNlY3RvcixcbiAgICAgICAgICAgICAgICBwcmljZSxcbiAgICAgICAgICAgICAgICBjaGFuZ2U6IE1hdGgucm91bmQoY2hhbmdlICogMTAwKSAvIDEwMCxcbiAgICAgICAgICAgICAgICBjaGFuZ2VQY3Q6IE1hdGgucm91bmQoY2hhbmdlUGN0ICogMTAwKSAvIDEwMCxcbiAgICAgICAgICAgICAgICB2b2x1bWUsXG4gICAgICAgICAgICAgICAgYXZnVm9sdW1lOiBNYXRoLnJvdW5kKGF2Z1ZvbHVtZSksXG4gICAgICAgICAgICAgICAgcGUsXG4gICAgICAgICAgICAgICAgZXBzLFxuICAgICAgICAgICAgICAgIGhpZ2g1MixcbiAgICAgICAgICAgICAgICBsb3c1MixcbiAgICAgICAgICAgICAgICB2ZXJkaWN0LFxuICAgICAgICAgICAgICAgIHRyZW5kaW5nU2NvcmU6IE1hdGgucm91bmQodHJlbmRpbmdTY29yZSAqIDEwMCkgLyAxMDAsXG4gICAgICAgICAgICAgICAgZGF0ZTogZGF0ZVN0cixcbiAgICAgICAgICAgICAgICBjdXJyZW5jeSxcbiAgICAgICAgICAgIH0pLCB7IHN0YXR1czogMjAwLCBoZWFkZXJzOiBzb3RkSGVhZGVycyB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFNDUkVFTkVSXG4gICAgICAgIGlmICh0eXBlID09PSAnc2NyZWVuZXInKSB7XG4gICAgICAgICAgICBjb25zdCBzeW1ib2xzUGFyYW0gPSB1cmwuc2VhcmNoUGFyYW1zLmdldCgnc3ltYm9scycpO1xuICAgICAgICAgICAgaWYgKCFzeW1ib2xzUGFyYW0pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdzeW1ib2xzIHBhcmFtZXRlciByZXF1aXJlZCBmb3Igc2NyZWVuZXInIH0pLCB7IHN0YXR1czogNDAwLCBoZWFkZXJzOiBIRUFERVJTIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBzeW1ib2xzTGlzdCA9IHN5bWJvbHNQYXJhbS5zcGxpdCgnLCcpLm1hcChzID0+IHMudHJpbSgpKS5maWx0ZXIoQm9vbGVhbikuc2xpY2UoMCwgMTApO1xuICAgICAgICAgICAgaWYgKHN5bWJvbHNMaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ05vIHZhbGlkIHN5bWJvbHMgcHJvdmlkZWQnIH0pLCB7IHN0YXR1czogNDAwLCBoZWFkZXJzOiBIRUFERVJTIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBjb25zdCBmZXRjaFByb21pc2VzID0gc3ltYm9sc0xpc3QubWFwKGFzeW5jIChzeW0pID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBbY2hhcnRSZXMsIGZ1bmRSZXNdID0gYXdhaXQgUHJvbWlzZS5hbGxTZXR0bGVkKFtcbiAgICAgICAgICAgICAgICAgICAgeWFob29HZXQoYGh0dHBzOi8vcXVlcnkyLmZpbmFuY2UueWFob28uY29tL3Y4L2ZpbmFuY2UvY2hhcnQvJHtlbmNvZGVVUklDb21wb25lbnQoc3ltKX0/cmFuZ2U9MXkmaW50ZXJ2YWw9MWQmaW5jbHVkZVByZVBvc3Q9ZmFsc2VgKS50aGVuKHIgPT4gSlNPTi5wYXJzZShyLnRleHQpKSxcbiAgICAgICAgICAgICAgICAgICAgeWFob29HZXQoYGh0dHBzOi8vZmluYW5jZS55YWhvby5jb20vcXVvdGUvJHtlbmNvZGVVUklDb21wb25lbnQoc3ltKX0vYCkudGhlbihyID0+IGV4dHJhY3RRdW90ZVN1bW1hcnkoci50ZXh0KSksXG4gICAgICAgICAgICAgICAgXSk7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICAgICAgICBzeW1ib2w6IHN5bSxcbiAgICAgICAgICAgICAgICAgICAgY2hhcnQ6IGNoYXJ0UmVzLnN0YXR1cyA9PT0gJ2Z1bGZpbGxlZCcgPyBjaGFydFJlcy52YWx1ZSA6IG51bGwsXG4gICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IGZ1bmRSZXMuc3RhdHVzID09PSAnZnVsZmlsbGVkJyA/IGZ1bmRSZXMudmFsdWUgOiBudWxsLFxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgY29uc3Qgc2V0dGxlZFJlc3VsdHMgPSBhd2FpdCBQcm9taXNlLmFsbFNldHRsZWQoZmV0Y2hQcm9taXNlcyk7XG4gICAgICAgICAgICBjb25zdCByZXN1bHRzID0gc2V0dGxlZFJlc3VsdHNcbiAgICAgICAgICAgICAgICAuZmlsdGVyKHIgPT4gci5zdGF0dXMgPT09ICdmdWxmaWxsZWQnKVxuICAgICAgICAgICAgICAgIC5tYXAociA9PiByLnZhbHVlKTtcblxuICAgICAgICAgICAgY29uc3Qgc2NyZWVuZXJIZWFkZXJzID0geyAuLi5IRUFERVJTLCAnQ2FjaGUtQ29udHJvbCc6ICdwdWJsaWMsIG1heC1hZ2U9NjAwJyB9O1xuXG4gICAgICAgICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgcmVzdWx0cyB9KSwgeyBzdGF0dXM6IDIwMCwgaGVhZGVyczogc2NyZWVuZXJIZWFkZXJzIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnSW52YWxpZCB0eXBlJyB9KSwgeyBzdGF0dXM6IDQwMCwgaGVhZGVyczogSEVBREVSUyB9KTtcblxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBlLm1lc3NhZ2UgfSksIHsgc3RhdHVzOiA1MDAsIGhlYWRlcnM6IEhFQURFUlMgfSk7XG4gICAgfVxufTtcbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7QUFHQSxJQUFNLFVBQVU7QUFBQSxFQUNaLCtCQUErQjtBQUFBLEVBQy9CLGdDQUFnQztBQUFBLEVBQ2hDLGdCQUFnQjtBQUFBLEVBQ2hCLGlCQUFpQjtBQUNyQjtBQUVBLGVBQWUsU0FBUyxLQUFLO0FBQ3pCLFFBQU0sTUFBTSxNQUFNLE1BQU0sS0FBSztBQUFBLElBQ3pCLFNBQVMsRUFBRSxjQUFjLHFFQUFxRTtBQUFBLElBQzlGLFVBQVU7QUFBQSxFQUNkLENBQUM7QUFDRCxTQUFPLEVBQUUsUUFBUSxJQUFJLFFBQVEsTUFBTSxNQUFNLElBQUksS0FBSyxFQUFFO0FBQ3hEO0FBRUEsU0FBUyxvQkFBb0IsTUFBTTtBQUMvQixRQUFNLFFBQVE7QUFDZCxNQUFJO0FBQ0osVUFBUSxRQUFRLE1BQU0sS0FBSyxJQUFJLE9BQU8sTUFBTTtBQUN4QyxVQUFNLFVBQVUsTUFBTSxDQUFDO0FBQ3ZCLFFBQUksQ0FBQyxRQUFRLFNBQVMsZ0JBQWdCLEtBQUssQ0FB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
