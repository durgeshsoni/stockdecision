import type { Config } from '@netlify/functions';
import { MongoClient } from 'mongodb';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const MAX_SYMBOLS_PER_RUN = 20;
const APP_URL = process.env.APP_URL || 'https://stock-analyzer.netlify.app';

interface Alert {
  _id: any;
  uid: string;
  email: string;
  symbol: string;
  name: string;
  targetPrice: number;
  condition: 'above' | 'below';
  currency: string;
  status: string;
  createdAt: Date;
  lastCheckedAt: Date | null;
  lastCheckedPrice: number | null;
}

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number;
        currency: string;
        symbol: string;
      };
    }>;
    error: any;
  };
}

async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI not set');

  const client = new MongoClient(uri, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  const dbName = process.env.MONGODB_DB_NAME || 'stock_analyzer';
  return { client, db: client.db(dbName) };
}

async function fetchStockPrice(symbol: string): Promise<number | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StockAlertBot/1.0)',
      },
    });

    if (!response.ok) return null;

    const data: YahooChartResponse = await response.json();

    if (data.chart.error || !data.chart.result?.length) return null;

    return data.chart.result[0].meta.regularMarketPrice;
  } catch {
    return null;
  }
}

function isAlertTriggered(
  currentPrice: number,
  targetPrice: number,
  condition: 'above' | 'below'
): boolean {
  if (condition === 'above') return currentPrice >= targetPrice;
  if (condition === 'below') return currentPrice <= targetPrice;
  return false;
}

function buildEmailHtml(alert: Alert, currentPrice: number): string {
  const conditionText =
    alert.condition === 'above' ? 'risen above' : 'fallen below';
  const currencySymbol =
    alert.currency === 'INR' ? '₹' : alert.currency === 'EUR' ? '€' : '$';

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

export default async function handler() {
  console.log('check-alerts: Starting scheduled alert check');

  let client;
  try {
    const connection = await getDb();
    client = connection.client;
    const db = connection.db;

    // Get all active alerts
    const activeAlerts = await db
      .collection<Alert>('alerts')
      .find({ status: 'active' })
      .toArray();

    if (activeAlerts.length === 0) {
      console.log('check-alerts: No active alerts found');
      return new Response(JSON.stringify({ message: 'No active alerts' }), {
        status: 200,
      });
    }

    // Group alerts by symbol
    const alertsBySymbol = new Map<string, Alert[]>();
    for (const alert of activeAlerts) {
      const existing = alertsBySymbol.get(alert.symbol) || [];
      existing.push(alert);
      alertsBySymbol.set(alert.symbol, existing);
    }

    // Limit to MAX_SYMBOLS_PER_RUN unique symbols
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
          // Alert triggered
          triggeredCount++;
          const now = new Date();

          // Update alert status
          await db.collection('alerts').updateOne(
            { _id: alert._id },
            {
              $set: {
                status: 'triggered',
                triggeredAt: now,
                triggeredPrice: currentPrice,
                lastCheckedAt: now,
                lastCheckedPrice: currentPrice,
                updatedAt: now,
              },
            }
          );

          // Insert into alert history
          await db.collection('alert_history').insertOne({
            uid: alert.uid,
            alertId: alert._id,
            symbol: alert.symbol,
            name: alert.name,
            targetPrice: alert.targetPrice,
            triggeredPrice: currentPrice,
            condition: alert.condition,
            currency: alert.currency,
            triggeredAt: now,
          });

          // Send email notification
          if (alert.email) {
            try {
              await resend.emails.send({
                from:
                  process.env.RESEND_FROM_EMAIL ||
                  'Stock Analyzer <alerts@stock-analyzer.com>',
                to: alert.email,
                subject: `Price Alert: ${alert.name} (${alert.symbol}) has ${alert.condition === 'above' ? 'risen above' : 'fallen below'} your target`,
                html: buildEmailHtml(alert, currentPrice),
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
          // Not triggered, update last checked info
          await db.collection('alerts').updateOne(
            { _id: alert._id },
            {
              $set: {
                lastCheckedAt: new Date(),
                lastCheckedPrice: currentPrice,
              },
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
        message: 'Alert check complete',
        checked: checkedCount,
        triggered: triggeredCount,
        symbolsProcessed: symbols.length,
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error('check-alerts: Error:', err);
    return new Response(
      JSON.stringify({ error: 'Alert check failed' }),
      { status: 500 }
    );
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        // ignore close errors
      }
    }
  }
}

export const config: Config = {
  schedule: '@every 15m',
};
