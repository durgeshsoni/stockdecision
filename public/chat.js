// ===== AI Chat Assistant for StockDecision =====
// Client-side only. Uses existing globals: STOCK_DB, INDIAN_NAMES, apiGet, runAnalysis, lastAnalysis, showToast

let chatHistory = JSON.parse(localStorage.getItem('chatHistory') || '[]');
let chatOpen = false;
let chatProcessing = false;

// ===== Natural Language Helpers =====
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function humanNum(n, decimals = 2) {
    if (n == null || isNaN(n) || n === 0) return null;
    return n.toFixed(decimals);
}

function humanCrores(val) {
    if (!val || val <= 0) return null;
    const cr = val / 10000000;
    if (cr >= 100000) return (cr / 100000).toFixed(2) + ' Lakh Cr';
    if (cr >= 1000) return (cr / 1000).toFixed(1) + 'K Cr';
    if (cr >= 1) return Math.round(cr).toLocaleString() + ' Cr';
    return (val / 1000000).toFixed(1) + 'M';
}

function scoreWord(score) {
    if (score >= 75) return pick(['very strong', 'excellent', 'impressive']);
    if (score >= 60) return pick(['solid', 'good', 'promising']);
    if (score >= 45) return pick(['average', 'mixed', 'moderate']);
    if (score >= 30) return pick(['weak', 'concerning', 'below average']);
    return pick(['poor', 'very weak', 'worrying']);
}

function sentimentEmoji(score) {
    if (score >= 70) return '🟢';
    if (score >= 50) return '🟡';
    return '🔴';
}

function changeDescription(pct) {
    const abs = Math.abs(pct);
    if (pct > 5) return pick(['surging', 'rallying strongly', 'on a strong upswing']);
    if (pct > 2) return pick(['climbing nicely', 'showing positive momentum', 'trending up']);
    if (pct > 0) return pick(['slightly up', 'inching higher', 'marginally positive']);
    if (pct > -2) return pick(['slightly down', 'dipping marginally', 'under mild pressure']);
    if (pct > -5) return pick(['declining', 'pulling back', 'under selling pressure']);
    return pick(['falling sharply', 'taking a significant hit', 'in a steep decline']);
}

// ===== 1. Query Parser =====
function parseQuery(text) {
    const raw = text.trim();
    const lower = raw.toLowerCase();

    let intent = null;

    const intentMap = {
        compare:   ['compare', ' vs ', 'versus', 'better than', ' or '],
        dividend:  ['dividend', 'yield', 'income', 'passive income', 'dividen'],
        recommend: ['best', 'top stock', 'recommend', 'which stock', 'suggest', 'best stock'],
        price:     ['price', 'how much', 'current price', 'kya hai', 'kitna', 'rate'],
        help:      ['help', 'what can', 'commands', 'kya kar', 'how to use'],
        analyze:   ['good', 'bad', 'buy', 'sell', 'worth', 'analyze', 'analyse', 'how is', 'should i', 'kaisa', 'kaisi', 'analysis', 'review']
    };

    const intentOrder = ['help', 'compare', 'dividend', 'recommend', 'price', 'analyze'];
    for (const key of intentOrder) {
        if (intentMap[key].some(kw => lower.includes(kw))) {
            intent = key;
            break;
        }
    }

    const sectors = ['Banking', 'IT', 'Pharma', 'FMCG', 'Auto', 'Energy', 'Metals', 'Telecom', 'Infrastructure', 'Finance', 'Consumer', 'Tech', 'Defence', 'Power', 'Cement'];
    let sector = null;
    for (const s of sectors) {
        if (lower.includes(s.toLowerCase())) { sector = s; break; }
    }

    const symbols = [];
    const upperRaw = raw.toUpperCase();

    for (const stock of STOCK_DB) {
        const sym = stock.symbol.replace('.NS', '').replace('.BO', '');
        const nameLower = stock.name.toLowerCase();
        if (upperRaw.includes(sym) || lower.includes(nameLower)) {
            if (!symbols.includes(stock.symbol)) symbols.push(stock.symbol);
        }
        if (symbols.length >= 2) break;
    }

    if (symbols.length === 0) {
        const words = upperRaw.split(/[\s,]+/);
        for (const word of words) {
            if (word.length < 2) continue;
            if (INDIAN_NAMES[word]) symbols.push(INDIAN_NAMES[word]);
            if (symbols.length >= 2) break;
        }
    }

    if (symbols.length >= 2 && (intent === 'compare' || lower.includes('vs') || lower.includes('versus') || lower.includes(' or '))) {
        intent = 'compare';
    } else if (sector && symbols.length === 0 && !intent) {
        intent = 'sector';
    } else if (sector && !intent) {
        intent = 'sector';
    }

    if (symbols.length > 0 && !intent) intent = 'analyze';
    if (!intent) intent = 'help';

    return { intent, symbols, sector, raw };
}

// ===== 2. Response Generator =====
async function generateResponse(parsed) {
    switch (parsed.intent) {
        case 'analyze':   return await handleAnalyze(parsed);
        case 'compare':   return await handleCompare(parsed);
        case 'dividend':  return await handleDividend(parsed);
        case 'sector':    return await handleSector(parsed);
        case 'recommend': return handleRecommend(parsed);
        case 'price':     return await handlePrice(parsed);
        case 'help':
        default:          return handleHelp();
    }
}

async function fetchAndAnalyze(symbol) {
    const chartResp = await apiGet('chart', { symbol, range: '1y', interval: '1d' });
    if (!chartResp.chart?.result?.[0]) throw new Error(`No data for "${symbol}".`);
    const chartData = chartResp.chart.result[0];
    const timestamps = chartData.timestamp || [];
    const ohlcv = chartData.indicators?.quote?.[0] || {};
    const prices = [];
    for (let i = timestamps.length - 1; i >= 0; i--) {
        if (ohlcv.close[i] != null) {
            prices.push({
                date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
                open: ohlcv.open[i] || 0, high: ohlcv.high[i] || 0,
                low: ohlcv.low[i] || 0, close: ohlcv.close[i],
                volume: ohlcv.volume[i] || 0
            });
        }
    }
    if (prices.length < 5) throw new Error('Insufficient data.');
    const summary = await apiGet('fundamentals', { symbol });
    const meta = chartData.meta || {};
    const analysis = runAnalysis(prices, summary, meta, {});
    return { prices, summary, meta, analysis };
}

function getCurrencySymbol(meta) {
    const c = meta.currency || 'INR';
    return c === 'INR' ? '\u20B9' : c === 'USD' ? '$' : c === 'EUR' ? '\u20AC' : c;
}

function getStockName(summary, meta, symbol) {
    const pr = summary.price || {};
    return (pr.longName && pr.longName.raw) || (pr.shortName && pr.shortName.raw) || meta.longName || symbol;
}

// ===== Intent Handlers (Natural Language) =====

async function handleAnalyze(parsed) {
    if (parsed.symbols.length === 0) {
        return pick([
            'I\'d love to analyze a stock for you! Just mention the name — like <b>"Should I buy RELIANCE?"</b> or <b>"How is TCS doing?"</b>',
            'Tell me which stock you\'re interested in! Try something like <b>"Analyze HDFCBANK"</b> or <b>"Is INFY worth buying?"</b>',
            'Sure, I can help! Which stock are you looking at? For example: <b>"Is TATAMOTORS a good buy?"</b>'
        ]);
    }

    const symbol = parsed.symbols[0];
    try {
        const { prices, summary, meta, analysis } = await fetchAndAnalyze(symbol);
        const f = analysis.fundamentals;
        const cs = getCurrencySymbol(meta);
        const name = getStockName(summary, meta, symbol);
        const shortSym = symbol.replace('.NS', '').replace('.BO', '');
        const score = analysis.score;
        const dayChange = analysis.changes?.dayChange || 0;

        let response = '';

        // Dynamic opening based on score
        if (score >= 70) {
            response += pick([
                `<b>${name}</b> is looking really strong right now! ${sentimentEmoji(score)}`,
                `Great pick to ask about! <b>${name}</b> has some impressive numbers. ${sentimentEmoji(score)}`,
                `<b>${name}</b> is one of the stronger stocks I'm seeing right now. ${sentimentEmoji(score)}`
            ]);
        } else if (score >= 50) {
            response += pick([
                `<b>${name}</b> shows a mixed picture — let me break it down for you. ${sentimentEmoji(score)}`,
                `Interesting one! <b>${name}</b> has both strengths and areas of concern. ${sentimentEmoji(score)}`,
                `<b>${name}</b> is in a middle ground right now — not great, not terrible. ${sentimentEmoji(score)}`
            ]);
        } else {
            response += pick([
                `I'd be cautious with <b>${name}</b> right now. The signals aren't very encouraging. ${sentimentEmoji(score)}`,
                `<b>${name}</b> is showing some weakness at the moment. Here's what I see: ${sentimentEmoji(score)}`,
                `Honestly, <b>${name}</b> isn't looking great right now. Let me explain why. ${sentimentEmoji(score)}`
            ]);
        }

        // Score context - conversational
        response += `\n\nOur analysis engine scores it <b>${score}/100</b> — that's ${scoreWord(score)}.`;
        response += ` The technical side scores ${analysis.techScore}/100 and fundamentals come in at ${analysis.fundScore}/100.`;

        // Price info
        const currentPrice = prices[0]?.close;
        if (currentPrice) {
            response += `\n\nIt's currently trading at <b>${cs}${currentPrice.toLocaleString(undefined, {maximumFractionDigits: 2})}</b>`;
            if (dayChange !== 0) {
                response += `, ${changeDescription(dayChange)} (${dayChange >= 0 ? '+' : ''}${dayChange.toFixed(2)}% today).`;
            } else {
                response += '.';
            }
        }

        // Key fundamentals - only mention what's available, in natural language
        const insights = [];
        if (f.pe && f.pe > 0) {
            if (f.pe < 15) insights.push(`The P/E ratio is just <b>${f.pe.toFixed(1)}</b> — that's quite cheap and could mean good value.`);
            else if (f.pe < 25) insights.push(`P/E ratio sits at <b>${f.pe.toFixed(1)}</b>, which is reasonable.`);
            else if (f.pe < 40) insights.push(`The P/E is <b>${f.pe.toFixed(1)}</b> — on the higher side, so it's priced for growth.`);
            else insights.push(`With a P/E of <b>${f.pe.toFixed(1)}</b>, it's quite expensive. Make sure the growth justifies it.`);
        }
        if (f.roe && f.roe > 0) {
            const roePct = (f.roe * 100).toFixed(1);
            if (f.roe > 0.20) insights.push(`ROE is an impressive <b>${roePct}%</b> — management is using capital very efficiently.`);
            else if (f.roe > 0.12) insights.push(`ROE at <b>${roePct}%</b> is decent, showing reasonable profitability.`);
            else insights.push(`ROE is only <b>${roePct}%</b>, which is on the lower side.`);
        }
        if (f.divYield && f.divYield > 0.005) {
            insights.push(`It pays a dividend yield of <b>${(f.divYield * 100).toFixed(2)}%</b>${f.divYield > 0.03 ? ' — nice passive income!' : '.'}`);
        }
        if (f.debtToEquity && f.debtToEquity > 0) {
            if (f.debtToEquity > 1.5) insights.push(`Debt-to-equity is <b>${f.debtToEquity.toFixed(2)}</b> — that's high debt, which adds risk.`);
            else if (f.debtToEquity < 0.3) insights.push(`Very low debt (D/E: <b>${f.debtToEquity.toFixed(2)}</b>) — a clean balance sheet.`);
        }
        if (f.marketCap && f.marketCap > 0) {
            insights.push(`Market cap: <b>${cs}${humanCrores(f.marketCap)}</b>.`);
        }
        if (f.fiftyTwoWeekLow && f.fiftyTwoWeekHigh) {
            const range = `${cs}${f.fiftyTwoWeekLow.toFixed(0)} – ${cs}${f.fiftyTwoWeekHigh.toFixed(0)}`;
            if (currentPrice && f.fiftyTwoWeekHigh > 0) {
                const fromHigh = ((f.fiftyTwoWeekHigh - currentPrice) / f.fiftyTwoWeekHigh * 100).toFixed(0);
                const fromLow = ((currentPrice - f.fiftyTwoWeekLow) / f.fiftyTwoWeekLow * 100).toFixed(0);
                if (fromHigh < 5) insights.push(`It's trading near its 52-week high (${range}) — momentum is strong but entry risk is higher.`);
                else if (fromLow < 10) insights.push(`It's near its 52-week low (${range}) — could be a value opportunity or a falling knife.`);
                else insights.push(`52-week range: ${range}.`);
            }
        }

        if (insights.length > 0) {
            response += '\n\n' + insights.join(' ');
        }

        // Verdict - conversational
        response += '\n\n';
        if (score >= 65) {
            response += pick([
                `<b>Bottom line:</b> ${analysis.action}. ${analysis.investReason}`,
                `<b>My take:</b> This looks like a ${analysis.action.toLowerCase().includes('buy') ? 'buying opportunity' : 'decent hold'}. ${analysis.investReason}`,
                `<b>Verdict:</b> ${analysis.verdict}. ${analysis.investReason}`
            ]);
        } else if (score >= 40) {
            response += pick([
                `<b>Bottom line:</b> ${analysis.action}. I'd suggest caution — ${analysis.investReason}`,
                `<b>My take:</b> It's a wait-and-watch situation. ${analysis.investReason}`,
                `<b>Verdict:</b> ${analysis.verdict}. Not a clear buy signal yet. ${analysis.investReason}`
            ]);
        } else {
            response += pick([
                `<b>Bottom line:</b> ${analysis.action}. ${analysis.investReason} I'd stay away for now.`,
                `<b>My take:</b> The risk-reward doesn't look favorable. ${analysis.investReason}`,
                `<b>Verdict:</b> ${analysis.verdict}. Negative signals dominate here. ${analysis.investReason}`
            ]);
        }

        // Suggested follow-up
        response += '\n\n' + pick([
            `Want to compare it with another stock? Try <b>"Compare ${shortSym} vs ..."</b>`,
            `You can also ask me to <b>"Compare ${shortSym} vs"</b> any competitor, or check its <b>dividend details</b>.`,
            `Curious about alternatives? Try <b>"Best ${f.sector || 'stocks'} stocks"</b> or compare with a competitor.`
        ]);

        return response;
    } catch (err) {
        return pick([
            `Hmm, I couldn't pull data for <b>${symbol}</b> right now. ${err.message || ''} Want to try another stock?`,
            `Having trouble fetching <b>${symbol}</b>. ${err.message || 'It might be a connectivity issue.'} Give it another shot?`,
            `Oops! Couldn't get data for <b>${symbol}</b>. ${err.message || ''} Maybe try the full symbol like <b>"RELIANCE.NS"</b>?`
        ]);
    }
}

async function handleCompare(parsed) {
    if (parsed.symbols.length < 2) {
        return pick([
            'I need two stocks to compare! Try something like <b>"Compare TCS vs INFY"</b> or <b>"RELIANCE or HDFCBANK — which is better?"</b>',
            'Give me two stock names and I\'ll do a head-to-head! Example: <b>"TCS vs WIPRO"</b>',
            'To compare, mention both stocks: <b>"Is HDFCBANK better than ICICIBANK?"</b>'
        ]);
    }

    const [sym1, sym2] = parsed.symbols;
    try {
        const [res1, res2] = await Promise.all([fetchAndAnalyze(sym1), fetchAndAnalyze(sym2)]);
        const name1 = getStockName(res1.summary, res1.meta, sym1);
        const name2 = getStockName(res2.summary, res2.meta, sym2);
        const a1 = res1.analysis, a2 = res2.analysis;
        const f1 = a1.fundamentals, f2 = a2.fundamentals;
        const cs1 = getCurrencySymbol(res1.meta);
        const cs2 = getCurrencySymbol(res2.meta);

        const scoreDiff = Math.abs(a1.score - a2.score);
        const winner = a1.score > a2.score ? name1 : a2.score > a1.score ? name2 : null;
        const winAnalysis = a1.score >= a2.score ? a1 : a2;
        const loseAnalysis = a1.score >= a2.score ? a2 : a1;
        const winName = a1.score >= a2.score ? name1 : name2;
        const loseName = a1.score >= a2.score ? name2 : name1;

        let response = '';

        // Opening
        response += pick([
            `Let's put <b>${name1}</b> and <b>${name2}</b> head to head! ⚔️`,
            `Great comparison! Here's how <b>${name1}</b> stacks up against <b>${name2}</b>:`,
            `<b>${name1} vs ${name2}</b> — let's see who comes out on top! 📊`
        ]);

        // Stock 1 summary
        response += `\n\n<b>${name1}</b> ${sentimentEmoji(a1.score)}`;
        response += `\nScores <b>${a1.score}/100</b> (${a1.verdict})`;
        response += `\nTech: ${a1.techScore} | Fundamentals: ${a1.fundScore}`;
        const pe1 = f1.pe ? f1.pe.toFixed(1) : '—';
        const roe1 = f1.roe ? (f1.roe * 100).toFixed(1) + '%' : '—';
        const div1 = f1.divYield ? (f1.divYield * 100).toFixed(2) + '%' : '0%';
        response += `\nP/E: ${pe1} · ROE: ${roe1} · Div: ${div1}`;

        // Stock 2 summary
        response += `\n\n<b>${name2}</b> ${sentimentEmoji(a2.score)}`;
        response += `\nScores <b>${a2.score}/100</b> (${a2.verdict})`;
        response += `\nTech: ${a2.techScore} | Fundamentals: ${a2.fundScore}`;
        const pe2 = f2.pe ? f2.pe.toFixed(1) : '—';
        const roe2 = f2.roe ? (f2.roe * 100).toFixed(1) + '%' : '—';
        const div2 = f2.divYield ? (f2.divYield * 100).toFixed(2) + '%' : '0%';
        response += `\nP/E: ${pe2} · ROE: ${roe2} · Div: ${div2}`;

        // Verdict
        response += '\n\n';
        if (winner && scoreDiff >= 15) {
            response += pick([
                `<b>Clear winner: ${winName}</b> by ${scoreDiff} points! It's significantly stronger across the board right now.`,
                `<b>${winName} takes this convincingly</b> — a ${scoreDiff}-point lead. ${loseName} has ground to make up.`,
                `No contest here — <b>${winName} wins by ${scoreDiff} points</b>. If I had to choose, it'd be ${winName}.`
            ]);
        } else if (winner && scoreDiff >= 5) {
            response += pick([
                `<b>${winName} has the edge</b>, but only by ${scoreDiff} points. It's a close call — both have their merits.`,
                `Slight advantage to <b>${winName}</b> (+${scoreDiff} points), though ${loseName} isn't far behind.`,
                `<b>${winName} leads by ${scoreDiff}</b>, but this isn't a runaway. Your risk appetite should be the tiebreaker.`
            ]);
        } else {
            response += pick([
                `This is essentially a <b>tie!</b> Both stocks are neck and neck. Consider your sector preference or risk tolerance.`,
                `<b>Dead heat!</b> The scores are almost identical. Look at individual metrics that matter most to you.`,
                `<b>Too close to call</b> — both are in similar territory. Diversifying across both could be a smart move.`
            ]);
        }

        // Specific comparison insights
        const insights = [];
        if (f1.pe > 0 && f2.pe > 0) {
            const cheaper = f1.pe < f2.pe ? name1 : name2;
            if (Math.abs(f1.pe - f2.pe) > 5) insights.push(`<b>${cheaper}</b> is cheaper on valuation (lower P/E).`);
        }
        if (f1.divYield > 0 && f2.divYield > 0 && Math.abs(f1.divYield - f2.divYield) > 0.005) {
            const betterDiv = f1.divYield > f2.divYield ? name1 : name2;
            insights.push(`For dividend income, <b>${betterDiv}</b> pays more.`);
        }
        if (f1.roe > 0 && f2.roe > 0 && Math.abs(f1.roe - f2.roe) > 0.03) {
            const betterRoe = f1.roe > f2.roe ? name1 : name2;
            insights.push(`<b>${betterRoe}</b> is more profitable (higher ROE).`);
        }
        if (insights.length > 0) {
            response += '\n\n' + pick(['Quick notes: ', 'Key differences: ', 'Worth noting: ']) + insights.join(' ');
        }

        return response;
    } catch (err) {
        return `I ran into trouble comparing those two. ${err.message || 'One of the stocks might not have data available.'} Try again?`;
    }
}

async function handleDividend(parsed) {
    if (parsed.symbols.length > 0) {
        const symbol = parsed.symbols[0];
        try {
            const { summary, meta, analysis } = await fetchAndAnalyze(symbol);
            const f = analysis.fundamentals;
            const cs = getCurrencySymbol(meta);
            const name = getStockName(summary, meta, symbol);

            if (f.divYield <= 0 && f.divRate <= 0) {
                return pick([
                    `<b>${name}</b> doesn't currently pay a dividend, or at least there's no recorded yield. If passive income is your goal, you might want to look at stocks like <b>ITC, COALINDIA, POWERGRID</b>, or <b>ONGC</b> instead.`,
                    `No dividend data for <b>${name}</b> right now. It might be a growth-focused company that reinvests profits. For dividend income, try asking about <b>ITC</b> or <b>COALINDIA</b>.`,
                    `Looks like <b>${name}</b> isn't a dividend payer. Not all good stocks pay dividends — some prefer to reinvest. For yield, check out <b>POWERGRID</b> or <b>HINDUNILVR</b>.`
                ]);
            }

            let response = '';
            const yieldPct = (f.divYield * 100).toFixed(2);

            if (f.divYield > 0.04) {
                response += pick([
                    `Nice choice for income! <b>${name}</b> is a solid dividend stock. 💰`,
                    `<b>${name}</b> is one of the better dividend payers out there! 💰`,
                    `If you're after passive income, <b>${name}</b> delivers. 💰`
                ]);
            } else if (f.divYield > 0.015) {
                response += pick([
                    `<b>${name}</b> pays a decent dividend, though it won't make you rich on yield alone.`,
                    `<b>${name}</b> offers a moderate dividend — a nice bonus on top of any capital gains.`
                ]);
            } else {
                response += pick([
                    `<b>${name}</b> does pay a dividend, but the yield is modest.`,
                    `<b>${name}</b> has a small dividend — it's more of a growth play than an income stock.`
                ]);
            }

            response += `\n\nThe current dividend yield is <b>${yieldPct}%</b>`;
            if (f.divRate > 0) response += ` (${cs}${f.divRate.toFixed(2)} per share)`;
            response += '.';

            if (f.payoutRatio && f.payoutRatio > 0) {
                const pr = (f.payoutRatio * 100).toFixed(1);
                response += ` The payout ratio is ${pr}%`;
                if (f.payoutRatio > 0.8) response += ' — that\'s very high, which could be unsustainable.';
                else if (f.payoutRatio > 0.5) response += ' — healthy and sustainable.';
                else response += ' — conservative, with room to grow.';
            }

            response += `\n\nOverall health: <b>${analysis.score}/100</b> (${analysis.verdict}).`;

            if (f.divYield > 0.03) {
                response += '\n\n' + pick([
                    'This is a solid pick for a dividend-focused portfolio.',
                    'At this yield, it\'s a meaningful source of passive income.',
                    'Great for investors who want regular cash flow.'
                ]);
            }

            return response;
        } catch (err) {
            return `Couldn't pull dividend info for <b>${symbol}</b>. ${err.message || 'Try again?'}`;
        }
    }

    return pick([
        `Looking for dividend income? Here are India's <b>top dividend stocks</b> worth exploring:`,
        `Great question! If you want passive income from stocks, these are the ones to research:`,
        `Here are some well-known <b>dividend champions</b> in India:`
    ]) + `

&bull; <b>ITC</b> — FMCG giant, consistently high yield
&bull; <b>COALINDIA</b> — One of the highest dividend payers
&bull; <b>POWERGRID</b> — Stable utility, reliable yield
&bull; <b>ONGC</b> — Oil & Gas, generous dividends
&bull; <b>HINDUNILVR</b> — FMCG blue-chip, steady payer
&bull; <b>SBIN</b> — Banking heavyweight, growing dividends

` + pick([
        'Ask me about any of these! For example: <b>"Dividend yield of ITC"</b>',
        'Want details on any? Try: <b>"Tell me about COALINDIA dividend"</b>',
        'Pick one and I\'ll give you the full picture: <b>"Analyze ITC dividend"</b>'
    ]);
}

async function handleSector(parsed) {
    const sector = parsed.sector;
    if (!sector) {
        return pick([
            'Which sector interests you? I can analyze: <b>Banking, IT, Pharma, FMCG, Auto, Energy, Metals, Telecom, Defence, Power</b> and more!',
            'I cover several sectors! Try asking about <b>Banking, IT, Pharma, Auto, Energy</b>, or any other sector.',
            'Name a sector and I\'ll find the best stocks in it! For example: <b>"Best banking stocks"</b> or <b>"IT sector analysis"</b>'
        ]);
    }

    const sectorStocks = STOCK_DB.filter(s => s.sector.toLowerCase() === sector.toLowerCase());
    if (sectorStocks.length === 0) {
        return `I don't have stocks for the <b>${sector}</b> sector in my database right now. Try <b>Banking, IT, Pharma, FMCG, Auto, or Energy</b> — those have the best coverage.`;
    }

    const topPicks = sectorStocks.slice(0, 4);
    try {
        const results = await Promise.allSettled(topPicks.map(s => fetchAndAnalyze(s.symbol)));
        const scored = [];

        for (let i = 0; i < results.length; i++) {
            if (results[i].status === 'fulfilled') {
                const { summary, meta, analysis } = results[i].value;
                const name = getStockName(summary, meta, topPicks[i].symbol);
                scored.push({ name, symbol: topPicks[i].symbol, score: analysis.score, verdict: analysis.verdict, action: analysis.action, techScore: analysis.techScore, fundScore: analysis.fundScore });
            }
        }

        if (scored.length === 0) {
            return `Had trouble fetching data for ${sector} stocks. The market data might be temporarily unavailable. Try again in a moment?`;
        }

        scored.sort((a, b) => b.score - a.score);

        let response = pick([
            `Here's my <b>${sector} sector breakdown</b> — I analyzed the top ${scored.length} stocks: 📊`,
            `<b>${sector} Sector Report:</b> Let me rank the top picks for you! 📊`,
            `Done crunching the <b>${sector}</b> numbers! Here's what I found: 📊`
        ]);

        scored.forEach((s, idx) => {
            const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '•';
            response += `\n\n${medal} <b>${s.name}</b> — <b>${s.score}/100</b> (${s.verdict})`;
            response += `\n   Tech: ${s.techScore} · Fund: ${s.fundScore} · ${s.action}`;
        });

        response += '\n\n';
        if (scored[0].score >= 60) {
            response += pick([
                `<b>${scored[0].name}</b> leads the pack and looks like a solid pick in this sector!`,
                `My top pick here is <b>${scored[0].name}</b> — strongest overall profile.`,
                `If I had to choose one from ${sector}, it'd be <b>${scored[0].name}</b>.`
            ]);
        } else {
            response += pick([
                `None of the ${sector} stocks are screaming "buy" right now. The sector might be going through a rough patch.`,
                `The ${sector} sector looks a bit tepid overall. Consider waiting for better entry points.`,
                `${sector} isn't the strongest sector right now. Keep an eye on it for improvements.`
            ]);
        }

        response += `\n\nWant a deep dive? Ask <b>"Analyze ${scored[0].symbol.replace('.NS','').replace('.BO','')}"</b>`;
        return response;
    } catch (err) {
        return `Something went wrong analyzing the ${sector} sector. ${err.message || 'Try again?'}`;
    }
}

function handleRecommend(parsed) {
    if (typeof lastAnalysis !== 'undefined' && lastAnalysis) {
        const a = lastAnalysis.analysis;
        const name = getStockName(lastAnalysis.summary, lastAnalysis.meta, lastAnalysis.symbol);
        const score = a.score;

        let response = '';
        if (score >= 60) {
            response += `Based on your recent lookup, <b>${name}</b> (score: ${score}/100) actually looks ${scoreWord(score)}! ${a.investReason}`;
        } else {
            response += `You were just looking at <b>${name}</b> — it scored ${score}/100, which is ${scoreWord(score)}. ${a.investReason}`;
        }

        response += `\n\nWant to explore more? Here are some popular picks across sectors:`;
        response += `\n&bull; <b>RELIANCE</b> (Energy) · <b>TCS</b> (IT) · <b>HDFCBANK</b> (Banking)`;
        response += `\n&bull; <b>SUNPHARMA</b> (Pharma) · <b>ITC</b> (FMCG) · <b>MARUTI</b> (Auto)`;
        response += `\n\n` + pick([
            'Tell me to analyze any of these, or compare two stocks!',
            'Just name a stock and I\'ll give you the full breakdown.',
            'Pick any stock or sector — I\'m ready to crunch the numbers!'
        ]);
        return response;
    }

    return pick([
        `Here are some <b>blue-chip stocks</b> across sectors that are always worth researching:`,
        `I don't know your risk profile yet, but here are solid stocks to start exploring:`,
        `Great question! Let me suggest some <b>popular picks</b> to analyze:`
    ]) + `

&bull; <b>RELIANCE</b> — Energy & conglomerate, India's largest company
&bull; <b>TCS</b> — IT powerhouse, consistent performer
&bull; <b>HDFCBANK</b> — India's top private bank
&bull; <b>SUNPHARMA</b> — Leading pharma company
&bull; <b>ITC</b> — FMCG with excellent dividends
&bull; <b>MARUTI</b> — Dominant in passenger vehicles
&bull; <b>HAL</b> — Defence sector leader
&bull; <b>BAJFINANCE</b> — NBFC heavyweight

` + pick([
        'Ask me to analyze any of these! Like: <b>"Should I buy TCS?"</b>',
        'Just say the name and I\'ll give you a full analysis with score, verdict, and key metrics.',
        'Want me to pick the best? Try <b>"Best IT stocks"</b> or <b>"Compare RELIANCE vs TCS"</b>'
    ]);
}

async function handlePrice(parsed) {
    if (parsed.symbols.length === 0) {
        return pick([
            'Which stock\'s price do you want? Just tell me! Like <b>"Price of RELIANCE"</b> or <b>"TCS kitna hai?"</b>',
            'Sure! Which stock? Try <b>"HDFCBANK price"</b> or <b>"How much is INFY?"</b>',
            'Name the stock and I\'ll get you the latest price right away!'
        ]);
    }

    const symbol = parsed.symbols[0];
    try {
        const chartResp = await apiGet('chart', { symbol, range: '1d', interval: '5m' });
        if (!chartResp.chart?.result?.[0]) throw new Error('No data.');
        const chartData = chartResp.chart.result[0];
        const meta = chartData.meta || {};
        const cs = getCurrencySymbol(meta);
        const currentPrice = meta.regularMarketPrice || 0;
        const prevClose = meta.chartPreviousClose || meta.previousClose || 0;
        const change = currentPrice - prevClose;
        const changePct = prevClose > 0 ? (change / prevClose * 100) : 0;
        const name = meta.longName || meta.shortName || symbol;

        let response = `<b>${name}</b> is at <b>${cs}${currentPrice.toLocaleString(undefined, {maximumFractionDigits: 2})}</b>`;

        // Natural change description
        if (changePct !== 0) {
            const dir = changePct > 0 ? 'up' : 'down';
            response += ` — ${dir} <b>${Math.abs(changePct).toFixed(2)}%</b> (${change >= 0 ? '+' : ''}${cs}${change.toFixed(2)}) from yesterday's close of ${cs}${prevClose.toFixed(2)}.`;
        } else {
            response += ` — flat today. Previous close was ${cs}${prevClose.toFixed(2)}.`;
        }

        // Quick contextual comment
        response += '\n\n';
        if (changePct > 3) {
            response += pick(['Strong rally today! 🚀', 'Impressive move today! Buyers are in control.', 'Big green day! Momentum is clearly bullish.']);
        } else if (changePct > 0.5) {
            response += pick(['Nice positive day.', 'Holding up well today.', 'Modest gains — let\'s see if it sustains.']);
        } else if (changePct > -0.5) {
            response += pick(['Pretty flat — not much action today.', 'Quiet day for this one.', 'Consolidating around this level.']);
        } else if (changePct > -3) {
            response += pick(['Minor pullback today.', 'Slight weakness, nothing alarming.', 'Some selling pressure, but nothing dramatic.']);
        } else {
            response += pick(['Rough day! Significant selling pressure. 📉', 'Heavy selling today. Worth watching closely.', 'Ouch — big drop. Could be a dip to buy, or a warning sign.']);
        }

        response += '\n\n' + pick([
            `Want a full analysis? Ask <b>"Should I buy ${symbol.replace('.NS','').replace('.BO','')}"</b>`,
            `For the complete breakdown, try <b>"Analyze ${symbol.replace('.NS','').replace('.BO','')}"</b>`,
            `I can do a full technical + fundamental analysis too — just say the word!`
        ]);

        return response;
    } catch (err) {
        return `Couldn't fetch the price for <b>${symbol}</b>. ${err.message || 'It might be a network issue.'} Try again?`;
    }
}

function handleHelp() {
    return pick([
        `Hey! 👋 I'm your <b>StockDecision AI Assistant</b>. Here's what I can do:`,
        `Hi there! 👋 I'm here to help you make smarter stock decisions. Here's what I can help with:`,
        `Welcome! 👋 I'm your <b>AI-powered stock analyst</b>. Here's everything I can do:`
    ]) + `

<b>📈 Analyze a stock</b>
"Should I buy RELIANCE?"
"How is TCS doing?"
"Analyze HDFCBANK"

<b>⚔️ Compare two stocks</b>
"Compare TCS vs INFY"
"RELIANCE or HDFCBANK?"

<b>💰 Dividend info</b>
"Dividend yield of ITC"
"Best dividend stocks"

<b>🏢 Sector analysis</b>
"Best banking stocks"
"Analyze IT sector"

<b>💵 Quick price check</b>
"Price of RELIANCE"
"TCS kitna hai?"

<b>🎯 Recommendations</b>
"Best stocks to buy"
"Suggest something"

` + pick([
        'I understand natural language — just talk to me like you would to a friend who knows stocks! 🤝',
        'Just ask naturally — I understand Hindi-English mix too! Try <b>"RELIANCE kaisa hai?"</b> 🤝',
        'Pro tip: I also understand Hinglish! Ask me <b>"TCS accha hai kya?"</b> and I\'ll figure it out. 🤝'
    ]);
}

// ===== 3. UI Functions =====

function toggleChat() {
    chatOpen = !chatOpen;
    const panel = document.getElementById('chatPanel');
    const btn = document.getElementById('chatFab');

    if (chatOpen) {
        panel.classList.remove('hidden');
        if (btn) btn.classList.add('active');
        const msgs = document.getElementById('chatMessages');
        if (msgs.children.length === 0) {
            loadChatHistory();
            if (chatHistory.length === 0) {
                renderMessage('bot', handleHelp());
            }
        }
        setTimeout(() => document.getElementById('chatInput')?.focus(), 200);
    } else {
        panel.classList.add('hidden');
        if (btn) btn.classList.remove('active');
    }
}

async function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    if (chatProcessing) return;

    input.value = '';
    renderMessage('user', escapeHtml(text));
    saveChatEntry('user', escapeHtml(text));

    chatProcessing = true;
    showTyping();

    try {
        const parsed = parseQuery(text);
        const response = await generateResponse(parsed);
        hideTyping();
        renderMessage('bot', response);
        saveChatEntry('bot', response);
    } catch (err) {
        hideTyping();
        const errMsg = pick([
            'Something went wrong on my end. Mind trying again?',
            'Oops, hit a snag! Give it another try?',
            'That didn\'t work. Could be a network issue — try again in a moment.'
        ]);
        renderMessage('bot', errMsg);
        saveChatEntry('bot', errMsg);
    }

    chatProcessing = false;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderMessage(role, html) {
    const container = document.getElementById('chatMessages');
    const wrapper = document.createElement('div');
    wrapper.className = `chat-msg chat-${role}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = html.replace(/\n/g, '<br>');

    wrapper.appendChild(bubble);
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

function showTyping() {
    const container = document.getElementById('chatMessages');
    const existing = document.getElementById('chatTyping');
    if (existing) return;

    const typing = document.createElement('div');
    typing.id = 'chatTyping';
    typing.className = 'chat-msg chat-bot';
    typing.innerHTML = '<div class="chat-bubble typing-indicator"><span></span><span></span><span></span></div>';
    container.appendChild(typing);
    container.scrollTop = container.scrollHeight;
}

function hideTyping() {
    const typing = document.getElementById('chatTyping');
    if (typing) typing.remove();
}

function loadChatHistory() {
    const recent = chatHistory.slice(-20);
    for (const entry of recent) {
        renderMessage(entry.role, entry.html);
    }
}

function saveChatEntry(role, html) {
    chatHistory.push({ role, html, ts: Date.now() });
    if (chatHistory.length > 50) {
        chatHistory = chatHistory.slice(-50);
    }
    try {
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    } catch (e) {
        chatHistory = chatHistory.slice(-20);
        localStorage.setItem('chatHistory', JSON.stringify(chatHistory));
    }
}

// ===== 4. Initialization =====
document.addEventListener('DOMContentLoaded', () => {
    const fab = document.getElementById('chatFab');
    if (fab) fab.addEventListener('click', toggleChat);

    const closeBtn = document.getElementById('chatCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', toggleChat);

    const sendBtn = document.getElementById('chatSendBtn');
    if (sendBtn) sendBtn.addEventListener('click', sendChatMessage);

    const chatInput = document.getElementById('chatInput');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }
});
