require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const admin = require('firebase-admin');

const app = express();
app.use(cors());

let dbPrimary = null;
let dbSecondary = null;
let dbInitError = null;

function parseServiceAccount(raw) {
  if (!raw) return null;
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (parsed.private_key && typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const primaryAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
    const primaryApp = admin.initializeApp(
      { credential: admin.credential.cert(primaryAccount) },
      'primaryApp'
    );
    dbPrimary = primaryApp.firestore();
  }
} catch (err) {
  dbInitError = err.message;
  console.error('Primary Firebase Init Error:', err.message);
}

try {
  if (process.env.FIREBASE_SECONDARY_SERVICE_ACCOUNT) {
    const secondaryAccount = parseServiceAccount(process.env.FIREBASE_SECONDARY_SERVICE_ACCOUNT);
    const secondaryApp = admin.initializeApp(
      { credential: admin.credential.cert(secondaryAccount) },
      'secondaryApp'
    );
    dbSecondary = secondaryApp.firestore();
  }
} catch (err) {
  dbInitError = err.message;
  console.error('Secondary Firebase Init Error:', err.message);
}

const getDb = (target = 'primary') => {
  if (target === 'secondary' && dbSecondary) return dbSecondary;
  return dbPrimary || dbSecondary;
};

async function writeBothDbs(fn) {
  const dbs = [dbPrimary, dbSecondary].filter(Boolean);
  if (!dbs.length) {
    throw new Error('Koi Firebase DB configured nahi hai');
  }
  for (const database of dbs) {
    await fn(database);
  }
}

async function creditRechargeToUser({ userId, amount, txId }) {
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
          chargedBalance: prevCharged + Number(amount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      t.set(txRef, {
        txId: String(txId),
        userId: String(userId),
        amount: Number(amount),
        status: 'Success',
        autoApproved: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      t.set(billRef, {
        userId: String(userId),
        type: 'Recharge',
        amount: `+₹${Number(amount).toFixed(2)}`,
        status: 'Success',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
  });
}

app.get('/', (req, res) => {
  res.json({
    success: true,
    service: 'Razorpay + Firebase Auto-Payment API',
    primaryDbConnected: Boolean(dbPrimary),
    secondaryDbConnected: Boolean(dbSecondary),
    razorpayConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    dbInitError
  });
});

// 1. Create Razorpay Test Order (₹1 = 100 paise)
app.post('/api/recharge/create', express.json(), async (req, res) => {
  try {
    const { userId, amount, channel = 'UPI' } = req.body;
    const amt = Number(amount);
    if (!userId || !amt || amt <= 0) {
      return res.status(400).json({ success: false, message: 'userId aur valid amount zaroori hai' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    const receipt = 'RC_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000);

    if (keyId && keySecret) {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: Math.round(amt * 100),
          currency: 'INR',
          receipt,
          notes: { userId: String(userId), channel }
        })
      });
      const rzpData = await rzpRes.json();
      if (!rzpRes.ok) {
        return res.status(400).json({
          success: false,
          message: rzpData.error?.description || 'Razorpay order create fail hua'
        });
      }
      return res.json({
        success: true,
        keyId,
        orderId: rzpData.id,
        receipt,
        amount: amt,
        amountPaise: rzpData.amount,
        currency: rzpData.currency,
        userId: String(userId)
      });
    }

    return res.json({
      success: true,
      orderId: receipt,
      userId: String(userId),
      amount: amt,
      channel
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Verify Razorpay Checkout Payment & Auto-Credit Balance
app.post('/api/recharge/verify', express.json(), async (req, res) => {
  try {
    const { userId, amount, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!userId || !amount || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Payment verification fields missing hain' });
    }

    if (!keySecret) {
      return res.status(400).json({ success: false, message: 'RAZORPAY_KEY_SECRET set nahi hai' });
    }

    const expectedSig = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ success: false, message: 'Invalid Razorpay payment signature' });
    }

    await creditRechargeToUser({
      userId: String(userId),
      amount: Number(amount),
      txId: String(razorpay_payment_id)
    });

    return res.json({
      success: true,
      userId: String(userId),
      credited: Number(amount),
      paymentId: String(razorpay_payment_id),
      status: 'Success'
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Razorpay Webhook Endpoint
app.post('/api/recharge/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const webhookSecret = process.env.WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    if (webhookSecret && signature) {
      const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      if (signature !== expected) {
        return res.status(400).json({ success: false, message: 'Invalid webhook signature' });
      }
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    if (payload.event === 'payment.captured' && payload.payload?.payment?.entity) {
      const p = payload.payload.payment.entity;
      const userId = p.notes?.userId;
      const amount = Number(p.amount || 0) / 100;
      const txId = p.id || ('TX_' + Date.now());

      if (userId && amount > 0) {
        await creditRechargeToUser({ userId: String(userId), amount, txId });
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.use(express.json());

// 4. Test Withdrawal Balance Top-up (₹1 testing ke liye)
app.post('/api/checkin', async (req, res) => {
  try {
    const { userId, bonus = 1 } = req.body;
    const reward = Number(bonus || 1);
    if (!userId) return res.status(400).json({ success: false, message: 'userId zaroori hai' });

    await writeBothDbs(async (database) => {
      const userRef = database.collection('users').doc(String(userId));
      const billRef = database.collection('bills').doc();
      await database.runTransaction(async (t) => {
        const snap = await t.get(userRef);
        const wBal = snap.exists ? Number(snap.data().withdrawalBalance || 0) : 0;
        t.set(userRef, { withdrawalBalance: wBal + reward }, { merge: true });
        t.set(billRef, {
          userId: String(userId),
          type: 'Other',
          amount: `+₹${reward.toFixed(2)}`,
          status: 'Success',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    });

    return res.json({ success: true, credited: reward });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
});

// 5. Automatic UPI Withdrawal -> Status "Success"
async function executeUpiPayout({ amount, upiId, holderName, referenceId }) {
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
  return { payoutId: 'RZP_TEST_UPI_' + Date.now(), mode: 'TEST_AUTO_UPI' };
}

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
    return res.status(400).json({ success: false, message: err.message });
  }
});

// 6. User Balances & Withdrawal History
app.get('/api/user/:userId', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(400).json({ success: false, message: 'Koi Firebase DB configured nahi hai' });

    const userId = String(req.params.userId);
    const userDoc = await db.collection('users').doc(userId).get();
    const user = userDoc.exists
      ? { id: userId, ...userDoc.data() }
      : { id: userId, chargedBalance: 0, withdrawalBalance: 0 };

    const wdSnap = await db.collection('withdrawals').where('userId', '==', userId).limit(50).get();
    const withdrawals = wdSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return res.json({ success: true, user, withdrawals });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Razorpay + Firebase API Server running on port ${PORT}`);
});
