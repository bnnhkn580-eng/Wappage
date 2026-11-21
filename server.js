require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const admin = require('firebase-admin');

const app = express();
app.use(cors());

// ============================================================================
// 1. DUAL FIREBASE INITIALIZATION (PEHLI + DOOSRI FIREBASE API DONO)
// ============================================================================
let dbPrimary = null;
let dbSecondary = null;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  const primaryAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const primaryApp = admin.initializeApp(
    {
      credential: admin.credential.cert(primaryAccount),
      databaseURL: process.env.FIREBASE_PRIMARY_DB_URL || undefined
    },
    'primaryApp'
  );
  dbPrimary = primaryApp.firestore();
}

if (process.env.FIREBASE_SECONDARY_SERVICE_ACCOUNT) {
  const secondaryAccount = JSON.parse(process.env.FIREBASE_SECONDARY_SERVICE_ACCOUNT);
  const secondaryApp = admin.initializeApp(
    {
      credential: admin.credential.cert(secondaryAccount),
      databaseURL: process.env.FIREBASE_SECONDARY_DB_URL || undefined
    },
    'secondaryApp'
  );
  dbSecondary = secondaryApp.firestore();
}

// Active DB selector: agar dbPrimary hai to wo, warna dbSecondary
const getDb = (target = 'primary') => {
  if (target === 'secondary' && dbSecondary) return dbSecondary;
  return dbPrimary || dbSecondary;
};

// Dono DBs (agar dono configured hain) mein sync write helper
async function writeBothDbs(fn) {
  const dbs = [dbPrimary, dbSecondary].filter(Boolean);
  if (!dbs.length) throw new Error('Koi Firebase DB configured nahi hai');
  for (const database of dbs) {
    await fn(database);
  }
}

const requireAdmin = (req, res, next) => {
  const secret = process.env.ADMIN_SECRET;
  const provided = req.headers['x-admin-secret'] || req.body?.adminKey;
  if (!secret || provided !== secret) {
    return res.status(403).json({ success: false, message: 'Unauthorized admin key' });
  }
  next();
};

// ============================================================================
// 2. AUTOMATIC RECHARGE API (WITHOUT ADMIN APPROVAL)
// ============================================================================

// User ke liye Recharge Order / Payment Link create karein
app.post('/api/recharge/create', express.json(), async (req, res) => {
  try {
    const { userId, amount, channel = 'UPI' } = req.body;
    const amt = Number(amount);
    if (!userId || !amt || amt <= 0) {
      return res.status(400).json({ success: false, message: 'userId aur valid amount zaroori hai' });
    }

    const orderId = 'RC_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000);

    // Agar Razorpay keys set hain to real order banayein, warna direct test order return karein
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Math.round(amt * 100),
          currency: 'INR',
          receipt: orderId,
          notes: { userId: String(userId), orderId, channel }
        })
      });
      const rzpData = await rzpRes.json();
      if (!rzpRes.ok) {
        return res.status(400).json({ success: false, message: rzpData.error?.description || 'Order failed' });
      }
      return res.json({ success: true, orderId, gatewayOrder: rzpData });
    }

    return res.json({
      success: true,
      orderId,
      userId: String(userId),
      amount: amt,
      channel,
      webhookUrl: '/api/recharge/webhook'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Automatic Recharge Webhook (Payment Gateway hit karega -> Bina admin approval balance +)
app.post('/api/recharge/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const secret = process.env.WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    if (secret && signature) {
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      if (signature !== expected) {
        return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
      }
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    let userId = null;
    let amount = 0;
    let txId = 'TX_' + Date.now();

    if (payload.event === 'payment.captured' && payload.payload?.payment?.entity) {
      const p = payload.payload.payment.entity;
      txId = p.id || txId;
      amount = Number(p.amount || 0) / 100;
      userId = p.notes?.userId || null;
    } else if (payload.userId && payload.amount) {
      // Direct gateway / testing payload support
      userId = String(payload.userId);
      amount = Number(payload.amount);
      txId = payload.txId || txId;
    }

    if (!userId || amount <= 0) {
      return res.status(200).json({ success: true, ignored: true });
    }

    await writeBothDbs(async (database) => {
      const txRef = database.collection('recharges').doc(String(txId));
      const userRef = database.collection('users').doc(String(userId));
      const billRef = database.collection('bills').doc();

      await database.runTransaction(async (t) => {
        const existingTx = await t.get(txRef);
        if (existingTx.exists) return;

        const userSnap = await t.get(userRef);
        const prevCharged = userSnap.exists ? Number(userSnap.data().chargedBalance || 0) : 0;

        t.set(
          userRef,
          {
            userId: String(userId),
            chargedBalance: prevCharged + amount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );

        t.set(txRef, {
          txId: String(txId),
          userId: String(userId),
          amount,
          status: 'Success',
          autoApproved: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        t.set(billRef, {
          userId: String(userId),
          type: 'Recharge',
          amount: `+₹${amount.toFixed(2)}`,
          status: 'Success',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    });

    return res.status(200).json({ success: true, userId: String(userId), credited: amount, status: 'Success' });
  } catch (err) {
    console.error('Recharge Webhook Error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.use(express.json());

// ============================================================================
// 3. AUTOMATIC WITHDRAWAL API (UPI PAYOUT + ADMIN APPROVE + SUCCESS STATUS)
// ============================================================================

async function executeUpiPayout({ amount, upiId, holderName, referenceId }) {
  // Agar Payout API keys set hain to real UPI payout bhejein
  if (process.env.RAZORPAYX_KEY_ID && process.env.RAZORPAYX_KEY_SECRET && process.env.RAZORPAYX_ACCOUNT_NUMBER) {
    const auth = Buffer.from(`${process.env.RAZORPAYX_KEY_ID}:${process.env.RAZORPAYX_KEY_SECRET}`).toString('base64');
    const res = await fetch('https://api.razorpay.com/v1/payouts', {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER,
        amount: Math.round(Number(amount) * 100),
        currency: 'INR',
        mode: 'UPI',
        purpose: 'payout',
        fund_account: {
          account_type: 'vpa',
          vpa: { address: upiId },
          contact: { name: holderName || 'User', type: 'customer' }
        },
        queue_if_low_balance: true,
        reference_id: referenceId
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.description || 'UPI Payout failed');
    return { payoutId: data.id, mode: 'RAZORPAYX_UPI' };
  }

  // Fallback / Sandbox UPI payout reference
  return { payoutId: 'UPI_PAYOUT_' + Date.now(), mode: 'AUTO_UPI_DISPATCH' };
}

// User Withdraw Request (UPI ID ke saath)
app.post('/api/withdraw/request', async (req, res) => {
  try {
    const { userId, amount, upiId, holderName = 'User', channel = 'UPI' } = req.body;
    const amt = Number(amount);
    if (!userId || !upiId || !amt || amt <= 0) {
      return res.status(400).json({ success: false, message: 'userId, upiId aur valid amount zaroori hai' });
    }

    const wdId = 'WD_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900);

    await writeBothDbs(async (database) => {
      const userRef = database.collection('users').doc(String(userId));
      const wdRef = database.collection('withdrawals').doc(wdId);
      const billRef = database.collection('bills').doc();

      await database.runTransaction(async (t) => {
        const userSnap = await t.get(userRef);
        const curBal = userSnap.exists ? Number(userSnap.data().withdrawalBalance || 0) : 0;
        if (curBal < amt) throw new Error('Insufficient withdrawal balance');

        t.set(userRef, { withdrawalBalance: curBal - amt }, { merge: true });
        t.set(wdRef, {
          id: wdId,
          userId: String(userId),
          amount: amt,
          upiId: String(upiId).trim(),
          holderName,
          channel,
          status: 'Pending',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        t.set(billRef, {
          userId: String(userId),
          type: 'Withdrawal',
          amount: `-₹${amt.toFixed(2)}`,
          status: 'Pending',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    });

    return res.json({ success: true, withdrawalId: wdId, status: 'Pending' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Direct Automatic User UPI Withdrawal API (Instant UPI Payout + Status Success)
app.post('/api/withdraw/auto-upi', async (req, res) => {
  try {
    const { userId, amount, upiId, holderName = 'User' } = req.body;
    const amt = Number(amount);
    if (!userId || !upiId || !amt || amt <= 0) {
      return res.status(400).json({ success: false, message: 'userId, upiId aur valid amount zaroori hai' });
    }

    const wdId = 'WD_AUTO_' + Date.now();
    const payout = await executeUpiPayout({
      amount: amt,
      upiId: String(upiId).trim(),
      holderName,
      referenceId: wdId
    });

    await writeBothDbs(async (database) => {
      const userRef = database.collection('users').doc(String(userId));
      const wdRef = database.collection('withdrawals').doc(wdId);
      const billRef = database.collection('bills').doc();

      await database.runTransaction(async (t) => {
        const userSnap = await t.get(userRef);
        const curBal = userSnap.exists ? Number(userSnap.data().withdrawalBalance || 0) : 0;
        if (curBal < amt) throw new Error('Insufficient withdrawal balance');

        t.set(userRef, { withdrawalBalance: curBal - amt }, { merge: true });
        t.set(wdRef, {
          id: wdId,
          userId: String(userId),
          amount: amt,
          upiId: String(upiId).trim(),
          holderName,
          channel: 'Auto UPI',
          status: 'Success',
          payoutId: payout.payoutId,
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        t.set(billRef, {
          userId: String(userId),
          type: 'Withdrawal',
          amount: `-₹${amt.toFixed(2)}`,
          status: 'Success',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    });

    return res.json({ success: true, withdrawalId: wdId, status: 'Success', payout });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Admin Withdraw Approve -> User UPI Payout + Status "Success" (User History mein Success dikhega)
app.post('/api/admin/withdraw/approve', requireAdmin, async (req, res) => {
  try {
    const { withdrawalId } = req.body;
    if (!withdrawalId) return res.status(400).json({ success: false, message: 'withdrawalId zaroori hai' });

    const db = getDb();
    const wdSnap = await db.collection('withdrawals').doc(String(withdrawalId)).get();
    if (!wdSnap.exists) return res.status(404).json({ success: false, message: 'Withdrawal nahi mila' });

    const wd = wdSnap.data();
    const payout = await executeUpiPayout({
      amount: wd.amount,
      upiId: wd.upiId,
      holderName: wd.holderName,
      referenceId: String(withdrawalId)
    });

    await writeBothDbs(async (database) => {
      await database.collection('withdrawals').doc(String(withdrawalId)).set(
        {
          status: 'Success',
          payoutId: payout.payoutId,
          approvedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    return res.json({ success: true, withdrawalId: String(withdrawalId), status: 'Success', payout });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin Withdraw Reject -> Balance Refund
app.post('/api/admin/withdraw/reject', requireAdmin, async (req, res) => {
  try {
    const { withdrawalId } = req.body;
    if (!withdrawalId) return res.status(400).json({ success: false, message: 'withdrawalId zaroori hai' });

    await writeBothDbs(async (database) => {
      const wdRef = database.collection('withdrawals').doc(String(withdrawalId));
      await database.runTransaction(async (t) => {
        const wdSnap = await t.get(wdRef);
        if (!wdSnap.exists) throw new Error('Withdrawal nahi mila');
        const wd = wdSnap.data();
        if (wd.status === 'Rejected') return;

        const userRef = database.collection('users').doc(String(wd.userId));
        const userSnap = await t.get(userRef);
        const curBal = userSnap.exists ? Number(userSnap.data().withdrawalBalance || 0) : 0;

        if (wd.status === 'Pending') {
          t.set(userRef, { withdrawalBalance: curBal + Number(wd.amount || 0) }, { merge: true });
        }
        t.set(wdRef, { status: 'Rejected', rejectedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
    });

    return res.json({ success: true, withdrawalId: String(withdrawalId), status: 'Rejected' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 4. ALL USER & ADMIN APP FEATURE APIS
// ============================================================================

// User Dashboard, Balances, Withdrawal History & Bills
app.get('/api/user/:userId', async (req, res) => {
  try {
    const userId = String(req.params.userId);
    const db = getDb();

    const userDoc = await db.collection('users').doc(userId).get();
    const user = userDoc.exists
      ? { id: userId, ...userDoc.data() }
      : { id: userId, nickname: 'User', chargedBalance: 0, withdrawalBalance: 0, revenue: 0, vipLevel: 0 };

    const wdSnap = await db.collection('withdrawals').where('userId', '==', userId).limit(50).get();
    const withdrawals = wdSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const billSnap = await db.collection('bills').where('userId', '==', userId).limit(50).get();
    const bills = billSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    res.json({ success: true, user, withdrawals, bills });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update User Profile / Nickname
app.post('/api/user/profile', async (req, res) => {
  try {
    const { userId, nickname, upiId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId zaroori hai' });

    await writeBothDbs(async (database) => {
      await database.collection('users').doc(String(userId)).set(
        {
          ...(nickname ? { nickname } : {}),
          ...(upiId ? { savedUpiId: String(upiId).trim() } : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    res.json({ success: true, message: 'Profile updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Products List & Buy Product / Invest
app.get('/api/products', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('products').get();
    const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/products/buy', async (req, res) => {
  try {
    const { userId, productId, productName, price, dailyEarnings, durationDays = 45, shares = 1 } = req.body;
    const totalCost = Number(price || 0) * Number(shares || 1);
    if (!userId || totalCost <= 0) {
      return res.status(400).json({ success: false, message: 'userId aur valid price zaroori hai' });
    }

    const orderId = 'ORD_' + Date.now();

    await writeBothDbs(async (database) => {
      const userRef = database.collection('users').doc(String(userId));
      const orderRef = database.collection('orders').doc(orderId);
      const billRef = database.collection('bills').doc();

      await database.runTransaction(async (t) => {
        const userSnap = await t.get(userRef);
        const charged = userSnap.exists ? Number(userSnap.data().chargedBalance || 0) : 0;
        if (charged < totalCost) throw new Error('Charged balance kam hai');

        t.set(userRef, { chargedBalance: charged - totalCost }, { merge: true });
        t.set(orderRef, {
          id: orderId,
          userId: String(userId),
          productId: productId || '',
          name: productName || 'Investment Plan',
          shares: Number(shares),
          price: totalCost,
          dailyEarnings: Number(dailyEarnings || 0),
          durationDays: Number(durationDays),
          status: 'In progress',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        t.set(billRef, {
          userId: String(userId),
          type: 'Buy Product',
          amount: `-₹${totalCost.toFixed(2)}`,
          status: 'Success',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    });

    res.json({ success: true, orderId, status: 'In progress' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// User Orders
app.get('/api/orders/:userId', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('orders').where('userId', '==', String(req.params.userId)).get();
    res.json({ success: true, orders: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Daily Check-in
app.post('/api/checkin', async (req, res) => {
  try {
    const { userId, bonus = 14 } = req.body;
    const reward = Number(bonus || 14);
    if (!userId) return res.status(400).json({ success: false, message: 'userId zaroori hai' });

    await writeBothDbs(async (database) => {
      const userRef = database.collection('users').doc(String(userId));
      const billRef = database.collection('bills').doc();
      await database.runTransaction(async (t) => {
        const snap = await t.get(userRef);
        const wBal = snap.exists ? Number(snap.data().withdrawalBalance || 0) : 0;
        t.set(userRef, { withdrawalBalance: wBal + reward, lastCheckin: new Date().toISOString() }, { merge: true });
        t.set(billRef, {
          userId: String(userId),
          type: 'Other',
          amount: `+₹${reward.toFixed(2)}`,
          status: 'Success',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    });

    res.json({ success: true, credited: reward });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Lucky Wheel Spin Reward
app.post('/api/lucky/spin', async (req, res) => {
  try {
    const { userId, prizeAmount = 0, prizeLabel = 'Spin' } = req.body;
    const amt = Number(prizeAmount || 0);
    if (!userId) return res.status(400).json({ success: false, message: 'userId zaroori hai' });

    await writeBothDbs(async (database) => {
      const userRef = database.collection('users').doc(String(userId));
      const winRef = database.collection('lucky_wins').doc();
      await database.runTransaction(async (t) => {
        const snap = await t.get(userRef);
        const wBal = snap.exists ? Number(snap.data().withdrawalBalance || 0) : 0;
        if (amt > 0) {
          t.set(userRef, { withdrawalBalance: wBal + amt }, { merge: true });
        }
        t.set(winRef, {
          userId: String(userId),
          prizeLabel,
          amount: amt,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    });

    res.json({ success: true, prizeLabel, credited: amt });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Custom Pages (All Custom Pages List & Create/Delete)
app.get('/api/custom-pages', async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('custom_pages').get();
    res.json({ success: true, pages: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/custom-pages', requireAdmin, async (req, res) => {
  try {
    const { title, subtitle = '', content = '' } = req.body;
    if (!title) return res.status(400).json({ success: false, message: 'title zaroori hai' });
    const pageId = 'PAGE_' + Date.now();
    await writeBothDbs(async (database) => {
      await database.collection('custom_pages').doc(pageId).set({
        id: pageId,
        title,
        subtitle,
        content,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    res.json({ success: true, pageId, title });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/admin/custom-pages/:pageId', requireAdmin, async (req, res) => {
  try {
    const { pageId } = req.params;
    await writeBothDbs(async (database) => {
      await database.collection('custom_pages').doc(String(pageId)).delete();
    });
    res.json({ success: true, deletedId: pageId });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Config / Full Banner / Telegram Link
app.get('/api/config', async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('app_config').doc('main').get();
    res.json({
      success: true,
      config: doc.exists
        ? doc.data()
        : {
            telegramLink: 'https://t.me/GrowthWaveCapital',
            bannerTag: 'Heavy Industries Fund',
            bannerTitle: 'Smart Maritime & Energy Infrastructure',
            bannerSubtitle: 'Earn stable daily dividends backed by global industrial assets.',
            bannerImage: ''
          }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/admin/config', requireAdmin, async (req, res) => {
  try {
    await writeBothDbs(async (database) => {
      await database.collection('app_config').doc('main').set(
        {
          ...req.body,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });
    res.json({ success: true, message: 'Config updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Customer Service Tickets
app.post('/api/service/ticket', async (req, res) => {
  try {
    const { userId, subject = '', message = '', utr = '' } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'message zaroori hai' });
    const ticketId = 'TKT_' + Date.now();
    await writeBothDbs(async (database) => {
      await database.collection('support_tickets').doc(ticketId).set({
        id: ticketId,
        userId: String(userId || 'guest'),
        subject,
        message,
        utr,
        status: 'Open',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    res.json({ success: true, ticketId, status: 'Open' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin: Get All Withdrawals & Tickets
app.get('/api/admin/withdrawals', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('withdrawals').limit(100).get();
    res.json({ success: true, withdrawals: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/admin/tickets', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('support_tickets').limit(100).get();
    res.json({ success: true, tickets: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Complete API Server running on port ${PORT}`);
});
