/* =========================================================================
   SMS REMINDER ENGINE
   Runs from GitHub Actions once a day.

   Supports:
   - Credit reminders
   - Cheque reminders
   - Overdue reminders
   - Owner daily summary
   - Shop-specific Notify.lk credentials
   - Platform Notify.lk credentials from GitHub Secrets
   ========================================================================= */

const DEFAULTS = {
  daysBefore: 2,
  overdueEvery: 3,
  ownerSummary: true,

  tplCredit:
    'Dear {customer}, reminder from {shop}: {amount} for bill {invoice} is due on {due_date}. Thank you. {shop_phone}',

  tplOverdue:
    'Dear {customer}, {amount} for bill {invoice} from {shop} was due on {due_date} ({days} days ago). Please settle it soon. {shop_phone}',

  tplCheque:
    'Dear {customer}, your cheque {cheque_no} ({bank}) for {amount} to {shop} will be deposited on {cheque_date}. Please keep funds available. {shop_phone}'
};

const MAX_OVERDUE_DAYS = 90;


/* =========================================================================
   DATE HELPERS
   ========================================================================= */

function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);

  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) -
      Date.UTC(y1, m1 - 1, d1)) / 86400000
  );
}


function todayIn(tz = 'Asia/Colombo', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}


function prettyDay(day) {
  if (!day) return '';

  const [y, m, d] = day.split('-').map(Number);

  return `${d} ${
    [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ][m - 1]
  } ${y}`;
}


function money(n, cur = 'Rs') {
  return (
    cur +
    ' ' +
    Math.round(Number(n) || 0).toLocaleString('en-US')
  );
}


/* =========================================================================
   PHONE
   ========================================================================= */

function intlPhone(p) {
  let d = String(p || '').replace(/\D/g, '');

  if (d.length === 10 && d.startsWith('0')) {
    d = '94' + d.slice(1);
  } else if (d.length === 9) {
    d = '94' + d;
  }

  return d;
}


function validLkMobile(p) {
  return /^947\d{8}$/.test(p);
}


/* =========================================================================
   TEMPLATE
   ========================================================================= */

function fill(tpl, v) {
  return String(tpl)
    .replace(
      /\{(\w+)\}/g,
      (m, k) =>
        v[k] != null
          ? String(v[k])
          : ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}


/* =========================================================================
   PLAN REMINDERS
   ========================================================================= */

function planShop({
  shop,
  cfg,
  sales,
  customers = {},
  today
}) {
  const c = {
    ...DEFAULTS,
    ...(cfg || {})
  };

  const cur =
    shop.settings?.currency || 'Rs';

  const shopPhone =
    shop.settings?.phone || '';

  const messages = [];
  const skipped = [];

  const dueSoon = [];
  const overdue = [];
  const cheques = [];


  for (const s of sales) {

    if (
      !s.open ||
      s.status === 'cancelled'
    ) {
      continue;
    }


    const phone = intlPhone(
      customers[s.customerId]?.phone ||
      s.customerPhone
    );


    let key = null;
    let tpl = null;
    let d = null;


    const vars = {
      customer:
        s.customerName || 'Customer',

      shop:
        shop.name || '',

      amount:
        money(s.due, cur),

      invoice:
        s.invoiceNo || '',

      due_date:
        prettyDay(s.dueDate),

      cheque_date:
        prettyDay(s.chequeDate),

      cheque_no:
        s.chequeNo || '',

      bank:
        s.bank || '',

      shop_phone:
        shopPhone,

      days: ''
    };


    /* CREDIT */

    if (
      s.status === 'due' &&
      s.dueDate &&
      (s.due || 0) > 0
    ) {

      d = daysBetween(
        today,
        s.dueDate
      );


      if (
        d >= 0 &&
        d <= c.daysBefore
      ) {

        key =
          `c:${s.dueDate}:${d}`;

        tpl =
          c.tplCredit;

        dueSoon.push({
          s,
          d
        });

      } else if (d < 0) {

        overdue.push({
          s,
          d
        });

        const late = -d;

        vars.days = late;


        if (
          c.overdueEvery > 0 &&
          late % c.overdueEvery === 0 &&
          late <= MAX_OVERDUE_DAYS
        ) {

          key =
            `o:${s.dueDate}:${late}`;

          tpl =
            c.tplOverdue;
        }
      }


    /* CHEQUE */

    } else if (
      s.status === 'cheque' &&
      s.chequeDate
    ) {

      d = daysBetween(
        today,
        s.chequeDate
      );


      if (
        d <= c.daysBefore
      ) {

        cheques.push({
          s,
          d
        });
      }


      if (
        (s.chequeStatus || 'Pending') === 'Pending' &&
        d >= 0 &&
        d <= c.daysBefore
      ) {

        key =
          `q:${s.chequeDate}:${d}`;

        tpl =
          c.tplCheque;
      }
    }


    if (!key) {
      continue;
    }


    if (
      (s.reminderKeys || [])
        .includes(key)
    ) {
      continue;
    }


    if (!validLkMobile(phone)) {

      skipped.push(
        `${s.invoiceNo || s.id}: no valid mobile number`
      );

      continue;
    }


    messages.push({
      saleId: s.id,
      key,
      to: phone,
      text: fill(
        tpl,
        vars
      ).slice(0, 621)
    });
  }


  /* OWNER SUMMARY */

  let ownerText = null;


  if (
    c.ownerSummary &&
    (
      dueSoon.length ||
      overdue.length ||
      cheques.length
    )
  ) {

    const L = [
      `${shop.name || 'Shop'} - ${prettyDay(today)}`
    ];


    if (dueSoon.length) {

      dueSoon.sort(
        (a, b) => a.d - b.d
      );


      L.push(
        'DUE: ' +
        dueSoon
          .map(({ s, d }) =>
            `${s.customerName} ${money(
              s.due,
              cur
            )} (${
              d === 0
                ? 'today'
                : d === 1
                ? 'tomorrow'
                : prettyDay(
                    s.dueDate
                  ).slice(0, -5)
            })`
          )
          .join('; ')
      );
    }


    if (overdue.length) {

      L.push(
        `OVERDUE: ${
          overdue.length
        } bill${
          overdue.length > 1
            ? 's'
            : ''
        } ${money(
          overdue.reduce(
            (a, x) =>
              a + (x.s.due || 0),
            0
          ),
          cur
        )}`
      );
    }


    if (cheques.length) {

      cheques.sort(
        (a, b) => a.d - b.d
      );


      L.push(
        'CHEQUES: ' +
        cheques
          .map(({ s, d }) =>
            `${s.customerName} #${
              s.chequeNo || ''
            } ${money(
              s.due,
              cur
            )} (${
              d < 0
                ? 'deposit now'
                : d === 0
                ? 'deposit today'
                : prettyDay(
                    s.chequeDate
                  ).slice(0, -5)
            })`
          )
          .join('; ')
      );
    }


    ownerText =
      L.join('\n');


    if (
      ownerText.length > 600
    ) {

      ownerText =
        ownerText.slice(0, 590) +
        '… (see app)';
    }
  }


  return {
    messages,
    ownerText,
    skipped
  };
}


/* =========================================================================
   SEND SMS
   ========================================================================= */

async function sendNotify(
  creds,
  to,
  text
) {

  const params =
    new URLSearchParams({
      user_id: creds.userId,
      api_key: creds.apiKey,
      sender_id:
        creds.senderId ||
        'NotifyDEMO',
      to,
      message: text
    });


  if (
    /[^\x00-\x7F]/.test(text)
  ) {
    params.set(
      'type',
      'unicode'
    );
  }


  const ctrl =
    new AbortController();

  const timer =
    setTimeout(
      () => ctrl.abort(),
      15000
    );


  try {

    const response =
      await fetch(
        'https://app.notify.lk/api/v1/send',
        {
          method: 'POST',
          body: params,
          signal: ctrl.signal
        }
      );


    const result =
      await response
        .json()
        .catch(() => ({}));


    return result.status === 'success'
      ? { ok: true }
      : {
          ok: false,
          error:
            JSON.stringify(
              result.errors ||
              result.message ||
              result
            ).slice(0, 300)
        };

  } catch (error) {

    return {
      ok: false,
      error:
        String(
          error.message || error
        )
    };

  } finally {

    clearTimeout(timer);
  }
}


/* =========================================================================
   MAIN REMINDER RUNNER
   ========================================================================= */

async function runReminders({
  db,
  FieldValue,
  env = {},
  dryRun = false,
  log = console.log,
  now = new Date()
}) {

  console.log(
    'Starting SMS reminder scan...'
  );


  /* Get ALL shops */

  const shopsSnap =
    await db
      .collection('shops')
      .get();


  console.log(
    `Found ${shopsSnap.size} shop documents.`
  );


  /* Check SMS enabled in either location */

  const shops =
    shopsSnap.docs.filter(
      doc => {

        const data =
          doc.data();

        const enabled =
          data.smsEnabled === true ||
          data.settings?.smsEnabled === true;


        if (!enabled) {

          log(
            `skip ${data.name || doc.id}: SMS disabled`
          );
        }


        return enabled;
      }
    );


  const summary = {
    shops: 0,
    sent: 0,
    failed: 0,
    skipped: 0
  };


  for (const shopDoc of shops) {

    const shop = {
      id: shopDoc.id,
      ...shopDoc.data()
    };


    log(
      `Checking shop: ${
        shop.name || shop.id
      }`
    );


    /* LICENSE */

    const paidUntil =
      shop.paidUntil &&
      shop.paidUntil.toMillis
        ? shop.paidUntil.toMillis()
        : 0;


    if (
      shop.status !== 'active'
    ) {

      log(
        `skip ${shop.name}: status is ${
          shop.status || 'missing'
        }`
      );

      continue;
    }


    if (
      !paidUntil
    ) {

      log(
        `skip ${shop.name}: paidUntil missing`
      );

      continue;
    }


    if (
      paidUntil < now.getTime()
    ) {

      log(
        `skip ${shop.name}: licence expired`
      );

      continue;
    }


    /* SMS CONFIG */

    const cfgSnap =
      await shopDoc.ref
        .collection('private')
        .doc('sms')
        .get();


    const cfg =
      cfgSnap.exists
        ? cfgSnap.data()
        : {};


    if (!cfgSnap.exists) {

      log(
        `skip ${shop.name}: private/sms document missing`
      );

      continue;
    }


    if (
      cfg.enabled !== true
    ) {

      log(
        `skip ${shop.name}: private/sms enabled is not true`
      );

      continue;
    }


    /* ================================================================
       SMS CREDENTIALS

       Priority:
       1. Shop-specific Notify.lk credentials
       2. Platform GitHub Secrets

       Platform credentials are allowed even when
       smsPlatform is missing/false.

       This is intentional because your current shop
       uses the platform SMS account.
       ================================================================ */

    let creds = null;


    /* SHOP ACCOUNT */

    if (
      cfg.userId &&
      cfg.apiKey
    ) {

      creds = {
        userId:
          cfg.userId,

        apiKey:
          cfg.apiKey,

        senderId:
          cfg.senderId ||
          env.NOTIFY_SENDER_ID ||
          'NotifyDEMO'
      };


      log(
        `${shop.name}: using shop SMS account`
      );
    }


    /* PLATFORM ACCOUNT */

    else if (
      env.NOTIFY_USER_ID &&
      env.NOTIFY_API_KEY
    ) {

      creds = {

        userId:
          env.NOTIFY_USER_ID,

        apiKey:
          env.NOTIFY_API_KEY,

        senderId:
          env.NOTIFY_SENDER_ID ||
          cfg.senderId ||
          'NotifyDEMO'
      };


      log(
        `${shop.name}: using platform SMS account`
      );
    }


    /* NO CREDENTIALS */

    else {

      log(
        `skip ${shop.name}: Notify.lk credentials missing`
      );

      continue;
    }


    /* SHOP READY */

    summary.shops++;


    const today =
      todayIn(
        shop.timezone ||
        'Asia/Colombo',
        now
      );


    log(
      `${shop.name}: processing date ${today}`
    );


    /* SALES */

    const salesSnap =
      await shopDoc.ref
        .collection('sales')
        .where(
          'open',
          '==',
          true
        )
        .get();


    const sales =
      salesSnap.docs.map(
        d => ({
          id: d.id,
          ...d.data()
        })
      );


    log(
      `${shop.name}: ${sales.length} open sales found`
    );


    /* CUSTOMERS */

    const custIds =
      [
        ...new Set(
          sales
            .map(
              s => s.customerId
            )
            .filter(Boolean)
        )
      ];


    const customers = {};


    for (
      let i = 0;
      i < custIds.length;
      i += 100
    ) {

      const refs =
        custIds
          .slice(
            i,
            i + 100
          )
          .map(
            id =>
              shopDoc.ref
                .collection(
                  'customers'
                )
                .doc(id)
          );


      const docs =
        await db.getAll(
          ...refs
        );


      docs.forEach(
        d => {

          if (d.exists) {

            customers[d.id] =
              d.data();
          }
        }
      );
    }


    /* CREATE PLAN */

    const plan =
      planShop({
        shop,
        cfg,
        sales,
        customers,
        today
      });


    summary.skipped +=
      plan.skipped.length;


    log(
      `${shop.name}: ${
        plan.messages.length
      } customer SMS planned`
    );


    if (
      plan.skipped.length
    ) {

      plan.skipped.forEach(
        x =>
          log(
            `${shop.name}: skipped ${x}`
          )
      );
    }


    let sent = 0;
    let failed = 0;


    /* CUSTOMER SMS */

    for (
      const m of plan.messages
    ) {

      const result =
        dryRun
          ? { ok: true }
          : await sendNotify(
              creds,
              m.to,
              m.text
            );


      log(
        `${
          dryRun
            ? '[DRY RUN] '
            : ''
        }${shop.name} → ${
          m.to
        }: ${
          result.ok
            ? 'OK'
            : 'FAIL ' +
              result.error
        }`
      );


      if (result.ok) {

        sent++;

      } else {

        failed++;
      }


      if (!dryRun) {

        const batch =
          db.batch();


        if (result.ok) {

          batch.update(
            shopDoc.ref
              .collection('sales')
              .doc(m.saleId),
            {
              reminderKeys:
                FieldValue.arrayUnion(
                  m.key
                ),

              lastReminder: {
                day: today,
                text: m.text
              }
            }
          );
        }


        batch.set(
          shopDoc.ref
            .collection('smsLog')
            .doc(),
          {
            day: today,
            ts: Date.now(),
            to: m.to,
            text: m.text,
            ok: result.ok,
            error:
              result.error ||
              null,
            saleId:
              m.saleId,
            kind:
              'customer'
          }
        );


        await batch.commit();
      }
    }


    /* OWNER PHONE */

    const ownerTo =
      intlPhone(
        cfg.ownerPhone ||
        shop.settings?.phone ||
        shop.phone
      );


    /* OWNER DAILY SUMMARY */

    if (
      plan.ownerText &&
      validLkMobile(ownerTo) &&
      shop.smsOwnerDay !== today
    ) {

      const result =
        dryRun
          ? { ok: true }
          : await sendNotify(
              creds,
              ownerTo,
              plan.ownerText
            );


      log(
        `${
          dryRun
            ? '[DRY RUN] '
            : ''
        }${shop.name} owner alert → ${
          ownerTo
        }: ${
          result.ok
            ? 'OK'
            : 'FAIL ' +
              result.error
        }`
      );


      if (result.ok) {

        sent++;

      } else {

        failed++;
      }


      if (!dryRun) {

        await shopDoc.ref
          .collection('smsLog')
          .doc()
          .set({
            day: today,
            ts: Date.now(),
            to: ownerTo,
            text: plan.ownerText,
            ok: result.ok,
            error:
              result.error ||
              null,
            kind:
              'owner'
          });


        if (result.ok) {

          await shopDoc.ref.update({
            smsOwnerDay: today
          });
        }
      }
    }


    /* SAVE RESULT */

    if (!dryRun) {

      await shopDoc.ref.update({

        smsLastRun:
          FieldValue.serverTimestamp(),

        smsLastResult:
          `${sent} sent${
            failed
              ? ', ' +
                failed +
                ' failed'
              : ''
          }${
            plan.skipped.length
              ? ', ' +
                plan.skipped.length +
                ' without mobile no.'
              : ''
          }`
      });
    }


    summary.sent += sent;
    summary.failed += failed;
  }


  log(
    `Done: ${
      summary.shops
    } shops, ${
      summary.sent
    } sent, ${
      summary.failed
    } failed, ${
      summary.skipped
    } skipped`
  );


  return summary;
}


/* =========================================================================
   EXPORTS
   ========================================================================= */

module.exports = {
  planShop,
  runReminders,
  sendNotify,
  todayIn,
  daysBetween,
  intlPhone,
  fill,
  DEFAULTS
};
