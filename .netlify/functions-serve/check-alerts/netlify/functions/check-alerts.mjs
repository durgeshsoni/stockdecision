
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/check-alerts.mts
import { MongoClient } from "mongodb";
import { Resend } from "resend";
var resend = new Resend(process.env.RESEND_API_KEY);
var MAX_SYMBOLS_PER_RUN = 20;
var APP_URL = process.env.APP_URL || "https://stock-analyzer.netlify.app";
async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI not set");
  const client = new MongoClient(uri, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5e3
  });
  await client.connect();
  const dbName = process.env.MONGODB_DB_NAME || "stock_analyzer";
  return { client, db: client.db(dbName) };
}
async function fetchStockPrice(symbol) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; StockAlertBot/1.0)"
      }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.chart.error || !data.chart.result?.length) return null;
    return data.chart.result[0].meta.regularMarketPrice;
  } catch {
    return null;
  }
}
function isAlertTriggered(currentPrice, targetPrice, condition) {
  if (condition === "above") return currentPrice >= targetPrice;
  if (condition === "below") return currentPrice <= targetPrice;
  return false;
}
function buildEmailHtml(alert, currentPrice) {
  const conditionText = alert.condition === "above" ? "risen above" : "fallen below";
  const currencySymbol = alert.currency === "INR" ? "\u20B9" : alert.currency === "EUR" ? "\u20AC" : "$";
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7fa;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1a73e8,#0d47a1);padding:32px 40px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:600;">Price Alert Triggered</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="color:#333;font-size:16px;line-height:1.6;margin:0 0 24px;">
                Your price alert for <strong>${alert.name} (${alert.symbol})</strong> has been triggered.
                The stock price has ${conditionText} your target price.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8f9fb;border-radius:8px;margin-bottom:24px;">
                <tr>
                  <td style="padding:24px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;">
                          <span style="color:#666;font-size:14px;">Stock</span><br>
                          <strong style="color:#333;font-size:18px;">${alert.name} (${alert.symbol})</strong>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-top:1px solid #e0e0e0;">
                          <span style="color:#666;font-size:14px;">Target Price</span><br>
                          <strong style="color:#333;font-size:18px;">${currencySymbol}${alert.targetPrice.toFixed(2)}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-top:1px solid #e0e0e0;">
                          <span style="color:#666;font-size:14px;">Current Price</span><br>
                          <strong style="color:#1a73e8;font-size:22px;">${currencySymbol}${currentPrice.toFixed(2)}</strong>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-top:1px solid #e0e0e0;">
                          <span style="color:#666;font-size:14px;">Condition</span><br>
                          <strong style="color:#333;font-size:18px;">Price ${alert.condition} ${currencySymbol}${alert.targetPrice.toFixed(2)}</strong>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <div style="text-align:center;margin:32px 0;">
                <a href="${APP_URL}?symbol=${encodeURIComponent(alert.symbol)}"
                   style="display:inline-block;background:linear-gradient(135deg,#1a73e8,#0d47a1);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">
                  View on Stock Analyzer
                </a>
              </div>

              <p style="color:#999;font-size:12px;text-align:center;margin:24px 0 0;line-height:1.5;">
                This is an automated alert from Stock Analyzer.
                You can manage your alerts in your account dashboard.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
async function handler() {
  console.log("check-alerts: Starting scheduled alert check");
  let client;
  try {
    const connection = await getDb();
    client = connection.client;
    const db = connection.db;
    const activeAlerts = await db.collection("alerts").find({ status: "active" }).toArray();
    if (activeAlerts.length === 0) {
      console.log("check-alerts: No active alerts found");
      return new Response(JSON.stringify({ message: "No active alerts" }), {
        status: 200
      });
    }
    const alertsBySymbol = /* @__PURE__ */ new Map();
    for (const alert of activeAlerts) {
      const existing = alertsBySymbol.get(alert.symbol) || [];
      existing.push(alert);
      alertsBySymbol.set(alert.symbol, existing);
    }
    const symbols = Array.from(alertsBySymbol.keys()).slice(
      0,
      MAX_SYMBOLS_PER_RUN
    );
    console.log(
      `check-alerts: Checking ${symbols.length} symbols for ${activeAlerts.length} alerts`
    );
    let triggeredCount = 0;
    let checkedCount = 0;
    for (const symbol of symbols) {
      const currentPrice = await fetchStockPrice(symbol);
      if (currentPrice === null) {
        console.warn(`check-alerts: Could not fetch price for ${symbol}`);
        continue;
      }
      const symbolAlerts = alertsBySymbol.get(symbol) || [];
      for (const alert of symbolAlerts) {
        checkedCount++;
        if (isAlertTriggered(currentPrice, alert.targetPrice, alert.condition)) {
          triggeredCount++;
          const now = /* @__PURE__ */ new Date();
          await db.collection("alerts").updateOne(
            { _id: alert._id },
            {
              $set: {
                status: "triggered",
                triggeredAt: now,
                triggeredPrice: currentPrice,
                lastCheckedAt: now,
                lastCheckedPrice: currentPrice,
                updatedAt: now
              }
            }
          );
          await db.collection("alert_history").insertOne({
            uid: alert.uid,
            alertId: alert._id,
            symbol: alert.symbol,
            name: alert.name,
            targetPrice: alert.targetPrice,
            triggeredPrice: currentPrice,
            condition: alert.condition,
            currency: alert.currency,
            triggeredAt: now
          });
          if (alert.email) {
            try {
              await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL || "Stock Analyzer <alerts@stock-analyzer.com>",
                to: alert.email,
                subject: `Price Alert: ${alert.name} (${alert.symbol}) has ${alert.condition === "above" ? "risen above" : "fallen below"} your target`,
                html: buildEmailHtml(alert, currentPrice)
              });
              console.log(
                `check-alerts: Email sent to ${alert.email} for ${alert.symbol}`
              );
            } catch (emailErr) {
              console.error(
                `check-alerts: Failed to send email for ${alert.symbol}:`,
                emailErr
              );
            }
          }
        } else {
          await db.collection("alerts").updateOne(
            { _id: alert._id },
            {
              $set: {
                lastCheckedAt: /* @__PURE__ */ new Date(),
                lastCheckedPrice: currentPrice
              }
            }
          );
        }
      }
    }
    console.log(
      `check-alerts: Done. Checked ${checkedCount} alerts, ${triggeredCount} triggered.`
    );
    return new Response(
      JSON.stringify({
        message: "Alert check complete",
        checked: checkedCount,
        triggered: triggeredCount,
        symbolsProcessed: symbols.length
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error("check-alerts: Error:", err);
    return new Response(
      JSON.stringify({ error: "Alert check failed" }),
      { status: 500 }
    );
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
      }
    }
  }
}
var config = {
  schedule: "@every 15m"
};
export {
  config,
  handler as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvY2hlY2stYWxlcnRzLm10cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHR5cGUgeyBDb25maWcgfSBmcm9tICdAbmV0bGlmeS9mdW5jdGlvbnMnO1xuaW1wb3J0IHsgTW9uZ29DbGllbnQgfSBmcm9tICdtb25nb2RiJztcbmltcG9ydCB7IFJlc2VuZCB9IGZyb20gJ3Jlc2VuZCc7XG5cbmNvbnN0IHJlc2VuZCA9IG5ldyBSZXNlbmQocHJvY2Vzcy5lbnYuUkVTRU5EX0FQSV9LRVkpO1xuXG5jb25zdCBNQVhfU1lNQk9MU19QRVJfUlVOID0gMjA7XG5jb25zdCBBUFBfVVJMID0gcHJvY2Vzcy5lbnYuQVBQX1VSTCB8fCAnaHR0cHM6Ly9zdG9jay1hbmFseXplci5uZXRsaWZ5LmFwcCc7XG5cbmludGVyZmFjZSBBbGVydCB7XG4gIF9pZDogYW55O1xuICB1aWQ6IHN0cmluZztcbiAgZW1haWw6IHN0cmluZztcbiAgc3ltYm9sOiBzdHJpbmc7XG4gIG5hbWU6IHN0cmluZztcbiAgdGFyZ2V0UHJpY2U6IG51bWJlcjtcbiAgY29uZGl0aW9uOiAnYWJvdmUnIHwgJ2JlbG93JztcbiAgY3VycmVuY3k6IHN0cmluZztcbiAgc3RhdHVzOiBzdHJpbmc7XG4gIGNyZWF0ZWRBdDogRGF0ZTtcbiAgbGFzdENoZWNrZWRBdDogRGF0ZSB8IG51bGw7XG4gIGxhc3RDaGVja2VkUHJpY2U6IG51bWJlciB8IG51bGw7XG59XG5cbmludGVyZmFjZSBZYWhvb0NoYXJ0UmVzcG9uc2Uge1xuICBjaGFydDoge1xuICAgIHJlc3VsdDogQXJyYXk8e1xuICAgICAgbWV0YToge1xuICAgICAgICByZWd1bGFyTWFya2V0UHJpY2U6IG51bWJlcjtcbiAgICAgICAgY3VycmVuY3k6IHN0cmluZztcbiAgICAgICAgc3ltYm9sOiBzdHJpbmc7XG4gICAgICB9O1xuICAgIH0+O1xuICAgIGVycm9yOiBhbnk7XG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldERiKCkge1xuICBjb25zdCB1cmkgPSBwcm9jZXNzLmVudi5NT05HT0RCX1VSSTtcbiAgaWYgKCF1cmkpIHRocm93IG5ldyBFcnJvcignTU9OR09EQl9VUkkgbm90IHNldCcpO1xuXG4gIGNvbnN0IGNsaWVudCA9IG5ldyBNb25nb0NsaWVudCh1cmksIHtcbiAgICBtYXhQb29sU2l6ZTogMSxcbiAgICBzZXJ2ZXJTZWxlY3Rpb25UaW1lb3V0TVM6IDUwMDAsXG4gIH0pO1xuXG4gIGF3YWl0IGNsaWVudC5jb25uZWN0KCk7XG4gIGNvbnN0IGRiTmFtZSA9IHByb2Nlc3MuZW52Lk1PTkdPREJfREJfTkFNRSB8fCAnc3RvY2tfYW5hbHl6ZXInO1xuICByZXR1cm4geyBjbGllbnQsIGRiOiBjbGllbnQuZGIoZGJOYW1lKSB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaFN0b2NrUHJpY2Uoc3ltYm9sOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlciB8IG51bGw+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCB1cmwgPSBgaHR0cHM6Ly9xdWVyeTIuZmluYW5jZS55YWhvby5jb20vdjgvZmluYW5jZS9jaGFydC8ke2VuY29kZVVSSUNvbXBvbmVudChzeW1ib2wpfT9yYW5nZT0xZCZpbnRlcnZhbD0xZGA7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh1cmwsIHtcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ1VzZXItQWdlbnQnOiAnTW96aWxsYS81LjAgKGNvbXBhdGlibGU7IFN0b2NrQWxlcnRCb3QvMS4wKScsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgaWYgKCFyZXNwb25zZS5vaykgcmV0dXJuIG51bGw7XG5cbiAgICBjb25zdCBkYXRhOiBZYWhvb0NoYXJ0UmVzcG9uc2UgPSBhd2FpdCByZXNwb25zZS5qc29uKCk7XG5cbiAgICBpZiAoZGF0YS5jaGFydC5lcnJvciB8fCAhZGF0YS5jaGFydC5yZXN1bHQ/Lmxlbmd0aCkgcmV0dXJuIG51bGw7XG5cbiAgICByZXR1cm4gZGF0YS5jaGFydC5yZXN1bHRbMF0ubWV0YS5yZWd1bGFyTWFya2V0UHJpY2U7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIGlzQWxlcnRUcmlnZ2VyZWQoXG4gIGN1cnJlbnRQcmljZTogbnVtYmVyLFxuICB0YXJnZXRQcmljZTogbnVtYmVyLFxuICBjb25kaXRpb246ICdhYm92ZScgfCAnYmVsb3cnXG4pOiBib29sZWFuIHtcbiAgaWYgKGNvbmRpdGlvbiA9PT0gJ2Fib3ZlJykgcmV0dXJuIGN1cnJlbnRQcmljZSA+PSB0YXJnZXRQcmljZTtcbiAgaWYgKGNvbmRpdGlvbiA9PT0gJ2JlbG93JykgcmV0dXJuIGN1cnJlbnRQcmljZSA8PSB0YXJnZXRQcmljZTtcbiAgcmV0dXJuIGZhbHNlO1xufVxuXG5mdW5jdGlvbiBidWlsZEVtYWlsSHRtbChhbGVydDogQWxlcnQsIGN1cnJlbnRQcmljZTogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3QgY29uZGl0aW9uVGV4dCA9XG4gICAgYWxlcnQuY29uZGl0aW9uID09PSAnYWJvdmUnID8gJ3Jpc2VuIGFib3ZlJyA6ICdmYWxsZW4gYmVsb3cnO1xuICBjb25zdCBjdXJyZW5jeVN5bWJvbCA9XG4gICAgYWxlcnQuY3VycmVuY3kgPT09ICdJTlInID8gJ1x1MjBCOScgOiBhbGVydC5jdXJyZW5jeSA9PT0gJ0VVUicgPyAnXHUyMEFDJyA6ICckJztcblxuICByZXR1cm4gYFxuPCFET0NUWVBFIGh0bWw+XG48aHRtbD5cbjxoZWFkPlxuICA8bWV0YSBjaGFyc2V0PVwidXRmLThcIj5cbiAgPG1ldGEgbmFtZT1cInZpZXdwb3J0XCIgY29udGVudD1cIndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjBcIj5cbjwvaGVhZD5cbjxib2R5IHN0eWxlPVwibWFyZ2luOjA7cGFkZGluZzowO2JhY2tncm91bmQtY29sb3I6I2Y0ZjdmYTtmb250LWZhbWlseTotYXBwbGUtc3lzdGVtLEJsaW5rTWFjU3lzdGVtRm9udCwnU2Vnb2UgVUknLFJvYm90byxzYW5zLXNlcmlmO1wiPlxuICA8dGFibGUgd2lkdGg9XCIxMDAlXCIgY2VsbHBhZGRpbmc9XCIwXCIgY2VsbHNwYWNpbmc9XCIwXCIgc3R5bGU9XCJiYWNrZ3JvdW5kLWNvbG9yOiNmNGY3ZmE7cGFkZGluZzo0MHB4IDIwcHg7XCI+XG4gICAgPHRyPlxuICAgICAgPHRkIGFsaWduPVwiY2VudGVyXCI+XG4gICAgICAgIDx0YWJsZSB3aWR0aD1cIjYwMFwiIGNlbGxwYWRkaW5nPVwiMFwiIGNlbGxzcGFjaW5nPVwiMFwiIHN0eWxlPVwiYmFja2dyb3VuZC1jb2xvcjojZmZmZmZmO2JvcmRlci1yYWRpdXM6MTJweDtvdmVyZmxvdzpoaWRkZW47Ym94LXNoYWRvdzowIDRweCAxMnB4IHJnYmEoMCwwLDAsMC4xKTtcIj5cbiAgICAgICAgICA8IS0tIEhlYWRlciAtLT5cbiAgICAgICAgICA8dHI+XG4gICAgICAgICAgICA8dGQgc3R5bGU9XCJiYWNrZ3JvdW5kOmxpbmVhci1ncmFkaWVudCgxMzVkZWcsIzFhNzNlOCwjMGQ0N2ExKTtwYWRkaW5nOjMycHggNDBweDt0ZXh0LWFsaWduOmNlbnRlcjtcIj5cbiAgICAgICAgICAgICAgPGgxIHN0eWxlPVwiY29sb3I6I2ZmZmZmZjttYXJnaW46MDtmb250LXNpemU6MjRweDtmb250LXdlaWdodDo2MDA7XCI+UHJpY2UgQWxlcnQgVHJpZ2dlcmVkPC9oMT5cbiAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgPC90cj5cbiAgICAgICAgICA8IS0tIEJvZHkgLS0+XG4gICAgICAgICAgPHRyPlxuICAgICAgICAgICAgPHRkIHN0eWxlPVwicGFkZGluZzo0MHB4O1wiPlxuICAgICAgICAgICAgICA8cCBzdHlsZT1cImNvbG9yOiMzMzM7Zm9udC1zaXplOjE2cHg7bGluZS1oZWlnaHQ6MS42O21hcmdpbjowIDAgMjRweDtcIj5cbiAgICAgICAgICAgICAgICBZb3VyIHByaWNlIGFsZXJ0IGZvciA8c3Ryb25nPiR7YWxlcnQubmFtZX0gKCR7YWxlcnQuc3ltYm9sfSk8L3N0cm9uZz4gaGFzIGJlZW4gdHJpZ2dlcmVkLlxuICAgICAgICAgICAgICAgIFRoZSBzdG9jayBwcmljZSBoYXMgJHtjb25kaXRpb25UZXh0fSB5b3VyIHRhcmdldCBwcmljZS5cbiAgICAgICAgICAgICAgPC9wPlxuXG4gICAgICAgICAgICAgIDx0YWJsZSB3aWR0aD1cIjEwMCVcIiBjZWxscGFkZGluZz1cIjBcIiBjZWxsc3BhY2luZz1cIjBcIiBzdHlsZT1cImJhY2tncm91bmQtY29sb3I6I2Y4ZjlmYjtib3JkZXItcmFkaXVzOjhweDttYXJnaW4tYm90dG9tOjI0cHg7XCI+XG4gICAgICAgICAgICAgICAgPHRyPlxuICAgICAgICAgICAgICAgICAgPHRkIHN0eWxlPVwicGFkZGluZzoyNHB4O1wiPlxuICAgICAgICAgICAgICAgICAgICA8dGFibGUgd2lkdGg9XCIxMDAlXCIgY2VsbHBhZGRpbmc9XCIwXCIgY2VsbHNwYWNpbmc9XCIwXCI+XG4gICAgICAgICAgICAgICAgICAgICAgPHRyPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMDtcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9XCJjb2xvcjojNjY2O2ZvbnQtc2l6ZToxNHB4O1wiPlN0b2NrPC9zcGFuPjxicj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgPHN0cm9uZyBzdHlsZT1cImNvbG9yOiMzMzM7Zm9udC1zaXplOjE4cHg7XCI+JHthbGVydC5uYW1lfSAoJHthbGVydC5zeW1ib2x9KTwvc3Ryb25nPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgICAgICAgICAgIDx0cj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDA7Ym9yZGVyLXRvcDoxcHggc29saWQgI2UwZTBlMDtcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9XCJjb2xvcjojNjY2O2ZvbnQtc2l6ZToxNHB4O1wiPlRhcmdldCBQcmljZTwvc3Bhbj48YnI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgIDxzdHJvbmcgc3R5bGU9XCJjb2xvcjojMzMzO2ZvbnQtc2l6ZToxOHB4O1wiPiR7Y3VycmVuY3lTeW1ib2x9JHthbGVydC50YXJnZXRQcmljZS50b0ZpeGVkKDIpfTwvc3Ryb25nPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgICAgICAgICAgIDx0cj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDx0ZCBzdHlsZT1cInBhZGRpbmc6OHB4IDA7Ym9yZGVyLXRvcDoxcHggc29saWQgI2UwZTBlMDtcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgPHNwYW4gc3R5bGU9XCJjb2xvcjojNjY2O2ZvbnQtc2l6ZToxNHB4O1wiPkN1cnJlbnQgUHJpY2U8L3NwYW4+PGJyPlxuICAgICAgICAgICAgICAgICAgICAgICAgICA8c3Ryb25nIHN0eWxlPVwiY29sb3I6IzFhNzNlODtmb250LXNpemU6MjJweDtcIj4ke2N1cnJlbmN5U3ltYm9sfSR7Y3VycmVudFByaWNlLnRvRml4ZWQoMil9PC9zdHJvbmc+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgIDwvdHI+XG4gICAgICAgICAgICAgICAgICAgICAgPHRyPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIHN0eWxlPVwicGFkZGluZzo4cHggMDtib3JkZXItdG9wOjFweCBzb2xpZCAjZTBlMGUwO1wiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICA8c3BhbiBzdHlsZT1cImNvbG9yOiM2NjY7Zm9udC1zaXplOjE0cHg7XCI+Q29uZGl0aW9uPC9zcGFuPjxicj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgPHN0cm9uZyBzdHlsZT1cImNvbG9yOiMzMzM7Zm9udC1zaXplOjE4cHg7XCI+UHJpY2UgJHthbGVydC5jb25kaXRpb259ICR7Y3VycmVuY3lTeW1ib2x9JHthbGVydC50YXJnZXRQcmljZS50b0ZpeGVkKDIpfTwvc3Ryb25nPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgICAgICAgICA8L3RhYmxlPlxuICAgICAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgICA8L3RhYmxlPlxuXG4gICAgICAgICAgICAgIDxkaXYgc3R5bGU9XCJ0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW46MzJweCAwO1wiPlxuICAgICAgICAgICAgICAgIDxhIGhyZWY9XCIke0FQUF9VUkx9P3N5bWJvbD0ke2VuY29kZVVSSUNvbXBvbmVudChhbGVydC5zeW1ib2wpfVwiXG4gICAgICAgICAgICAgICAgICAgc3R5bGU9XCJkaXNwbGF5OmlubGluZS1ibG9jaztiYWNrZ3JvdW5kOmxpbmVhci1ncmFkaWVudCgxMzVkZWcsIzFhNzNlOCwjMGQ0N2ExKTtjb2xvcjojZmZmZmZmO3RleHQtZGVjb3JhdGlvbjpub25lO3BhZGRpbmc6MTRweCAzMnB4O2JvcmRlci1yYWRpdXM6OHB4O2ZvbnQtc2l6ZToxNnB4O2ZvbnQtd2VpZ2h0OjYwMDtcIj5cbiAgICAgICAgICAgICAgICAgIFZpZXcgb24gU3RvY2sgQW5hbHl6ZXJcbiAgICAgICAgICAgICAgICA8L2E+XG4gICAgICAgICAgICAgIDwvZGl2PlxuXG4gICAgICAgICAgICAgIDxwIHN0eWxlPVwiY29sb3I6Izk5OTtmb250LXNpemU6MTJweDt0ZXh0LWFsaWduOmNlbnRlcjttYXJnaW46MjRweCAwIDA7bGluZS1oZWlnaHQ6MS41O1wiPlxuICAgICAgICAgICAgICAgIFRoaXMgaXMgYW4gYXV0b21hdGVkIGFsZXJ0IGZyb20gU3RvY2sgQW5hbHl6ZXIuXG4gICAgICAgICAgICAgICAgWW91IGNhbiBtYW5hZ2UgeW91ciBhbGVydHMgaW4geW91ciBhY2NvdW50IGRhc2hib2FyZC5cbiAgICAgICAgICAgICAgPC9wPlxuICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICA8L3RyPlxuICAgICAgICA8L3RhYmxlPlxuICAgICAgPC90ZD5cbiAgICA8L3RyPlxuICA8L3RhYmxlPlxuPC9ib2R5PlxuPC9odG1sPmA7XG59XG5cbmV4cG9ydCBkZWZhdWx0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZXIoKSB7XG4gIGNvbnNvbGUubG9nKCdjaGVjay1hbGVydHM6IFN0YXJ0aW5nIHNjaGVkdWxlZCBhbGVydCBjaGVjaycpO1xuXG4gIGxldCBjbGllbnQ7XG4gIHRyeSB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IGdldERiKCk7XG4gICAgY2xpZW50ID0gY29ubmVjdGlvbi5jbGllbnQ7XG4gICAgY29uc3QgZGIgPSBjb25uZWN0aW9uLmRiO1xuXG4gICAgLy8gR2V0IGFsbCBhY3RpdmUgYWxlcnRzXG4gICAgY29uc3QgYWN0aXZlQWxlcnRzID0gYXdhaXQgZGJcbiAgICAgIC5jb2xsZWN0aW9uPEFsZXJ0PignYWxlcnRzJylcbiAgICAgIC5maW5kKHsgc3RhdHVzOiAnYWN0aXZlJyB9KVxuICAgICAgLnRvQXJyYXkoKTtcblxuICAgIGlmIChhY3RpdmVBbGVydHMubGVuZ3RoID09PSAwKSB7XG4gICAgICBjb25zb2xlLmxvZygnY2hlY2stYWxlcnRzOiBObyBhY3RpdmUgYWxlcnRzIGZvdW5kJyk7XG4gICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgbWVzc2FnZTogJ05vIGFjdGl2ZSBhbGVydHMnIH0pLCB7XG4gICAgICAgIHN0YXR1czogMjAwLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gR3JvdXAgYWxlcnRzIGJ5IHN5bWJvbFxuICAgIGNvbnN0IGFsZXJ0c0J5U3ltYm9sID0gbmV3IE1hcDxzdHJpbmcsIEFsZXJ0W10+KCk7XG4gICAgZm9yIChjb25zdCBhbGVydCBvZiBhY3RpdmVBbGVydHMpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYWxlcnRzQnlTeW1ib2wuZ2V0KGFsZXJ0LnN5bWJvbCkgfHwgW107XG4gICAgICBleGlzdGluZy5wdXNoKGFsZXJ0KTtcbiAgICAgIGFsZXJ0c0J5U3ltYm9sLnNldChhbGVydC5zeW1ib2wsIGV4aXN0aW5nKTtcbiAgICB9XG5cbiAgICAvLyBMaW1pdCB0byBNQVhfU1lNQk9MU19QRVJfUlVOIHVuaXF1ZSBzeW1ib2xzXG4gICAgY29uc3Qgc3ltYm9scyA9IEFycmF5LmZyb20oYWxlcnRzQnlTeW1ib2wua2V5cygpKS5zbGljZShcbiAgICAgIDAsXG4gICAgICBNQVhfU1lNQk9MU19QRVJfUlVOXG4gICAgKTtcblxuICAgIGNvbnNvbGUubG9nKFxuICAgICAgYGNoZWNrLWFsZXJ0czogQ2hlY2tpbmcgJHtzeW1ib2xzLmxlbmd0aH0gc3ltYm9scyBmb3IgJHthY3RpdmVBbGVydHMubGVuZ3RofSBhbGVydHNgXG4gICAgKTtcblxuICAgIGxldCB0cmlnZ2VyZWRDb3VudCA9IDA7XG4gICAgbGV0IGNoZWNrZWRDb3VudCA9IDA7XG5cbiAgICBmb3IgKGNvbnN0IHN5bWJvbCBvZiBzeW1ib2xzKSB7XG4gICAgICBjb25zdCBjdXJyZW50UHJpY2UgPSBhd2FpdCBmZXRjaFN0b2NrUHJpY2Uoc3ltYm9sKTtcblxuICAgICAgaWYgKGN1cnJlbnRQcmljZSA9PT0gbnVsbCkge1xuICAgICAgICBjb25zb2xlLndhcm4oYGNoZWNrLWFsZXJ0czogQ291bGQgbm90IGZldGNoIHByaWNlIGZvciAke3N5bWJvbH1gKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHN5bWJvbEFsZXJ0cyA9IGFsZXJ0c0J5U3ltYm9sLmdldChzeW1ib2wpIHx8IFtdO1xuXG4gICAgICBmb3IgKGNvbnN0IGFsZXJ0IG9mIHN5bWJvbEFsZXJ0cykge1xuICAgICAgICBjaGVja2VkQ291bnQrKztcblxuICAgICAgICBpZiAoaXNBbGVydFRyaWdnZXJlZChjdXJyZW50UHJpY2UsIGFsZXJ0LnRhcmdldFByaWNlLCBhbGVydC5jb25kaXRpb24pKSB7XG4gICAgICAgICAgLy8gQWxlcnQgdHJpZ2dlcmVkXG4gICAgICAgICAgdHJpZ2dlcmVkQ291bnQrKztcbiAgICAgICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuXG4gICAgICAgICAgLy8gVXBkYXRlIGFsZXJ0IHN0YXR1c1xuICAgICAgICAgIGF3YWl0IGRiLmNvbGxlY3Rpb24oJ2FsZXJ0cycpLnVwZGF0ZU9uZShcbiAgICAgICAgICAgIHsgX2lkOiBhbGVydC5faWQgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgJHNldDoge1xuICAgICAgICAgICAgICAgIHN0YXR1czogJ3RyaWdnZXJlZCcsXG4gICAgICAgICAgICAgICAgdHJpZ2dlcmVkQXQ6IG5vdyxcbiAgICAgICAgICAgICAgICB0cmlnZ2VyZWRQcmljZTogY3VycmVudFByaWNlLFxuICAgICAgICAgICAgICAgIGxhc3RDaGVja2VkQXQ6IG5vdyxcbiAgICAgICAgICAgICAgICBsYXN0Q2hlY2tlZFByaWNlOiBjdXJyZW50UHJpY2UsXG4gICAgICAgICAgICAgICAgdXBkYXRlZEF0OiBub3csXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9XG4gICAgICAgICAgKTtcblxuICAgICAgICAgIC8vIEluc2VydCBpbnRvIGFsZXJ0IGhpc3RvcnlcbiAgICAgICAgICBhd2FpdCBkYi5jb2xsZWN0aW9uKCdhbGVydF9oaXN0b3J5JykuaW5zZXJ0T25lKHtcbiAgICAgICAgICAgIHVpZDogYWxlcnQudWlkLFxuICAgICAgICAgICAgYWxlcnRJZDogYWxlcnQuX2lkLFxuICAgICAgICAgICAgc3ltYm9sOiBhbGVydC5zeW1ib2wsXG4gICAgICAgICAgICBuYW1lOiBhbGVydC5uYW1lLFxuICAgICAgICAgICAgdGFyZ2V0UHJpY2U6IGFsZXJ0LnRhcmdldFByaWNlLFxuICAgICAgICAgICAgdHJpZ2dlcmVkUHJpY2U6IGN1cnJlbnRQcmljZSxcbiAgICAgICAgICAgIGNvbmRpdGlvbjogYWxlcnQuY29uZGl0aW9uLFxuICAgICAgICAgICAgY3VycmVuY3k6IGFsZXJ0LmN1cnJlbmN5LFxuICAgICAgICAgICAgdHJpZ2dlcmVkQXQ6IG5vdyxcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIC8vIFNlbmQgZW1haWwgbm90aWZpY2F0aW9uXG4gICAgICAgICAgaWYgKGFsZXJ0LmVtYWlsKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICBhd2FpdCByZXNlbmQuZW1haWxzLnNlbmQoe1xuICAgICAgICAgICAgICAgIGZyb206XG4gICAgICAgICAgICAgICAgICBwcm9jZXNzLmVudi5SRVNFTkRfRlJPTV9FTUFJTCB8fFxuICAgICAgICAgICAgICAgICAgJ1N0b2NrIEFuYWx5emVyIDxhbGVydHNAc3RvY2stYW5hbHl6ZXIuY29tPicsXG4gICAgICAgICAgICAgICAgdG86IGFsZXJ0LmVtYWlsLFxuICAgICAgICAgICAgICAgIHN1YmplY3Q6IGBQcmljZSBBbGVydDogJHthbGVydC5uYW1lfSAoJHthbGVydC5zeW1ib2x9KSBoYXMgJHthbGVydC5jb25kaXRpb24gPT09ICdhYm92ZScgPyAncmlzZW4gYWJvdmUnIDogJ2ZhbGxlbiBiZWxvdyd9IHlvdXIgdGFyZ2V0YCxcbiAgICAgICAgICAgICAgICBodG1sOiBidWlsZEVtYWlsSHRtbChhbGVydCwgY3VycmVudFByaWNlKSxcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKFxuICAgICAgICAgICAgICAgIGBjaGVjay1hbGVydHM6IEVtYWlsIHNlbnQgdG8gJHthbGVydC5lbWFpbH0gZm9yICR7YWxlcnQuc3ltYm9sfWBcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVtYWlsRXJyKSB7XG4gICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoXG4gICAgICAgICAgICAgICAgYGNoZWNrLWFsZXJ0czogRmFpbGVkIHRvIHNlbmQgZW1haWwgZm9yICR7YWxlcnQuc3ltYm9sfTpgLFxuICAgICAgICAgICAgICAgIGVtYWlsRXJyXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIE5vdCB0cmlnZ2VyZWQsIHVwZGF0ZSBsYXN0IGNoZWNrZWQgaW5mb1xuICAgICAgICAgIGF3YWl0IGRiLmNvbGxlY3Rpb24oJ2FsZXJ0cycpLnVwZGF0ZU9uZShcbiAgICAgICAgICAgIHsgX2lkOiBhbGVydC5faWQgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgJHNldDoge1xuICAgICAgICAgICAgICAgIGxhc3RDaGVja2VkQXQ6IG5ldyBEYXRlKCksXG4gICAgICAgICAgICAgICAgbGFzdENoZWNrZWRQcmljZTogY3VycmVudFByaWNlLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyhcbiAgICAgIGBjaGVjay1hbGVydHM6IERvbmUuIENoZWNrZWQgJHtjaGVja2VkQ291bnR9IGFsZXJ0cywgJHt0cmlnZ2VyZWRDb3VudH0gdHJpZ2dlcmVkLmBcbiAgICApO1xuXG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShcbiAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgbWVzc2FnZTogJ0FsZXJ0IGNoZWNrIGNvbXBsZXRlJyxcbiAgICAgICAgY2hlY2tlZDogY2hlY2tlZENvdW50LFxuICAgICAgICB0cmlnZ2VyZWQ6IHRyaWdnZXJlZENvdW50LFxuICAgICAgICBzeW1ib2xzUHJvY2Vzc2VkOiBzeW1ib2xzLmxlbmd0aCxcbiAgICAgIH0pLFxuICAgICAgeyBzdGF0dXM6IDIwMCB9XG4gICAgKTtcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc29sZS5lcnJvcignY2hlY2stYWxlcnRzOiBFcnJvcjonLCBlcnIpO1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoXG4gICAgICBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnQWxlcnQgY2hlY2sgZmFpbGVkJyB9KSxcbiAgICAgIHsgc3RhdHVzOiA1MDAgfVxuICAgICk7XG4gIH0gZmluYWxseSB7XG4gICAgaWYgKGNsaWVudCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgY2xpZW50LmNsb3NlKCk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gaWdub3JlIGNsb3NlIGVycm9yc1xuICAgICAgfVxuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgY29uc3QgY29uZmlnOiBDb25maWcgPSB7XG4gIHNjaGVkdWxlOiAnQGV2ZXJ5IDE1bScsXG59O1xuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7OztBQUNBLFNBQVMsbUJBQW1CO0FBQzVCLFNBQVMsY0FBYztBQUV2QixJQUFNLFNBQVMsSUFBSSxPQUFPLFFBQVEsSUFBSSxjQUFjO0FBRXBELElBQU0sc0JBQXNCO0FBQzVCLElBQU0sVUFBVSxRQUFRLElBQUksV0FBVztBQThCdkMsZUFBZSxRQUFRO0FBQ3JCLFFBQU0sTUFBTSxRQUFRLElBQUk7QUFDeEIsTUFBSSxDQUFDLElBQUssT0FBTSxJQUFJLE1BQU0scUJBQXFCO0FBRS9DLFFBQU0sU0FBUyxJQUFJLFlBQVksS0FBSztBQUFBLElBQ2xDLGFBQWE7QUFBQSxJQUNiLDBCQUEwQjtBQUFBLEVBQzVCLENBQUM7QUFFRCxRQUFNLE9BQU8sUUFBUTtBQUNyQixRQUFNLFNBQVMsUUFBUSxJQUFJLG1CQUFtQjtBQUM5QyxTQUFPLEVBQUUsUUFBUSxJQUFJLE9BQU8sR0FBRyxNQUFNLEVBQUU7QUFDekM7QUFFQSxlQUFlLGdCQUFnQixRQUF3QztBQUNyRSxNQUFJO0FBQ0YsVUFBTSxNQUFNLHFEQUFxRCxtQkFBbUIsTUFBTSxDQUFD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
