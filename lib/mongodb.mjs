import { MongoClient } from 'mongodb';

let cachedClient = null;
let cachedDb = null;

export async function getDb() {
  if (cachedClient && cachedDb) {
    return cachedDb;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  // maxPoolSize: 1 is optimal for serverless (Netlify Functions) where each
  // function instance handles one request. For a long-running Express server
  // the value is overridden via MONGODB_MAX_POOL_SIZE env var (default 10).
  const maxPoolSize = process.env.NETLIFY ? 1 : parseInt(process.env.MONGODB_MAX_POOL_SIZE || '10', 10);
  const client = new MongoClient(uri, {
    maxPoolSize,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();

  const dbName = process.env.MONGODB_DB_NAME || 'stock_analyzer';
  const db = client.db(dbName);

  cachedClient = client;
  cachedDb = db;

  return db;
}
