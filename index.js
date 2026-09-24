/* Option A — Firebase Cloud Functions (needs the Blaze pay-as-you-go plan; one run a day
   stays inside the free allowance, so the cost is normally Rs 0).
   Deploy:  firebase deploy --only functions
   Platform SMS account (optional):  firebase functions:secrets:set NOTIFY_API_KEY  etc. */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineString, defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { runReminders } = require('./reminders');

initializeApp();
const NOTIFY_USER_ID = defineString('NOTIFY_USER_ID', { default: '' });
const NOTIFY_SENDER_ID = defineString('NOTIFY_SENDER_ID', { default: 'NotifyDEMO' });
const NOTIFY_API_KEY = defineSecret('NOTIFY_API_KEY');

exports.dailyReminders = onSchedule(
  { schedule: 'every day 09:00', timeZone: 'Asia/Colombo', region: 'asia-south1', secrets: [NOTIFY_API_KEY], timeoutSeconds: 540, memory: '256MiB' },
  async () => {
    await runReminders({
      db: getFirestore(), FieldValue,
      env: { NOTIFY_USER_ID: NOTIFY_USER_ID.value(), NOTIFY_API_KEY: NOTIFY_API_KEY.value(), NOTIFY_SENDER_ID: NOTIFY_SENDER_ID.value() }
    });
  }
);
