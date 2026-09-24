# Mobile Distributor Pro — Cloud Edition (v2)

Stock by IMEI, billing, customers, credit and cheque reminders for mobile phone shops and distributors.
All data is kept in the cloud (Google Firebase), so it works on many phones and PCs at once. Each shop only ever sees its own data.

---

## What's in this folder

| File / folder | What it is |
|---|---|
| `public/` | The app itself. This is what gets uploaded to the web. |
| `public/js/config.js` | **The only file you edit.** You paste your Firebase settings into it. |
| `public/admin.html` | Your private admin page, used to manage the shops you sell to (licences, suspend, SMS). |
| `firestore.rules` | Security rules that keep each shop's data private. |
| `functions/` | The daily SMS reminder service. |
| `.github/workflows/reminders.yml` | Runs the SMS reminders for free with GitHub (option B below). |
| `firebase.json` | Settings for the Firebase deploy command. |

---

## 1. Try it first (no setup)

After you deploy (step 2), open the app and tap **"Try the demo"**. It loads a sample shop with phones, customers, dues and cheques, so you can test everything, including the scanner. Demo data stays in that browser only.

> Opening `index.html` by double-clicking will not work, because browsers block it. To try it on your PC before deploying, run `npx serve public` in this folder and open the address it shows.

---

## 2. One-time setup (about 20 minutes)

### 2.1 Create the Firebase project
1. Go to **console.firebase.google.com**, click **Add project**, and give it a name (e.g. `mobile-distributor-pro`). Google Analytics is not needed.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
3. **Build → Firestore Database → Create database.** Choose location **asia-south1 (Mumbai)**, which is closest to Sri Lanka. Start in **production mode**.
4. **Project settings (⚙) → Your apps → Web (`</>`)**, register the app, then copy the `firebaseConfig` values.
5. Paste those values into `public/js/config.js`.
6. In the same file:
   - Set `SUPPORT_PHONE` to your number.
   - Set `ALLOW_SIGNUP` to `true` if shops should register themselves with a free trial, or `false` if only you create shops.

### 2.2 Deploy (upload the app and the security rules)
On your PC, install Node.js from nodejs.org, then run this in a terminal inside this folder:
```
npm install -g firebase-tools
firebase login
firebase use --add            (pick your project)
firebase deploy --only hosting,firestore
```
Your app is now live at `https://<your-project>.web.app`. Send this link to shops. On a phone they open it and use **Add to Home Screen**, and it works like a normal app.

> **Always deploy `firestore.rules`.** Without the rules, shops are not separated from each other.

### 2.3 Make yourself the admin
1. Firebase console → **Authentication → Users → Add user**, and enter your email and password. Copy the **User UID**.
2. **Firestore → Start collection** named `admins`. Set the Document ID to your UID and add any field (e.g. `name` = `Buddhi`).
3. Open `https://<your-project>.web.app/admin.html` and sign in.

---

## 3. Selling to shops

**Option 1 — Shops register themselves** (`ALLOW_SIGNUP = true`)
The shop taps *Register a new shop* and gets a 14-day trial. When they pay, you open **admin.html** and press **+1 month** or **+1 year**.

**Option 2 — You create each shop** (`ALLOW_SIGNUP = false`)
In admin.html, press **+ New shop**, enter the owner's email and a temporary password, and choose the months paid. Then give the owner their login.

When a licence ends, the shop's app becomes **read-only**: they can still see and export their data, but they can't sell until you renew. **Suspend** does the same immediately.

### Staff logins
Owners add staff in **Settings → Staff logins**. Staff:
- **can** sell, receive payments and add customers
- **can't** see cost price or profit, delete records, see expenses or change settings

Every bill shows who made it. A blocked staff login can't save anything from that moment, and is signed out the next time the app opens.

---

## 4. Automatic SMS reminders (Notify.lk)

**What gets sent** every morning at 9:00 (Sri Lanka time):
- **Credit customers:** SMS 2 days before the due date, 1 day before, and on the due date. After that, every 3 days while overdue (changeable, max 90 days).
- **Cheque customers:** SMS 2 days before the cheque date and on the day: *"please keep funds available"*.
- **Shop owner:** one daily alert listing who is due, the overdue total, and which cheques to deposit.
- A customer never gets the same reminder twice. Sinhala and Tamil wording works.

**Shop side:** the owner opens **Settings → Automatic SMS reminders**, switches it on, and enters their Notify.lk User ID, API key and Sender ID. **"Send test SMS"** checks the account. `NotifyDEMO` works for testing; ask Notify.lk to approve your own sender name for real use.

**Your side:** the reminder service must run once a day. Pick one option.

### Option A — Firebase Cloud Functions (simplest to run)
Needs the **Blaze** plan (pay-as-you-go, card required). One run a day stays inside the free allowance, so the cost is normally zero.
```
cd functions && npm install && cd ..
firebase deploy --only functions
```
If you choose Blaze, set a budget alert in the Google Cloud console.

### Option B — GitHub Actions (free, no card)
1. Put this folder in a GitHub repository (it can be private).
2. Firebase console → Project settings → **Service accounts → Generate new private key**. This downloads a JSON file.
3. GitHub repo → **Settings → Secrets and variables → Actions → New secret**. Name it `FIREBASE_SERVICE_ACCOUNT` and paste the whole JSON file.
4. Done. It runs daily at 9:00, and **Actions → Daily SMS reminders → Run workflow** starts a manual run.

**Test without sending:** `cd functions && FIREBASE_SERVICE_ACCOUNT='<json>' DRY_RUN=1 node run-once.js` prints what would be sent.

**Reselling SMS (optional):** if shops should use *your* Notify.lk account, add `NOTIFY_USER_ID`, `NOTIFY_API_KEY` and `NOTIFY_SENDER_ID` as secrets (option B) or function settings (option A). Then press **Platform SMS on** for that shop in admin.html.

**Free manual reminders** always work, even with auto-SMS off: the 💬 **Remind** button on any due or cheque opens WhatsApp or SMS on the phone with the message ready.

---

## 5. Everyday use

| Task | How |
|---|---|
| **Add stock** | Stock → **+ Add phones**. Enter the model and prices once, then **Scan IMEIs** and scan box after box. With Dual SIM ticked, scan IMEI 1 and then IMEI 2 of each box; if both barcodes are in view at once, it reads both together. |
| **Sell** | Sell → **Scan IMEI**. The exact phone goes into the bill. If that IMEI was already sold, it shows the invoice and customer. Scanner guns work in the search box. |
| **Credit sale** | Choose **Credit**, pick the due date (1 week / 2 weeks / 1 month), and enter any advance paid. |
| **Cheque sale** | Choose **Cheque** and enter the cheque number, bank and date. In Dues → Cheques, mark it Deposited, Cleared or Returned. A returned cheque becomes a credit debt automatically. |
| **Customer page** | Customers → tap a name to see what they owe, pending cheques, every bill with IMEIs, and payments. Buttons: Call, WhatsApp, Receive payment, Remind. |
| **Receive money** | On the customer page, **Receive payment** clears their oldest bills first. On a single bill, use **Receive**. |
| **Warranty check** | Stock → **IMEI lookup** → scan. Shows when the phone was sold, to whom, the invoice and the warranty. |
| **Mistake on a bill** | Open the invoice → **Cancel bill** (owner only). Phones go back into stock and the customer's balance is reversed. |

**Scanning tips:**
- Hold the phone 10–15 cm from the label and keep it steady for a moment.
- Use 🔦 for dark labels and the zoom slider for small ones.
- On the phone itself, dial `*#06#` to show the IMEI barcode.
- Only valid IMEIs are accepted (15 digits with the correct check digit), so a misread cannot slip into stock.

---

## 6. Moving from the old offline app
1. In the **old** app: Settings → **Export Backup**. This downloads a `.json` file.
2. In the **new** app, as the owner: Settings → **Backup & import** → **Import backup / old app data** → choose that file.

Phones, IMEIs, customers, bills, credit balances, cheques, expenses and suppliers all come across. Do this once, before you start selling in the new app.

---

## 7. Security: what protects what
- **Login (email + password)** plus the **Firestore security rules** protect the data. Google's servers check every read and write, so one shop cannot see another shop's data, even with technical tricks in the browser.
- **PIN / fingerprint** is a quick lock for each device. The PIN is stored only as a scrambled hash. After 5 wrong tries, the device signs out and needs the password.
- The app locks itself after a few minutes in the background (changeable in Settings → This device).
- **Signing out** also wipes that device's offline copy of the data, which matters on shared devices.
- Notify.lk API keys are readable only by the shop owner.

**5-minute check before your first customer:** register two test shops (A and B) with different emails. Add a phone in shop A. Sign in as shop B and confirm nothing from A shows anywhere.

---

## 8. Costs and limits
- **Firebase free (Spark) plan:** 50,000 reads and 20,000 writes per day for the whole project, which is roughly **5–10 busy shops**. After that, switch to Blaze. At typical shop use it costs well under $1 per shop per month. Set a budget alert.
- **Notify.lk:** charges per SMS, paid by whoever owns the Notify.lk account (the shop, or you if you resell SMS).
- **Hosting:** free on Firebase Hosting.

---

## 9. Updating the app later
1. Change the files.
2. In `public/sw.js`, raise `VERSION` (e.g. `mdp-v2.0.1`).
3. Run `firebase deploy --only hosting`.

Phones pick up the new version the next time they open the app while online.

---

## 10. Troubleshooting
| Problem | Fix |
|---|---|
| Camera doesn't open | The app must be opened through `https://`. Allow camera permission for the site in browser settings. |
| "…was NOT saved — not allowed" | The subscription has expired or is suspended, the staff login was blocked, or the phone was already sold on another device. |
| "This login is not linked to a shop" | For staff: the owner must add them in Settings → Staff logins. For a new shop: register it. |
| Sync dot is amber or red | Offline. Keep working; everything saves on the device and uploads when the signal returns. |
| iPhone | Open in Safari → Share → Add to Home Screen. Face ID / Touch ID works as the "fingerprint" unlock. |
