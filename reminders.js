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


/* ============================================================
   DATE HELPERS
   ============================================================ */

function todayIn(tz = 'Asia/Colombo', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}


function normalizeDate(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

    if (match) {
      return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
    }

    const d = new Date(value);

    if (!Number.isNaN(d.getTime())) {
      return todayIn('Asia/Colombo', d);
    }

    return null;
  }

  if (value instanceof Date) {
    if (!Number.isNaN(value.getTime())) {
      return todayIn('Asia/Colombo', value);
    }
  }

  if (typeof value.toDate === 'function') {
    return todayIn('Asia/Colombo', value.toDate());
  }

  if (typeof value.toMillis === 'function') {
    return todayIn('Asia/Colombo', new Date(value.toMillis()));
  }

  if (typeof value === 'number') {
    const d = new Date(value);

    if (!Number.isNaN(d.getTime())) {
      return todayIn('Asia/Colombo', d);
    }
  }

  return null;
}


function daysBetween(a, b) {
  const dateA = normalizeDate(a);
  const dateB = normalizeDate(b);

  if (!dateA || !dateB) return NaN;

  const [y1, m1, d1] = dateA.split('-').map(Number);
  const [y2, m2, d2] = dateB.split('-').map(Number);

  return Math.round(
    (
      Date.UTC(y2, m2 - 1, d2) -
      Date.UTC(y1, m1 - 1, d1)
    ) / 86400000
  );
}


function prettyDay(day) {
  const d = normalizeDate(day);

  if (!d) return '';

  const [y, m, dd] = d.split('-').map(Number);

  return `${dd} ${
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


/* ============================================================
   MONEY
   ============================================================ */

function money(n, cur = 'Rs') {
  return (
    cur +
    ' ' +
    Math.round(Number(n) || 0).toLocaleString('en-US')
  );
}


/* ============================================================
   PHONE
   ============================================================ */

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


/* ============================================================
   TEMPLATE
   ============================================================ */

function fill(tpl, values) {
  return String(tpl)
    .replace(/\{(\w+)\}/g, (match, key) => {
      return values[key] != null
        ? String(values[key])
        : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}


/* ============================================================
   NUMBER HELPERS
   ============================================================ */

function num(value) {
  const n = Number(value);

  return Number.isFinite(n) ? n : 0;
}


function firstPositive(...values) {
  for (const value of values) {
    const n = num(value);

    if (n > 0) {
      return n;
    }
  }

  return 0;
}


/* ============================================================
   GET OUTSTANDING AMOUNT

   Supports different sales field names.
   ============================================================ */

function getOutstandingAmount(s) {

  const direct = firstPositive(
    s.due,
    s.balanceDue,
    s.amountDue,
    s.outstanding,
    s.balance,
    s.remaining,
    s.remainingAmount,
    s.dueAmount,
    s.amountOutstanding,
    s.outstandingAmount
  );

  if (direct > 0) {
    return direct;
  }


  const total = firstPositive(
    s.total,
    s.totalAmount,
    s.grandTotal,
    s.netTotal,
    s.netAmount,
    s.amount,
    s.invoiceAmount
  );


  if (total > 0) {

    const paid = num(
      s.paid ??
      s.paidAmount ??
      s.amountPaid ??
      s.received ??
      s.receivedAmount
    );

    const balance = total - paid;

    if (balance > 0) {
      return balance;
    }
  }


  return 0;
}


/* ============================================================
   PLAN REMINDERS
   ============================================================ */

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
    shop.settings?.phone ||
    shop.phone ||
    '';


  const messages = [];
  const skipped = [];

  const dueSoon = [];
  const overdue = [];
  const cheques = [];


  for (const s of sales) {

    if (
      s.open !== true ||
      String(s.status || '').toLowerCase() === 'cancelled'
    ) {
      continue;
    }


    const customer =
      customers[s.customerId] || {};


    const phone = intlPhone(
      customer.phone ||
      s.customerPhone ||
      s.phone ||
      ''
    );


    const status =
      String(s.status || '').toLowerCase();


    const chequeStatus =
      String(
        s.chequeStatus ||
        'Pending'
      ).toLowerCase();


    const dueAmount =
      getOutstandingAmount(s);


    const isCheque =
      status === 'cheque' ||
      status === 'cheque_pending' ||
      Boolean(s.chequeDate);


    const dueDate =
      normalizeDate(s.dueDate);


    const chequeDate =
      normalizeDate(s.chequeDate);


    const vars = {

      customer:
        s.customerName ||
        customer.name ||
        'Customer',

      shop:
        shop.name || '',

      amount:
        money(dueAmount, cur),

      invoice:
        s.invoiceNo ||
        s.invoice ||
        s.billNo ||
        s.id ||
        '',

      due_date:
        prettyDay(dueDate),

      cheque_date:
        prettyDay(chequeDate),

      cheque_no:
        s.chequeNo || '',

      bank:
        s.bank || '',

      shop_phone:
        shopPhone,

      days:
        ''
    };


    let key = null;
    let tpl = null;


    /* ========================================================
       CREDIT
       ======================================================== */

    if (
      !isCheque &&
      dueDate &&
      dueAmount > 0
    ) {

      const d =
        daysBetween(
          today,
          dueDate
        );


      /* Due today / before due date */

      if (
        Number.isFinite(d) &&
        d >= 0 &&
        d <= Number(c.daysBefore)
      ) {

        key =
          `c:${dueDate}:${d}`;

        tpl =
          c.tplCredit;


        dueSoon.push({
          s,
          d,
          amount: dueAmount
        });
      }


      /* Overdue */

      else if (
        Number.isFinite(d) &&
        d < 0
      ) {

        const late =
          Math.abs(d);


        overdue.push({
          s,
          d,
          amount: dueAmount
        });


        vars.days =
          late;


        if (
          Number(c.overdueEvery) > 0 &&
          late % Number(c.overdueEvery) === 0 &&
          late <= MAX_OVERDUE_DAYS
        ) {

          key =
            `o:${dueDate}:${late}`;

          tpl =
            c.tplOverdue;
        }
      }
    }


    /* ========================================================
       CHEQUE
       ======================================================== */

    if (
      isCheque &&
      chequeDate
    ) {

      const d =
        daysBetween(
          today,
          chequeDate
        );


      if (
        Number.isFinite(d) &&
        d <= Number(c.daysBefore)
      ) {

        cheques.push({
          s,
          d,
          amount: dueAmount
        });
      }


      if (
        chequeStatus === 'pending' &&
        Number.isFinite(d) &&
        d >= 0 &&
        d <= Number(c.daysBefore)
      ) {

        key =
          `q:${chequeDate}:${d}`;

        tpl =
          c.tplCheque;
      }
    }


    if (!key || !tpl) {
      continue;
    }


    /* Already sent */

    if (
      Array.isArray(s.reminderKeys) &&
      s.reminderKeys.includes(key)
    ) {
      continue;
    }


    /* Invalid mobile */

    if (!validLkMobile(phone)) {

      skipped.push(
        `${s.invoiceNo || s.invoice || s.id || 'sale'}: no valid mobile number`
      );

      continue;
    }


    messages.push({

      saleId:
        s.id,

      key,

      to:
        phone,

      text:
        fill(
          tpl,
          vars
        ).slice(0, 621)
    });
  }


  /* ============================================================
     OWNER SUMMARY
     ============================================================ */

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
          .map(
            ({ s, d, amount }) => {

              let when;

              if (d === 0) {
                when = 'today';
              } else if (d === 1) {
                when = 'tomorrow';
              } else {
                when =
                  prettyDay(
                    s.dueDate
                  );
              }


              return `${
                s.customerName ||
                'Customer'
              } ${
                money(
                  amount,
                  cur
                )
              } (${when})`;
            }
          )
          .join('; ')
      );
    }


    if (overdue.length) {

      const overdueTotal =
        overdue.reduce(
          (total, item) =>
            total +
            Number(item.amount || 0),
          0
        );


      L.push(
        `OVERDUE: ${
          overdue.length
        } bill${
          overdue.length > 1
            ? 's'
            : ''
        } ${
          money(
            overdueTotal,
            cur
          )
        }`
      );
    }


    if (cheques.length) {

      cheques.sort(
        (a, b) => a.d - b.d
      );


      L.push(
        'CHEQUES: ' +
        cheques
          .map(
            ({
              s,
              d,
              amount
            }) => {

              let when;

              if (d < 0) {
                when = 'deposit now';
              } else if (d === 0) {
                when = 'deposit today';
              } else if (d === 1) {
                when = 'tomorrow';
              } else {
                when =
                  prettyDay(
                    s.chequeDate
                  );
              }


              return `${
                s.customerName ||
                'Customer'
              } #${
                s.chequeNo || ''
              } ${
                money(
                  amount,
                  cur
                )
              } (${when})`;
            }
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


/* ============================================================
   SEND SMS
   ============================================================ */

async function sendNotify(
  creds,
  to,
  text
) {

  const params =
    new URLSearchParams({

      user_id:
        creds.userId,

      api_key:
        creds.apiKey,

      sender_id:
        creds.senderId ||
        'NotifyDEMO',

      to,

      message:
        text
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
          error.message ||
          error
        )
    };

  } finally {

    clearTimeout(timer);
  }
}


/* ============================================================
   MAIN
   ============================================================ */

async function runReminders({
  db,
  FieldValue,
  env = {},
  dryRun = false,
  log = console.log,
  now = new Date()
}) {

  log('========================================');
  log('Starting SMS reminder scan...');
  log(`Time: ${now.toISOString()}`);
  log('========================================');


  const shopsSnap =
    await db
      .collection('shops')
      .get();


  log(
    `Found ${shopsSnap.size} shop documents.`
  );


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
            `skip ${
              data.name ||
              doc.id
            }: SMS disabled`
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


  for (
    const shopDoc of shops
  ) {

    const shop = {
      id:
        shopDoc.id,

      ...shopDoc.data()
    };


    log(
      `Checking shop: ${
        shop.name ||
        shop.id
      }`
    );


    /* ========================================================
       LICENSE
       ======================================================== */

    const paidUntil =
      shop.paidUntil &&
      typeof shop.paidUntil.toMillis === 'function'
        ? shop.paidUntil.toMillis()
        : shop.paidUntil
          ? new Date(shop.paidUntil).getTime()
          : 0;


    if (
      shop.status !== 'active'
    ) {

      log(
        `skip ${
          shop.name
        }: status is ${
          shop.status ||
          'missing'
        }`
      );

      continue;
    }


    if (!paidUntil) {

      log(
        `skip ${
          shop.name
        }: paidUntil missing`
      );

      continue;
    }


    if (
      paidUntil <
      now.getTime()
    ) {

      log(
        `skip ${
          shop.name
        }: licence expired`
      );

      continue;
    }


    /* ========================================================
       SMS CONFIG
       ======================================================== */

    const cfgSnap =
      await shopDoc.ref
        .collection('private')
        .doc('sms')
        .get();


    const cfg =
      cfgSnap.exists
        ? cfgSnap.data()
        : {};


    if (
      !cfgSnap.exists ||
      cfg.enabled !== true
    ) {

      log(
        `skip ${
          shop.name
        }: private/sms missing or disabled`
      );

      continue;
    }


    /* ========================================================
       CREDENTIALS
       ======================================================== */

    let creds = null;


    /* Shop account */

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


    /* Platform account */

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


    else {

      log(
        `skip ${
          shop.name
        }: Notify.lk credentials missing`
      );

      continue;
    }


    summary.shops++;


    /* ========================================================
       TODAY
       ======================================================== */

    const today =
      todayIn(
        shop.timezone ||
        'Asia/Colombo',
        now
      );


    log(
      `${shop.name}: processing date ${today}`
    );


    /* ========================================================
       SALES
       ======================================================== */

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
          id:
            d.id,

          ...d.data()
        })
      );


    log(
      `${shop.name}: ${sales.length} open sales found`
    );


    /* ========================================================
       CUSTOMERS
       ======================================================== */

    const custIds =
      [
        ...new Set(
          sales
            .map(
              s =>
                s.customerId
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
                .collection('customers')
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


    /* ========================================================
       PLAN
       ======================================================== */

    const plan =
      planShop({
        shop,
        cfg,
        sales,
        customers,
        today
      });


    log(
      `${shop.name}: ${
        plan.messages.length
      } customer SMS planned`
    );


    /* ========================================================
       IMPORTANT DIAGNOSTICS
       ======================================================== */

    if (
      plan.messages.length === 0
    ) {

      sales.forEach(
        s => {

          const amount =
            getOutstandingAmount(s);


          const due =
            normalizeDate(
              s.dueDate
            );


          const customer =
            customers[
              s.customerId
            ] || {};


          const phone =
            intlPhone(
              customer.phone ||
              s.customerPhone ||
              s.phone ||
              ''
            );


          log(
            `${shop.name}: NOT PLANNED | ` +
            `invoice=${s.invoiceNo || s.invoice || s.billNo || s.id} | ` +
            `due=${due || 'MISSING'} | ` +
            `amount=${amount} | ` +
            `phone=${phone || 'MISSING'} | ` +
            `customerId=${s.customerId || 'MISSING'}`
          );
        }
      );
    }


    summary.skipped +=
      plan.skipped.length;


    plan.skipped.forEach(
      x =>
        log(
          `${shop.name}: skipped ${x}`
        )
    );


    /* ========================================================
       CUSTOMER SMS
       ======================================================== */

    let sent = 0;
    let failed = 0;


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
        }${
          shop.name
        } → ${
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
                day:
                  today,

                text:
                  m.text
              }
            }
          );
        }


        batch.set(
          shopDoc.ref
            .collection('smsLog')
            .doc(),
          {
            day:
              today,

            ts:
              Date.now(),

            to:
              m.to,

            text:
              m.text,

            ok:
              result.ok,

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


    /* ========================================================
       OWNER ALERT
       ======================================================== */

    const ownerTo =
      intlPhone(
        cfg.ownerPhone ||
        shop.settings?.phone ||
        shop.phone
      );


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
        }${
          shop.name
        } owner alert → ${
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
            day:
              today,

            ts:
              Date.now(),

            to:
              ownerTo,

            text:
              plan.ownerText,

            ok:
              result.ok,

            error:
              result.error ||
              null,

            kind:
              'owner'
          });


        if (result.ok) {

          await shopDoc.ref.update({
            smsOwnerDay:
              today
          });
        }
      }
    }


    /* ========================================================
       SAVE RESULT
       ======================================================== */

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
    '========================================'
  );


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


  log(
    '========================================'
  );


  return summary;
}


/* ============================================================
   EXPORTS
   ============================================================ */

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
