import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export type Persona = 'talent' | 'company_admin';

function ensureAdmin() {
  if (getApps().length > 0) return;

  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY!);
  initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
  });
}

function emailForPersona(persona: Persona): string {
  if (persona === 'talent') {
    const email = process.env.QA_TALENT_EMAIL;
    if (!email) throw new Error('QA_TALENT_EMAIL is not set');
    return email;
  }
  const email = process.env.QA_COMPANY_EMAIL;
  if (!email) throw new Error('QA_COMPANY_EMAIL is not set');
  return email;
}

export async function createCustomToken(persona: Persona): Promise<string> {
  ensureAdmin();
  const email = emailForPersona(persona);
  const user = await getAuth().getUserByEmail(email);
  return getAuth().createCustomToken(user.uid);
}

export async function getIdTokenForPersona(persona: Persona): Promise<string> {
  const customToken = await createCustomToken(persona);
  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  if (!apiKey) throw new Error('VITE_FIREBASE_API_KEY is not set');

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    },
  );

  const data = await res.json();
  if (data.error) {
    throw new Error(`Firebase exchange failed: ${data.error.message}`);
  }
  return data.idToken as string;
}