require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const admin = require('firebase-admin');

const app = express();
app.use(cors());

// ============================================================================
// 1. DUAL FIREBASE INITIALIZATION
// ============================================================================
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
    const acc = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
    const pApp = admin.initializeApp({ credential: admin.credential.cert(acc) }, 'primaryApp');
    dbPrimary = pApp.firestore();
  }
} catch (err) {
  dbInitError = err.message;
}

try {
  if (process.env.FIREBASE_SECONDARY_SERVICE_ACCOUNT) {
    const acc2 = parseServiceAccount(process.env.FIREBASE_SECONDARY_SERVICE_ACCOUNT);
    const sApp = admin.initializeApp({ credential: admin.credential.cert(acc2) }, 'secondaryApp');
    dbSecondary = sApp.firestore();
  }
} catch (err) {
  dbInitError = err.message;
}

const getDb = (target = 'primary') => {
  if (target === 'secondary' && dbSecondary) return dbSecondary;
  return dbPrimary || dbSecondary;
};

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
    return res.status(403).json({
      success: false,
      uiPosition: 'center',
      message: 'Unauthorized admin key'
    });
  }
  next();
};

function hashPass(val) {
  return crypto.createHash('sha256').update(String(val)).digest('hex');
}

// VIP Tiers matching image rules:
// 280 -> 1 VIP, 3800 -> 2 VIP, 8900 -> 3 VIP, 13000 -> 4 VIP,
// 50000 -> 5 VIP, 200000 -> 6 VIP, 500000 -> 7 VIP, 1000000 -> 8 VIP
const VIP_TIERS = [
  { level: 8, minInvest: 1000000 },
  { level: 7, minInvest: 500000 },
  { level: 6, minInvest: 200000 },
  { level: 5, minInvest: 50000 },
  { level: 4, minInvest: 13000 },
  { level: 3, minInvest: 8900 },
  { level: 2, minInvest: 3800 },
  { level: 1, minInvest: 280 },
  { level: 0, minInvest: 0 }
];

function computeVipLevel(totalInvestment) {
  const inv = Number(totalInvestment || 0);
  for (const tier of VIP_TIERS) {
    if (inv >= tier.minInvest) return tier.level;
  }
  return 0;
}

// ============================================================================
// 2. HEALTH & LIVE USER SYNC
// ============================================================================
app.get('/', (req, res) => {
  res.json({
    success: true,
    uiPosition: 'center',
    service: 'Complete Investment & Auto-Payment API',
    primaryDbConnected: Boolean(dbPrimary),
    secondaryDbConnected: Boolean(dbSecondary),
    dbInitError
  });
});

// ============================================================================
// 3. REGISTER & LOGIN (PHONE, PASS, WITHDRAW PASS, INVITE CODE / NONE)
// ============================================================================
app.post('/api/auth/register', express.json(), async (req, res) => {
  try {
    const {
      phone,
      password,
      withdrawPassword,
      inviteCode,
      referrerCode,
      fromReferralLink = false,
      realName = '',
      bankName = '',
      bankAccount = ''
    } = req.body;

    if (!phone || !password || !withdrawPassword) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Phone number, password aur withdraw password zaroori hai'
      });
    }

    const db = getDb();
    if (!db) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Koi Firebase DB configured nahi hai'
      });
    }

    const cleanPhone = String(phone).trim();
    const existingSnap = await db.collection('users').where('phone', '==', cleanPhone).limit(1).get();
    if (!existingSnap.empty) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Yeh phone number pehle se register hai'
      });
    }

    const userId = String(Math.floor(1000000 + Math.random() * 9000000));
    const ownInviteCode = 'INV' + userId;
    const resolvedInviteCode = fromReferralLink
      ? String(inviteCode || referrerCode || 'NONE').trim() || 'NONE'
      : String(inviteCode || referrerCode || 'NONE').trim() || 'NONE';

    const userRecord = {
      userId,
      uid: userId,
      phone: cleanPhone,
      passwordHash: hashPass(password),
      withdrawPasswordHash: hashPass(withdrawPassword),
      inviteCode: resolvedInviteCode,
      ownInviteCode,
      realName: String(realName).trim(),
      bankName: String(bankName).trim(),
      bankAccount: String(bankAccount).trim(),
      chargedBalance: 0,
      withdrawalBalance: 0,
      totalInvestment: 0,
      totalRecharge: 0,
      totalWithdraw: 0,
      vipLevel: 0,
      isActive: true,
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await writeBothDbs(async (database) => {
      await database.collection('users').doc(userId).set(userRecord, { merge: true });
    });

    const safeUser = { ...userRecord };
    delete safeUser.passwordHash;
    delete safeUser.withdrawPasswordHash;

    return res.status(201).json({
      success: true,
      uiPosition: 'center',
      message: 'Registration successful! Aapka account ban gaya hai.',
      userId,
      inviteCode: resolvedInviteCode,
      user: safeUser
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      uiPosition: 'center',
      message: err.message
    });
  }
});

app.post('/api/auth/login', express.json(), async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Phone number aur password daalein'
      });
    }

    const db = getDb();
    if (!db) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Koi Firebase DB configured nahi hai'
      });
    }

    const snap = await db.collection('users').where('phone', '==', String(phone).trim()).limit(1).get();
    if (snap.empty) {
      return res.status(404).json({
        success: false,
        uiPosition: 'center',
        message: 'User nahi mila, pehle register karein'
      });
    }

    const doc = snap.docs[0];
    const data = doc.data();
    if (data.passwordHash !== hashPass(password)) {
      return res.status(401).json({
        success: false,
        uiPosition: 'center',
        message: 'Galat password hai'
      });
    }

    await writeBothDbs(async (database) => {
      await database.collection('users').doc(doc.id).set(
        {
          isActive: true,
          lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    const safeUser = { id: doc.id, ...data };
    delete safeUser.passwordHash;
    delete safeUser.withdrawPasswordHash;

    return res.json({
      success: true,
      uiPosition: 'center',
      message: 'Login successful!',
      userId: doc.id,
      user: safeUser
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      uiPosition: 'center',
      message: err.message
    });
  }
});

// ============================================================================
// 4. PROMO CODE CREATE (ADMIN) & CLAIM (USER -> CENTER MESSAGE)
// ============================================================================
app.post('/api/admin/promo/create', requireAdmin, express.json(), async (req, res) => {
  try {
    const {
      code,
      rewardAmount,
      balanceTarget = 'withdrawalBalance',
      expiresAt,
      maxUses = 0,
      allowedUserIds = [],
      requiredVipLevel = 0,
      minPurchasePrice = 0,
      promoValidUntil = null
    } = req.body;

    const cleanCode = String(code || '').trim().toUpperCase();
    const amt = Number(rewardAmount || 0);
    if (!cleanCode || amt <= 0) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Valid promo code aur rewardAmount zaroori hai'
      });
    }

    const promoData = {
      code: cleanCode,
      rewardAmount: amt,
      balanceTarget: balanceTarget === 'chargedBalance' ? 'chargedBalance' : 'withdrawalBalance',
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      maxUses: Number(maxUses || 0),
      usedCount: 0,
      usedBy: [],
      allowedUserIds: Array.isArray(allowedUserIds) ? allowedUserIds.map(String) : [],
      requiredVipLevel: Number(requiredVipLevel || 0),
      minPurchasePrice: Number(minPurchasePrice || 0),
      promoValidUntil: promoValidUntil ? new Date(promoValidUntil).toISOString() : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await writeBothDbs(async (database) => {
      await database.collection('promo_codes').doc(cleanCode).set(promoData, { merge: true });
    });

    return res.json({
      success: true,
      uiPosition: 'center',
      message: `Promo code ${cleanCode} create ho gaya`,
      promo: promoData
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      uiPosition: 'center',
      message: err.message
    });
  }
});

app.post('/api/promo/claim', express.json(), async (req, res) => {
  try {
    const { userId, code } = req.body;
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!userId || !cleanCode) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'User ID aur promo code daalein'
      });
    }

    let claimedAmount = 0;

    await writeBothDbs(async (database) => {
      const promoRef = database.collection('promo_codes').doc(cleanCode);
      const userRef = database.collection('users').doc(String(userId));
      const billRef = database.collection('bills').doc();

      await database.runTransaction(async (t) => {
        const promoSnap = await t.get(promoRef);
        if (!promoSnap.exists) {
          throw new Error('Promo code valid nahi hai');
        }

        const promo = promoSnap.data();
        const now = Date.now();

        if (promo.expiresAt && now > new Date(promo.expiresAt).getTime()) {
          throw new Error('Promo code ka time khatam ho gaya hai');
        }
        if (promo.promoValidUntil && now > new Date(promo.promoValidUntil).getTime()) {
          throw new Error('Promo code ki validity khatam ho gayi hai');
        }
        if (Number(promo.maxUses || 0) > 0 && Number(promo.usedCount || 0) >= Number(promo.maxUses)) {
          throw new Error('Promo code ki total limit poori ho chuki hai');
        }

        const usedBy = Array.isArray(promo.usedBy) ? promo.usedBy : [];
        if (usedBy.includes(String(userId))) {
          throw new Error('Aap is promo code ko pehle hi claim kar chuke hain');
        }

        const allowed = Array.isArray(promo.allowedUserIds) ? promo.allowedUserIds : [];
        if (allowed.length > 0 && !allowed.includes(String(userId))) {
          throw new Error('Yeh promo code sirf selected users ke liye hai');
        }

        const userSnap = await t.get(userRef);
        const userData = userSnap.exists ? userSnap.data() : {};
        const userVip = Number(userData.vipLevel || 0);
        if (Number(promo.requiredVipLevel || 0) > 0 && userVip < Number(promo.requiredVipLevel)) {
          throw new Error(`Is promo ke liye kam se kam VIP ${promo.requiredVipLevel} zaroori hai`);
        }

        if (Number(promo.minPurchasePrice || 0) > 0) {
          const lastInv = Number(userData.totalInvestment || 0);
          if (lastInv < Number(promo.minPurchasePrice)) {
            throw new Error(`Is promo ke liye kam se kam ₹${promo.minPurchasePrice} ka investment zaroori hai`);
          }
        }

        claimedAmount = Number(promo.rewardAmount || 0);
        const targetField = promo.balanceTarget === 'chargedBalance' ? 'chargedBalance' : 'withdrawalBalance';
        const prevBal = Number(userData[targetField] || 0);

        t.set(
          userRef,
          {
            userId: String(userId),
            [targetField]: prevBal + claimedAmount,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );

        t.set(
          promoRef,
          {
            usedCount: Number(promo.usedCount || 0) + 1,
            usedBy: [...usedBy, String(userId)]
          },
          { merge: true }
        );

        t.set(billRef, {
          userId: String(userId),
          type: 'Promo Code',
          amount: `+₹${claimedAmount.toFixed(2)}`,
          code: cleanCode,
          status: 'Success',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    });

    return res.json({
      success: true,
      uiPosition: 'center',
      message: `Promo code ${cleanCode} claim ho gaya! ₹${claimedAmount.toFixed(2)} add ho gaye.`,
      credited: claimedAmount,
      code: cleanCode
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      uiPosition: 'center',
      message: err.message
    });
  }
});

// ============================================================================
// 5. PRODUCTS ADD/REMOVE (ADMIN), LIMITED/UNLIMITED COPIES & BUY -> MY PRODUCT
// ============================================================================
app.post('/api/admin/products/add', requireAdmin, express.json(), async (req, res) => {
  try {
    const {
      id,
      name,
      image = '',
      vipLevel = 0,
      price,
      dailyIncome,
      durationDays = 2,
      payoutInterval = 'daily', // '1m', '3m', '15s', '30s', '1h', 'daily', 'end_of_cycle'
      isLimited = false,
      totalCopies = null
    } = req.body;

    if (!name || Number(price) <= 0) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Product name aur valid price zaroori hai'
      });
    }

    const prodId = id ? String(id) : 'PROD_' + Date.now();
    const limitFlag = Boolean(isLimited) || (totalCopies !== null && totalCopies !== undefined && Number(totalCopies) > 0);
    const copiesCount = limitFlag ? Number(totalCopies || 0) : null;

    const productDoc = {
      id: prodId,
      name: String(name),
      image: String(image),
      vipLevel: Number(vipLevel || 0),
      price: Number(price),
      dailyIncome: Number(dailyIncome || 0),
      durationDays: Number(durationDays || 2),
      payoutInterval: String(payoutInterval || 'daily'),
      isLimited: limitFlag,
      remainingCopies: copiesCount,
      totalCopies: copiesCount,
      totalBuyCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await writeBothDbs(async (database) => {
      await database.collection('products').doc(prodId).set(productDoc, { merge: true });
    });

    return res.json({
      success: true,
      uiPosition: 'center',
      message: 'Product add ho gaya',
      product: productDoc
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      uiPosition: 'center',
      message: err.message
    });
  }
});

app.post('/api/admin/products/remove', requireAdmin, express.json(), async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'productId zaroori hai'
      });
    }

    await writeBothDbs(async (database) => {
      await database.collection('products').doc(String(productId)).delete();
    });

    return res.json({
      success: true,
      uiPosition: 'center',
      message: 'Product remove ho gaya',
      productId: String(productId)
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      uiPosition: 'center',
      message: err.message
    });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Koi Firebase DB configured nahi hai'
      });
    }
    const snap = await db.collection('products').get();
    const products = snap.docs.map((d) => {
      const data = d.data();
      const soldOut = Boolean(data.isLimited) && Number(data.remainingCopies || 0) <= 0;
      return {
        id: d.id,
        ...data,
        soldOut,
        soldOutMessage: soldOut ? 'Product khatam ho gaya hai koi or product buy karo thank you' : ''
      };
    });
    return res.json({ success: true, products });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// Buy Product -> Deduct Charged Balance, Update VIP Level & Total Investment,
// Return "View Product" and "My Product" actions for centered popup
app.post('/api/products/buy', express.json(), async (req, res) => {
  try {
    const { userId, productId, copies = 1 } = req.body;
    const qty = Math.max(1, Number(copies || 1));

    if (!userId || !productId) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'userId aur productId zaroori hai'
      });
    }

    const orderId = 'ORD_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900);
    let purchasedProduct = null;
    let newVip = 0;

    await writeBothDbs(async (database) => {
      const prodRef = database.collection('products').doc(String(productId));
      const userRef = database.collection('users').doc(String(userId));
      const orderRef = database.collection('orders').doc(orderId);
      const billRef = database.collection('bills').doc();

      await database.runTransaction(async (t) => {
        const prodSnap = await t.get(prodRef);
        if (!prodSnap.exists) {
          throw new Error('Product nahi mila');
        }
        const prod = prodSnap.data();

        if (prod.isLimited) {
          const rem = Number(prod.remainingCopies || 0);
          if (rem < qty) {
            throw new Error('Product khatam ho gaya hai koi or product buy karo thank you');
          }
        }

        const unitPrice = Number(prod.price || 0);
        const totalCost = unitPrice * qty;

        const userSnap = await t.get(userRef);
        const userData = userSnap.exists ? userSnap.data() : {};
        const charged = Number(userData.chargedBalance || 0);
        if (charged < totalCost) {
          throw new Error('Aapka charged balance kam hai, pehle recharge karein');
        }

        const updatedInvestment = Number(userData.totalInvestment || 0) + totalCost;
        newVip = Math.max(Number(userData.vipLevel || 0), computeVipLevel(updatedInvestment));

        const nowMs = Date.now();
        const durationDays = Number(prod.durationDays || 2);
        const payoutTimeMs = nowMs + durationDays * 24 * 60 * 60 * 1000;

        const prodUpdate = {
          totalBuyCount: Number(prod.totalBuyCount || 0) + qty
        };
        if (prod.isLimited) {
          prodUpdate.remainingCopies = Number(prod.remainingCopies || 0) - qty;
        }

        t.set(prodRef, prodUpdate, { merge: true });
        t.set(
          userRef,
          {
            chargedBalance: charged - totalCost,
            totalInvestment: updatedInvestment,
            vipLevel: newVip,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );

        const orderObj = {
          id: orderId,
          orderId,
          userId: String(userId),
          productId: String(productId),
          productName: prod.name || 'Product',
          image: prod.image || '',
          unitPrice,
          copies: qty,
          totalAmount: totalCost,
          dailyIncome: Number(prod.dailyIncome || 0),
          durationDays,
          payoutInterval: prod.payoutInterval || 'daily',
          scheduledPayoutAt: new Date(payoutTimeMs).toISOString(),
          payoutCredited: false,
          status: 'Active',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        purchasedProduct = orderObj;
        t.set(orderRef, orderObj);

        t.set(billRef, {
          userId: String(userId),
          type: 'Investment',
          amount: `-₹${totalCost.toFixed(2)}`,
          status: 'Success',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    });

    return res.json({
      success: true,
      uiPosition: 'center',
      message: 'Product successfully buy ho gaya! Aapka order My Product mein add ho gaya hai.',
      orderId,
      vipLevel: newVip,
      order: purchasedProduct,
      actions: [
        { label: 'View Product', target: 'view_product', productId: String(productId) },
        { label: 'My Product', target: 'my_product', orderId }
      ]
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      uiPosition: 'center',
      message: err.message
    });
  }
});

app.get('/api/my-products/:userId', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'Koi Firebase DB configured nahi hai' });
    }
    const snap = await db.collection('orders').where('userId', '==', String(req.params.userId)).get();
    return res.json({
      success: true,
      orders: snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// Process due product payouts (e.g., 28th invest -> 30th same time payout, or interval payouts)
app.post('/api/orders/process-due', express.json(), async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'Koi Firebase DB configured nahi hai' });
    }

    const now = Date.now();
    const snap = await db.collection('orders').where('payoutCredited', '==', false).get();
    let processedCount = 0;

    for (const doc of snap.docs) {
      const ord = doc.data();
      const dueMs = ord.scheduledPayoutAt ? new Date(ord.scheduledPayoutAt).getTime() : 0;
      if (dueMs > 0 && now >= dueMs) {
        const payoutAmt = Number(ord.dailyIncome || 0) * Number(ord.durationDays || 1) * Number(ord.copies || 1);
        await writeBothDbs(async (database) => {
          const uRef = database.collection('users').doc(String(ord.userId));
          const oRef = database.collection('orders').doc(doc.id);
          const bRef = database.collection('bills').doc();

          await database.runTransaction(async (t) => {
            const oSnap = await t.get(oRef);
            if (!oSnap.exists || oSnap.data().payoutCredited) return;

            const uSnap = await t.get(uRef);
            const curW = uSnap.exists ? Number(uSnap.data().withdrawalBalance || 0) : 0;

            t.set(uRef, { withdrawalBalance: curW + payoutAmt }, { merge: true });
            t.set(
              oRef,
              {
                payoutCredited: true,
                status: 'Completed',
                creditedAmount: payoutAmt,
                creditedAt: admin.firestore.FieldValue.serverTimestamp()
              },
              { merge: true }
            );
            t.set(bRef, {
              userId: String(ord.userId),
              type: 'Product Return',
              amount: `+₹${payoutAmt.toFixed(2)}`,
              status: 'Success',
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
          });
        });
        processedCount += 1;
      }
    }

    return res.json({
      success: true,
      uiPosition: 'center',
      message: `${processedCount} product payouts process ho gaye`,
      processedCount
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// ============================================================================
// 6. AUTO RECHARGE (CREATE + VERIFY + WEBHOOK) & WITHDRAW (BANK + WITHDRAW PASS + AUTO UPI)
// ============================================================================
async function creditRecharge({ userId, amount, txId }) {
  await writeBothDbs(async (database) => {
    const txRef = database.collection('recharges').doc(String(txId));
    const userRef = database.collection('users').doc(String(userId));
    const billRef = database.collection('bills').doc();

    await database.runTransaction(async (t) => {
      const ex = await t.get(txRef);
      if (ex.exists) return;

      const uSnap = await t.get(userRef);
      const uData = uSnap.exists ? uSnap.data() : {};
      const prevCharged = Number(uData.chargedBalance || 0);
      const prevTotalRecharge = Number(uData.totalRecharge || 0);

      t.set(
        userRef,
        {
          userId: String(userId),
          chargedBalance: prevCharged + Number(amount),
          totalRecharge: prevTotalRecharge + Number(amount),
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

app.post('/api/recharge/create', express.json(), async (req, res) => {
  try {
    const { userId, amount, channel = 'UPI' } = req.body;
    const amt = Number(amount);
    if (!userId || !amt || amt <= 0) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'userId aur valid amount zaroori hai' });
    }

    const receipt = 'RC_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000);
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
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
          uiPosition: 'center',
          message: rzpData.error?.description || 'Order create fail hua'
        });
      }
      return res.json({
        success: true,
        keyId: process.env.RAZORPAY_KEY_ID,
        orderId: rzpData.id,
        receipt,
        amount: amt,
        amountPaise: rzpData.amount,
        currency: rzpData.currency,
        userId: String(userId)
      });
    }

    return res.json({ success: true, orderId: receipt, userId: String(userId), amount: amt, channel });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/recharge/verify', express.json(), async (req, res) => {
  try {
    const { userId, amount, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'RAZORPAY_KEY_SECRET set nahi hai' });
    }
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'Invalid signature' });
    }

    await creditRecharge({ userId: String(userId), amount: Number(amount), txId: String(razorpay_payment_id) });
    return res.json({
      success: true,
      uiPosition: 'center',
      message: `₹${Number(amount).toFixed(2)} recharge auto-credit ho gaya!`,
      credited: Number(amount),
      status: 'Success'
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/recharge/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const payload = JSON.parse(rawBody.toString('utf8'));
    if (payload.event === 'payment.captured' && payload.payload?.payment?.entity) {
      const p = payload.payload.payment.entity;
      const userId = p.notes?.userId;
      const amount = Number(p.amount || 0) / 100;
      const txId = p.id || ('TX_' + Date.now());
      if (userId && amount > 0) {
        await creditRecharge({ userId: String(userId), amount, txId });
      }
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Withdraw with Bank Name, Real Name, Bank Account & Withdraw Password
app.post('/api/withdraw/auto-upi', express.json(), async (req, res) => {
  try {
    const {
      userId,
      amount,
      withdrawPassword,
      bankName = '',
      realName = '',
      bankAccount = '',
      upiId = ''
    } = req.body;

    const amt = Number(amount);
    if (!userId || !amt || amt <= 0) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'userId aur valid amount zaroori hai'
      });
    }

    const db = getDb();
    if (!db) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Koi Firebase DB configured nahi hai'
      });
    }

    const uSnap = await db.collection('users').doc(String(userId)).get();
    if (uSnap.exists && uSnap.data().withdrawPasswordHash) {
      if (!withdrawPassword || hashPass(withdrawPassword) !== uSnap.data().withdrawPasswordHash) {
        return res.status(401).json({
          success: false,
          uiPosition: 'center',
          message: 'Galat withdraw password hai'
        });
      }
    }

    const wdId = 'WD_' + Date.now();
    const payoutId = 'PAYOUT_' + Date.now();

    await writeBothDbs(async (database) => {
      const userRef = database.collection('users').doc(String(userId));
      const wdRef = database.collection('withdrawals').doc(wdId);
      const billRef = database.collection('bills').doc();

      await database.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);
        const uData = userDoc.exists ? userDoc.data() : {};
        const curW = Number(uData.withdrawalBalance || 0);
        if (curW < amt) {
          throw new Error('Withdrawal balance kam hai');
        }

        t.set(
          userRef,
          {
            withdrawalBalance: curW - amt,
            totalWithdraw: Number(uData.totalWithdraw || 0) + amt,
            bankName: bankName ? String(bankName).trim() : (uData.bankName || ''),
            realName: realName ? String(realName).trim() : (uData.realName || ''),
            bankAccount: bankAccount ? String(bankAccount).trim() : (uData.bankAccount || '')
          },
          { merge: true }
        );

        t.set(wdRef, {
          id: wdId,
          userId: String(userId),
          amount: amt,
          upiId: String(upiId || '').trim(),
          bankName: String(bankName || uData.bankName || '').trim(),
          realName: String(realName || uData.realName || '').trim(),
          bankAccount: String(bankAccount || uData.bankAccount || '').trim(),
          status: 'Success',
          payoutId,
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

    return res.json({
      success: true,
      uiPosition: 'center',
      message: `₹${amt.toFixed(2)} withdrawal successful!`,
      withdrawalId: wdId,
      payoutId,
      status: 'Success'
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      uiPosition: 'center',
      message: err.message
    });
  }
});

// ============================================================================
// 7. BLOG WITHDRAWAL PROOF (2 IMAGES + TEXT, LIVE USER IMAGES, ADMIN DOWNLOAD)
// ============================================================================
app.post('/api/blog/submit', express.json(), async (req, res) => {
  try {
    const { userId, text = '', images = [] } = req.body;
    const imgList = Array.isArray(images) ? images.slice(0, 2) : [];

    if (!userId || (!text && imgList.length === 0)) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Text ya kam se kam 1-2 images zaroori hain'
      });
    }

    const postId = 'BLOG_' + Date.now();
    const postDoc = {
      id: postId,
      userId: String(userId),
      text: String(text),
      images: imgList,
      downloadable: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await writeBothDbs(async (database) => {
      await database.collection('blog_proofs').doc(postId).set(postDoc);
    });

    return res.json({
      success: true,
      uiPosition: 'center',
      message: 'Withdrawal proof publish ho gaya',
      post: postDoc
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.get('/api/blog/list', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(400).json({ success: false, uiPosition: 'center', message: 'Koi Firebase DB configured nahi hai' });
    const snap = await db.collection('blog_proofs').get();
    return res.json({
      success: true,
      posts: snap.docs.map((d) => ({ id: d.id, ...d.data(), canAdminDownload: true }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// ============================================================================
// 8. POPUP & HOME BANNER, CONFIG, ACTIVE USERS, UID BONUS & CUSTOMER SERVICE
// ============================================================================
app.get('/api/config', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(400).json({ success: false, uiPosition: 'center', message: 'Koi Firebase DB configured nahi hai' });

    const cfgDoc = await db.collection('app_config').doc('main').get();
    const usersSnap = await db.collection('users').get();
    const activeUsersCount = usersSnap.docs.filter((d) => Boolean(d.data().isActive)).length;

    return res.json({
      success: true,
      activeUsersCount,
      totalUsersCount: usersSnap.size,
      config: cfgDoc.exists
        ? cfgDoc.data()
        : {
            popupBanner: { image: '', text: '', link: '' },
            homeBanner: { image: '', text: '', link: '' }
          }
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/admin/config', requireAdmin, express.json(), async (req, res) => {
  try {
    const { popupBanner, homeBanner, ...rest } = req.body;
    await writeBothDbs(async (database) => {
      await database.collection('app_config').doc('main').set(
        {
          ...rest,
          ...(popupBanner ? { popupBanner } : {}),
          ...(homeBanner ? { homeBanner } : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });
    return res.json({ success: true, uiPosition: 'center', message: 'Banner/Config update ho gaya' });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// Admin send bonus by UID
app.post('/api/admin/bonus/uid', requireAdmin, express.json(), async (req, res) => {
  try {
    const { uid, userId, amount, balanceTarget = 'withdrawalBalance' } = req.body;
    const targetUid = String(uid || userId || '').trim();
    const amt = Number(amount || 0);

    if (!targetUid || amt <= 0) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Valid UID aur amount zaroori hai'
      });
    }

    const field = balanceTarget === 'chargedBalance' ? 'chargedBalance' : 'withdrawalBalance';

    await writeBothDbs(async (database) => {
      const uRef = database.collection('users').doc(targetUid);
      const bRef = database.collection('bills').doc();
      await database.runTransaction(async (t) => {
        const snap = await t.get(uRef);
        const cur = snap.exists ? Number(snap.data()[field] || 0) : 0;
        t.set(uRef, { userId: targetUid, [field]: cur + amt }, { merge: true });
        t.set(bRef, {
          userId: targetUid,
          type: 'Admin Bonus',
          amount: `+₹${amt.toFixed(2)}`,
          status: 'Success',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    });

    return res.json({
      success: true,
      uiPosition: 'center',
      message: `UID ${targetUid} ko ₹${amt.toFixed(2)} bonus mil gaya`,
      uid: targetUid,
      credited: amt
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// Customer Service Ticket & Admin Reply
app.post('/api/service/ticket', express.json(), async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'userId aur problem message zaroori hai'
      });
    }

    const ticketId = 'TKT_' + Date.now();
    const ticketDoc = {
      id: ticketId,
      userId: String(userId),
      message: String(message),
      adminReply: '',
      status: 'Open',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await writeBothDbs(async (database) => {
      await database.collection('support_tickets').doc(ticketId).set(ticketDoc);
    });

    return res.json({
      success: true,
      uiPosition: 'center',
      message: 'Aapki problem customer service ko bhej di gayi hai',
      ticket: ticketDoc
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/admin/service/reply', requireAdmin, express.json(), async (req, res) => {
  try {
    const { ticketId, reply } = req.body;
    if (!ticketId || !reply) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'ticketId aur reply zaroori hai' });
    }

    await writeBothDbs(async (database) => {
      await database.collection('support_tickets').doc(String(ticketId)).set(
        {
          adminReply: String(reply),
          status: 'Replied',
          repliedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    return res.json({ success: true, uiPosition: 'center', message: 'Admin reply send ho gaya' });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.get('/api/service/tickets/:userId', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(400).json({ success: false, uiPosition: 'center', message: 'Koi Firebase DB configured nahi hai' });
    const snap = await db.collection('support_tickets').where('userId', '==', String(req.params.userId)).get();
    return res.json({
      success: true,
      tickets: snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// ============================================================================
// 9. ADMIN OVERVIEW (ALL USERS, BALANCES, RECHARGE, WITHDRAW, INVESTMENT)
// ============================================================================
app.get('/api/admin/overview', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'Koi Firebase DB configured nahi hai' });
    }

    const usersSnap = await db.collection('users').get();
    const wdSnap = await db.collection('withdrawals').get();
    const ordersSnap = await db.collection('orders').get();
    const rechargesSnap = await db.collection('recharges').get();

    let totalChargedBalance = 0;
    let totalWithdrawalBalance = 0;
    let totalInvestmentAmount = 0;
    let totalRechargeAmount = 0;
    let totalWithdrawAmount = 0;

    const users = usersSnap.docs.map((d) => {
      const u = d.data();
      const ch = Number(u.chargedBalance || 0);
      const wd = Number(u.withdrawalBalance || 0);
      const inv = Number(u.totalInvestment || 0);
      totalChargedBalance += ch;
      totalWithdrawalBalance += wd;
      totalInvestmentAmount += inv;

      const copy = { id: d.id, ...u };
      delete copy.passwordHash;
      delete copy.withdrawPasswordHash;
      return copy;
    });

    rechargesSnap.forEach((d) => {
      totalRechargeAmount += Number(d.data().amount || 0);
    });

    wdSnap.forEach((d) => {
      totalWithdrawAmount += Number(d.data().amount || 0);
    });

    const investments = ordersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const withdrawals = wdSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return res.json({
      success: true,
      stats: {
        totalUsers: users.length,
        totalChargedBalance,
        totalWithdrawalBalance,
        totalRechargeAmount,
        totalWithdrawAmount,
        totalInvestmentAmount
      },
      users,
      investments,
      withdrawals
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// Single user live state
app.get('/api/user/:userId', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'Koi Firebase DB configured nahi hai' });
    }
    const uid = String(req.params.userId);
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, uiPosition: 'center', message: 'User nahi mila' });
    }
    const u = { id: doc.id, ...doc.data() };
    delete u.passwordHash;
    delete u.withdrawPasswordHash;

    const wdSnap = await db.collection('withdrawals').where('userId', '==', uid).limit(50).get();
    return res.json({
      success: true,
      user: u,
      withdrawals: wdSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Complete API Server running on port ${PORT}`);
});
