import admin from 'firebase-admin';

function initFirebase() {
  if (admin.apps.length > 0) return;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyB64 = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKeyB64) {
    throw new Error('Firebase env vars missing: ' +
      (!projectId ? 'FIREBASE_PROJECT_ID ' : '') +
      (!clientEmail ? 'FIREBASE_CLIENT_EMAIL ' : '') +
      (!privateKeyB64 ? 'FIREBASE_PRIVATE_KEY ' : ''));
  }

  let privateKey;
  try {
    privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf-8');
  } catch (e) {
    // Maybe it's not base64, try raw
    privateKey = privateKeyB64.replace(/\\n/g, '\n');
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
  });
}

export async function verifyToken(req) {
  initFirebase();
  const authHeader = req.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('Missing or invalid Authorization header');

  const decoded = await admin.auth().verifyIdToken(match[1]);
  return {
    uid: decoded.uid,
    email: decoded.email || null,
    name: decoded.name || null,
    picture: decoded.picture || null,
    phone: decoded.phone_number || null,
  };
}

export async function optionalVerifyToken(req) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    if (!authHeader) return null;
    return await verifyToken(req);
  } catch {
    return null;
  }
}
