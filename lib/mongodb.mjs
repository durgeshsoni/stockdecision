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

  const client = new MongoClient(uri, {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();

  const dbName = process.env.MONGODB_DB_NAME || 'stock_analyzer';
  const db = client.db(dbName);

  cachedClient = client;
  cachedDb = db;

  return db;
}
