/* Option B — FREE, no Blaze plan needed: run the same reminders from GitHub Actions
   (see .github/workflows/reminders.yml) or from any computer:
     FIREBASE_SERVICE_ACCOUNT='<json>' node run-once.js            (sends SMS)
     FIREBASE_SERVICE_ACCOUNT='<json>' DRY_RUN=1 node run-once.js  (only prints what it would send) */
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { runReminders } = require('./reminders');

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) { console.error('Set FIREBASE_SERVICE_ACCOUNT to the service-account JSON (Firebase console → Project settings → Service accounts → Generate new private key).'); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(sa)) });
runReminders({
  db: getFirestore(), FieldValue, dryRun: !!process.env.DRY_RUN,
  env: { NOTIFY_USER_ID: process.env.NOTIFY_USER_ID || '', NOTIFY_API_KEY: process.env.NOTIFY_API_KEY || '', NOTIFY_SENDER_ID: process.env.NOTIFY_SENDER_ID || 'NotifyDEMO' }
}).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
