const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { runReminders } = require('./reminders');

async function main() {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!sa) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT secret is missing.'
    );
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(sa);
  } catch (error) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not valid JSON.'
    );
  }

  initializeApp({
    credential: cert(serviceAccount)
  });

  const db = getFirestore();

  console.log('====================================');
  console.log('Daily SMS Reminder Job');
  console.log('Time:', new Date().toISOString());
  console.log('====================================');

  console.log('NOTIFY_USER_ID:', process.env.NOTIFY_USER_ID ? 'SET' : 'MISSING');
  console.log('NOTIFY_API_KEY:', process.env.NOTIFY_API_KEY ? 'SET' : 'MISSING');
  console.log('NOTIFY_SENDER_ID:', process.env.NOTIFY_SENDER_ID || 'DEFAULT');

  await runReminders({
    db,
    FieldValue,

    // DRY_RUN=1 can be used for testing
    dryRun: process.env.DRY_RUN === '1',

    env: {
      NOTIFY_USER_ID: process.env.NOTIFY_USER_ID || '',
      NOTIFY_API_KEY: process.env.NOTIFY_API_KEY || '',
      NOTIFY_SENDER_ID:
        process.env.NOTIFY_SENDER_ID || 'NotifyDEMO'
    }
  });

  console.log('====================================');
  console.log('Reminder job completed.');
  console.log('====================================');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Reminder job FAILED:');
    console.error(error);
    process.exit(1);
  });
