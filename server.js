require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const admin = require('firebase-admin');

const app = express();
app.use(cors());

// ---------------------------------------------------------------------------
// FIREBASE CONNECTION (`proinvast`)
// ---------------------------------------------------------------------------
let firestoreDb = null;
let connectionError = null;

function buildCredentials(rawEnv) {
  if (!rawEnv) return null;
  const parsed = typeof rawEnv === 'string' ? JSON.parse(rawEnv) : rawEnv;
  if (parsed.private_key && typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const creds = buildCredentials(process.env.FIREBASE_SERVICE_ACCOUNT);
    const fbApp = admin.initializeApp({ credential: admin.credential.cert(creds) }, 'proinvastApp');
    firestoreDb = fbApp.firestore();
  } else {
    connectionError = 'FIREBASE_SERVICE_ACCOUNT missing';
  }
} catch (err) {
  connectionError = err.message;
}

function needDb(res) {
  if (!firestoreDb) {
    res.status(400).json({
      success: false,
      uiPosition: 'center',
      message: 'Koi Firebase DB configured nahi hai'
    });
    return false;
  }
  return true;
}

function verifyAdminToken(req, res, next) {
  const expected = process.env.ADMIN_SECRET;
  const given = req.headers['x-admin-secret'] || req.body?.adminKey;
  if (!expected || given !== expected) {
    return res.status(403).json({
      success: false,
      uiPosition: 'center',
      message: 'Unauthorized admin access'
    });
  }
  next();
}

function digestValue(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

// VIP Rules: 280->1, 3800->2, 8900->3, 13000->4, 50000->5, 200000->6, 500000->7, 1000000->8[span_0](start_span)[span_0](end_span)
function resolveVipTier(totalInvest) {
  const amount = Number(totalInvest || 0);
  if (amount >= 1000000) return 8;
  if (amount >= 500000) return 7;
  if (amount >= 200000) return 6;
  if (amount >= 50000) return 5;
  if (amount >= 13000) return 4;
  if (amount >= 8900) return 3;
  if (amount >= 3800) return 2;
  if (amount >= 280) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// STATUS & FULL LIVE USER PAGE SYNC[span_1](start_span)[span_1](end_span)[span_2](start_span)[span_2](end_span)
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.json({
    success: true,
    uiPosition: 'center',
    project: 'proinvast',
    dbReady: Boolean(firestoreDb),
    connectionError
  });
});

app.get('/api/live-sync/:userId', async (req, res) => {
  if (!needDb(res)) return;
  try {
    const uid = String(req.params.userId);
    const [codeSnap, cfgSnap, userSnap, prodSnap, ordSnap, tktSnap] = await Promise.all([
      firestoreDb.collection('live_user_page').doc('active').get(),
      firestoreDb.collection('platform_settings').doc('global').get(),
      firestoreDb.collection('users').doc(uid).get(),
      firestoreDb.collection('products').get(),
      firestoreDb.collection('orders').where('userId', '==', uid).get(),
      firestoreDb.collection('tickets').where('userId', '==', uid).get()
    ]);

    let account = null;
    if (userSnap.exists) {
      account = { id: userSnap.id, ...userSnap.data() };
      delete account.passwordHash;
      delete account.withdrawPinHash;
    }

    const codeInfo = codeSnap.exists
      ? {
          version: codeSnap.data().version,
          updatedAt: codeSnap.data().updatedAt,
          reloadRequired: Boolean(codeSnap.data().reloadRequired)
        }
      : { version: 'v0', updatedAt: null, reloadRequired: false };

    return res.json({
      success: true,
      syncedAt: new Date().toISOString(),
      codeInfo,
      settings: cfgSnap.exists ? cfgSnap.data() : {},
      user: account,
      products: prodSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      myProducts: ordSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      tickets: tktSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// ADMIN FULL USER CODE UPDATE & LIVE FETCH[span_3](start_span)[span_3](end_span)[span_4](start_span)[span_4](end_span)
// ---------------------------------------------------------------------------
app.post('/api/admin/user-code/publish', verifyAdminToken, express.json({ limit: '10mb' }), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const { html = '', css = '', js = '', files = {}, note = '', reloadRequired = true } = req.body;
    if (!html && !css && !js && (!files || Object.keys(files).length === 0)) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Update ke liye html, css, js ya files bhejna zaroori hai'
      });
    }

    const version = 'build_' + Date.now();
    const payload = {
      version,
      html: String(html),
      css: String(css),
      js: String(js),
      files: typeof files === 'object' && files !== null ? files : {},
      note: String(note),
      reloadRequired: Boolean(reloadRequired),
      updatedAt: new Date().toISOString(),
      serverStamp: admin.firestore.FieldValue.serverTimestamp()
    };

    await firestoreDb.collection('live_user_page').doc('active').set(payload);
    await firestoreDb.collection('live_user_page_versions').doc(version).set(payload);

    return res.json({
      success: true,
      uiPosition: 'center',
      message: `Live user page full code update ho gaya (${version})`,
      version,
      updatedAt: payload.updatedAt
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.get('/api/user-code/live', async (req, res) => {
  if (!needDb(res)) return;
  try {
    const snap = await firestoreDb.collection('live_user_page').doc('active').get();
    if (!snap.exists) {
      return res.json({
        success: true,
        hasUpdate: false,
        bundle: { version: 'v0', html: '', css: '', js: '', files: {}, reloadRequired: false }
      });
    }
    return res.json({ success: true, hasUpdate: true, bundle: snap.data() });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.get('/api/user-code/versions', verifyAdminToken, async (req, res) => {
  if (!needDb(res)) return;
  try {
    const snap = await firestoreDb.collection('live_user_page_versions').limit(30).get();
    const list = snap.docs.map((d) => {
      const item = d.data();
      return {
        version: item.version || d.id,
        note: item.note || '',
        updatedAt: item.updatedAt || null,
        hasHtml: Boolean(item.html),
        hasCss: Boolean(item.css),
        hasJs: Boolean(item.js),
        files: Object.keys(item.files || {})
      };
    });
    return res.json({ success: true, versions: list });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// AUTH: REGISTER & LOGIN (PHONE, PASS, WITHDRAW PASS, INVITE CODE / NONE)[span_5](start_span)[span_5](end_span)
// ---------------------------------------------------------------------------
app.post('/api/auth/register', express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const {
      phone,
      password,
      withdrawPassword,
      inviteCode,
      fromReferralLink = false,
      realName = '',
      bankName = '',
      bankAccount = ''
    } = req.body;

    if (!phone || !password || !withdrawPassword) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Phone number, login password aur withdraw password zaroori hai'
      });
    }

    const cleanPhone = String(phone).trim();
    const dup = await firestoreDb.collection('users').where('phone', '==', cleanPhone).limit(1).get();
    if (!dup.empty) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Yeh phone number pehle se registered hai'
      });
    }

    const uid = String(Math.floor(1000000 + Math.random() * 9000000));
    const finalInvite = fromReferralLink
      ? String(inviteCode || 'NONE').trim() || 'NONE'
      : String(inviteCode || 'NONE').trim() || 'NONE';

    const docData = {
      userId: uid,
      uid,
      phone: cleanPhone,
      passwordHash: digestValue(password),
      withdrawPinHash: digestValue(withdrawPassword),
      inviteCode: finalInvite,
      myInviteCode: 'REF' + uid,
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
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await firestoreDb.collection('users').doc(uid).set(docData);

    const safeUser = { ...docData };
    delete safeUser.passwordHash;
    delete safeUser.withdrawPinHash;

    return res.status(201).json({
      success: true,
      uiPosition: 'center',
      message: 'Registration successful! Account create ho gaya hai.',
      userId: uid,
      inviteCode: finalInvite,
      user: safeUser
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/auth/login', express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Phone number aur password daalein'
      });
    }

    const snap = await firestoreDb.collection('users').where('phone', '==', String(phone).trim()).limit(1).get();
    if (snap.empty) {
      return res.status(404).json({
        success: false,
        uiPosition: 'center',
        message: 'User account nahi mila'
      });
    }

    const doc = snap.docs[0];
    const data = doc.data();
    if (data.passwordHash !== digestValue(password)) {
      return res.status(401).json({
        success: false,
        uiPosition: 'center',
        message: 'Password galat hai'
      });
    }

    await firestoreDb.collection('users').doc(doc.id).set({ isActive: true }, { merge: true });

    const safeUser = { id: doc.id, ...data };
    delete safeUser.passwordHash;
    delete safeUser.withdrawPinHash;

    return res.json({
      success: true,
      uiPosition: 'center',
      message: 'Login successful!',
      userId: doc.id,
      user: safeUser
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// PROMO CODES: ADMIN CREATE & USER CLAIM[span_6](start_span)[span_6](end_span)
// ---------------------------------------------------------------------------
app.post('/api/admin/promo/create', verifyAdminToken, express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const {
      code,
      rewardAmount,
      walletField = 'withdrawalBalance',
      expiresAt = null,
      maxClaims = 0,
      allowedUsers = [],
      minVip = 0,
      minInvest = 0
    } = req.body;

    const cleanCode = String(code || '').trim().toUpperCase();
    const reward = Number(rewardAmount || 0);
    if (!cleanCode || reward <= 0) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Promo code aur valid rewardAmount zaroori hai'
      });
    }

    const promoObj = {
      code: cleanCode,
      rewardAmount: reward,
      walletField: walletField === 'chargedBalance' ? 'chargedBalance' : 'withdrawalBalance',
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      maxClaims: Number(maxClaims || 0),
      claimedTotal: 0,
      claimedBy: [],
      allowedUsers: Array.isArray(allowedUsers) ? allowedUsers.map(String) : [],
      minVip: Number(minVip || 0),
      minInvest: Number(minInvest || 0),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await firestoreDb.collection('promo_codes').doc(cleanCode).set(promoObj, { merge: true });

    return res.json({
      success: true,
      uiPosition: 'center',
      message: `Promo code ${cleanCode} create ho gaya`,
      promo: promoObj
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/promo/claim', express.json(), async (req, res) => {
  if (!needDb(res)) return;
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

    let bonusCredited = 0;

    await firestoreDb.runTransaction(async (tx) => {
      const promoRef = firestoreDb.collection('promo_codes').doc(cleanCode);
      const userRef = firestoreDb.collection('users').doc(String(userId));
      const billRef = firestoreDb.collection('bills').doc();

      const promoSnap = await tx.get(promoRef);
      if (!promoSnap.exists) throw new Error('Promo code galat ya maujood nahi hai');

      const p = promoSnap.data();
      if (p.expiresAt && Date.now() > new Date(p.expiresAt).getTime()) {
        throw new Error('Promo code expire ho chuka hai');
      }
      if (Number(p.maxClaims || 0) > 0 && Number(p.claimedTotal || 0) >= Number(p.maxClaims)) {
        throw new Error('Promo code ki claim limit khatam ho gayi hai');
      }

      const claimedBy = Array.isArray(p.claimedBy) ? p.claimedBy : [];
      if (claimedBy.includes(String(userId))) {
        throw new Error('Aap is promo code ko pehle hi claim kar chuke hain');
      }

      const allowedUsers = Array.isArray(p.allowedUsers) ? p.allowedUsers : [];
      if (allowedUsers.length > 0 && !allowedUsers.includes(String(userId))) {
        throw new Error('Yeh promo code sirf specific users ke liye hai');
      }

      const userSnap = await tx.get(userRef);
      const u = userSnap.exists ? userSnap.data() : {};
      if (Number(p.minVip || 0) > 0 && Number(u.vipLevel || 0) < Number(p.minVip)) {
        throw new Error(`Is promo ke liye VIP ${p.minVip} zaroori hai`);
      }
      if (Number(p.minInvest || 0) > 0 && Number(u.totalInvestment || 0) < Number(p.minInvest)) {
        throw new Error(`Is promo ke liye kam se kam ₹${p.minInvest} investment zaroori hai`);
      }

      bonusCredited = Number(p.rewardAmount || 0);
      const field = p.walletField === 'chargedBalance' ? 'chargedBalance' : 'withdrawalBalance';
      const currentVal = Number(u[field] || 0);

      tx.set(userRef, { userId: String(userId), [field]: currentVal + bonusCredited }, { merge: true });
      tx.set(promoRef, { claimedTotal: Number(p.claimedTotal || 0) + 1, claimedBy: [...claimedBy, String(userId)] }, { merge: true });
      tx.set(billRef, {
        userId: String(userId),
        type: 'Promo Claim',
        amount: `+₹${bonusCredited.toFixed(2)}`,
        code: cleanCode,
        status: 'Success',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return res.json({
      success: true,
      uiPosition: 'center',
      message: `Promo ${cleanCode} claim ho gaya! ₹${bonusCredited.toFixed(2)} balance mein add ho gaye.`,
      credited: bonusCredited
    });
  } catch (err) {
    return res.status(400).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// PRODUCTS: ADD/REMOVE, STOCK COPIES & BUY -> VIEW PRODUCT / MY PRODUCT[span_7](start_span)[span_7](end_span)[span_8](start_span)[span_8](end_span)
// ---------------------------------------------------------------------------
app.post('/api/admin/products/add', verifyAdminToken, express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const {
      id,
      name,
      image = '',
      vipLevel = 0,
      price,
      dailyIncome,
      durationDays = 2,
      payoutInterval = 'daily',
      limitedStock = false,
      stockCopies = null
    } = req.body;

    if (!name || Number(price) <= 0) {
      return res.status(400).json({
        success: false,
        uiPosition: 'center',
        message: 'Product name aur valid price zaroori hai'
      });
    }

    const prodId = id ? String(id) : 'ITEM_' + Date.now();
    const isLim = Boolean(limitedStock) || (stockCopies !== null && stockCopies !== undefined && Number(stockCopies) > 0);
    const copies = isLim ? Number(stockCopies || 0) : null;

    const item = {
      id: prodId,
      name: String(name),
      image: String(image),
      vipLevel: Number(vipLevel || 0),
      price: Number(price),
      dailyIncome: Number(dailyIncome || 0),
      durationDays: Number(durationDays || 2),
      payoutInterval: String(payoutInterval || 'daily'),
      limitedStock: isLim,
      availableCopies: copies,
      totalCopies: copies,
      totalBuy: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await firestoreDb.collection('products').doc(prodId).set(item, { merge: true });
    return res.json({ success: true, uiPosition: 'center', message: 'Product add ho gaya', product: item });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/admin/products/remove', verifyAdminToken, express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'productId zaroori hai' });
    }
    await firestoreDb.collection('products').doc(String(productId)).delete();
    return res.json({ success: true, uiPosition: 'center', message: 'Product remove ho gaya' });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.get('/api/products', async (req, res) => {
  if (!needDb(res)) return;
  try {
    const snap = await firestoreDb.collection('products').get();
    const list = snap.docs.map((d) => {
      const p = d.data();
      const outOfStock = Boolean(p.limitedStock) && Number(p.availableCopies || 0) <= 0;
      return {
        id: d.id,
        ...p,
        outOfStock,
        outOfStockMessage: outOfStock ? 'Product khatam ho gaya hai koi or product buy karo thank you' : ''
      };
    });
    return res.json({ success: true, products: list });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/products/buy', express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const { userId, productId, copies = 1 } = req.body;
    const qty = Math.max(1, Number(copies || 1));
    if (!userId || !productId) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'userId aur productId zaroori hai' });
    }

    const orderId = 'ORD_' + Date.now() + '_' + Math.floor(100 + Math.random() * 900);
    let createdOrder = null;
    let updatedVip = 0;

    await firestoreDb.runTransaction(async (tx) => {
      const pRef = firestoreDb.collection('products').doc(String(productId));
      const uRef = firestoreDb.collection('users').doc(String(userId));
      const oRef = firestoreDb.collection('orders').doc(orderId);
      const bRef = firestoreDb.collection('bills').doc();

      const pSnap = await tx.get(pRef);
      if (!pSnap.exists) throw new Error('Product nahi mila');
      const prod = pSnap.data();

      if (prod.limitedStock && Number(prod.availableCopies || 0) < qty) {
        throw new Error('Product khatam ho gaya hai koi or product buy karo thank you');
      }

      const totalCost = Number(prod.price || 0) * qty;
      const uSnap = await tx.get(uRef);
      const uData = uSnap.exists ? uSnap.data() : {};
      const charged = Number(uData.chargedBalance || 0);
      if (charged < totalCost) throw new Error('Charged balance kam hai, pehle recharge karein');

      const newInvestTotal = Number(uData.totalInvestment || 0) + totalCost;
      updatedVip = Math.max(Number(uData.vipLevel || 0), resolveVipTier(newInvestTotal));

      const durationDays = Number(prod.durationDays || 2);
      const payoutDueAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

      const pPatch = { totalBuy: Number(prod.totalBuy || 0) + qty };
      if (prod.limitedStock) {
        pPatch.availableCopies = Number(prod.availableCopies || 0) - qty;
      }

      tx.set(pRef, pPatch, { merge: true });
      tx.set(
        uRef,
        {
          chargedBalance: charged - totalCost,
          totalInvestment: newInvestTotal,
          vipLevel: updatedVip,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      createdOrder = {
        id: orderId,
        orderId,
        userId: String(userId),
        productId: String(productId),
        productName: prod.name || 'Product',
        image: prod.image || '',
        price: totalCost,
        copies: qty,
        dailyIncome: Number(prod.dailyIncome || 0),
        durationDays,
        payoutInterval: prod.payoutInterval || 'daily',
        payoutDueAt,
        settled: false,
        status: 'Active',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };

      tx.set(oRef, createdOrder);
      tx.set(bRef, {
        userId: String(userId),
        type: 'Buy Product',
        amount: `-₹${totalCost.toFixed(2)}`,
        status: 'Success',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return res.json({
      success: true,
      uiPosition: 'center',
      message: 'Product buy ho gaya! View Product ya My Product check karein.',
      orderId,
      vipLevel: updatedVip,
      order: createdOrder,
      actions: [
        { label: 'View Product', target: 'view_product', productId: String(productId) },
        { label: 'My Product', target: 'my_product', orderId }
      ]
    });
  } catch (err) {
    return res.status(400).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.get('/api/my-products/:userId', async (req, res) => {
  if (!needDb(res)) return;
  try {
    const snap = await firestoreDb.collection('orders').where('userId', '==', String(req.params.userId)).get();
    return res.json({ success: true, orders: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/orders/process-due', express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const now = Date.now();
    const snap = await firestoreDb.collection('orders').where('settled', '==', false).get();
    let settledCount = 0;

    for (const doc of snap.docs) {
      const ord = doc.data();
      const due = ord.payoutDueAt ? new Date(ord.payoutDueAt).getTime() : 0;
      if (due > 0 && now >= due) {
        const gain = Number(ord.dailyIncome || 0) * Number(ord.durationDays || 1) * Number(ord.copies || 1);
        await firestoreDb.runTransaction(async (tx) => {
          const oSnap = await tx.get(doc.ref);
          if (!oSnap.exists || oSnap.data().settled) return;

          const uRef = firestoreDb.collection('users').doc(String(ord.userId));
          const uSnap = await tx.get(uRef);
          const curW = uSnap.exists ? Number(uSnap.data().withdrawalBalance || 0) : 0;

          tx.set(uRef, { withdrawalBalance: curW + gain }, { merge: true });
          tx.set(doc.ref, { settled: true, status: 'Completed', payoutAmount: gain }, { merge: true });
        });
        settledCount += 1;
      }
    }

    return res.json({ success: true, uiPosition: 'center', message: `${settledCount} orders settle ho gaye`, settledCount });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// RECHARGE & WITHDRAW (BANK NAME, REAL NAME, BANK ACCOUNT, WITHDRAW PASS)[span_9](start_span)[span_9](end_span)
// ---------------------------------------------------------------------------
async function applyRechargeCredit({ userId, amount, txId }) {
  const txRef = firestoreDb.collection('recharges').doc(String(txId));
  const userRef = firestoreDb.collection('users').doc(String(userId));
  const billRef = firestoreDb.collection('bills').doc();

  await firestoreDb.runTransaction(async (tx) => {
    const existing = await tx.get(txRef);
    if (existing.exists) return;

    const uSnap = await tx.get(userRef);
    const uData = uSnap.exists ? uSnap.data() : {};
    const prevCharged = Number(uData.chargedBalance || 0);
    const prevRecharge = Number(uData.totalRecharge || 0);

    tx.set(
      userRef,
      {
        userId: String(userId),
        chargedBalance: prevCharged + Number(amount),
        totalRecharge: prevRecharge + Number(amount),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    tx.set(txRef, {
      txId: String(txId),
      userId: String(userId),
      amount: Number(amount),
      status: 'Success',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    tx.set(billRef, {
      userId: String(userId),
      type: 'Recharge',
      amount: `+₹${Number(amount).toFixed(2)}`,
      status: 'Success',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
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

    const receipt = 'ORDER_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000);
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
      const rzpJson = await rzpRes.json();
      if (!rzpRes.ok) {
        return res.status(400).json({
          success: false,
          uiPosition: 'center',
          message: rzpJson.error?.description || 'Razorpay order create nahi hua'
        });
      }
      return res.json({
        success: true,
        keyId: process.env.RAZORPAY_KEY_ID,
        orderId: rzpJson.id,
        receipt,
        amount: amt,
        amountPaise: rzpJson.amount,
        currency: rzpJson.currency,
        userId: String(userId)
      });
    }

    return res.json({ success: true, orderId: receipt, userId: String(userId), amount: amt, channel });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/recharge/verify', express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const { userId, amount, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'RAZORPAY_KEY_SECRET set nahi hai' });
    }

    const sig = crypto
      .createHmac('sha256', secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (sig !== razorpay_signature) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'Signature mismatch' });
    }

    await applyRechargeCredit({ userId: String(userId), amount: Number(amount), txId: String(razorpay_payment_id) });
    return res.json({
      success: true,
      uiPosition: 'center',
      message: `₹${Number(amount).toFixed(2)} recharge credit ho gaya!`,
      credited: Number(amount),
      status: 'Success'
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/recharge/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!firestoreDb) return res.status(200).json({ success: false });
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const body = JSON.parse(raw.toString('utf8'));
    if (body.event === 'payment.captured' && body.payload?.payment?.entity) {
      const p = body.payload.payment.entity;
      const uid = p.notes?.userId;
      const amt = Number(p.amount || 0) / 100;
      const txId = p.id || ('PAY_' + Date.now());
      if (uid && amt > 0) {
        await applyRechargeCredit({ userId: String(uid), amount: amt, txId });
      }
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/withdraw/auto-upi', express.json(), async (req, res) => {
  if (!needDb(res)) return;
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
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'userId aur valid amount zaroori hai' });
    }

    const uSnap = await firestoreDb.collection('users').doc(String(userId)).get();
    if (uSnap.exists && uSnap.data().withdrawPinHash) {
      if (!withdrawPassword || digestValue(withdrawPassword) !== uSnap.data().withdrawPinHash) {
        return res.status(401).json({ success: false, uiPosition: 'center', message: 'Withdraw password galat hai' });
      }
    }

    const wdId = 'WD_' + Date.now();
    const payoutRef = 'OUT_' + Date.now();

    await firestoreDb.runTransaction(async (tx) => {
      const uRef = firestoreDb.collection('users').doc(String(userId));
      const wRef = firestoreDb.collection('withdrawals').doc(wdId);
      const bRef = firestoreDb.collection('bills').doc();

      const uDoc = await tx.get(uRef);
      const uData = uDoc.exists ? uDoc.data() : {};
      const curW = Number(uData.withdrawalBalance || 0);
      if (curW < amt) throw new Error('Withdrawal balance kam hai');

      tx.set(
        uRef,
        {
          withdrawalBalance: curW - amt,
          totalWithdraw: Number(uData.totalWithdraw || 0) + amt,
          bankName: bankName ? String(bankName).trim() : (uData.bankName || ''),
          realName: realName ? String(realName).trim() : (uData.realName || ''),
          bankAccount: bankAccount ? String(bankAccount).trim() : (uData.bankAccount || '')
        },
        { merge: true }
      );

      tx.set(wRef, {
        id: wdId,
        userId: String(userId),
        amount: amt,
        bankName: String(bankName || uData.bankName || '').trim(),
        realName: String(realName || uData.realName || '').trim(),
        bankAccount: String(bankAccount || uData.bankAccount || '').trim(),
        upiId: String(upiId || '').trim(),
        status: 'Success',
        payoutRef,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      tx.set(bRef, {
        userId: String(userId),
        type: 'Withdrawal',
        amount: `-₹${amt.toFixed(2)}`,
        status: 'Success',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return res.json({
      success: true,
      uiPosition: 'center',
      message: `₹${amt.toFixed(2)} withdrawal successful!`,
      withdrawalId: wdId,
      payoutRef,
      status: 'Success'
    });
  } catch (err) {
    return res.status(400).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// BLOG PROOF, BANNERS, UID BONUS, SUPPORT & ADMIN OVERVIEW[span_10](start_span)[span_10](end_span)[span_11](start_span)[span_11](end_span)[span_12](start_span)[span_12](end_span)
// ---------------------------------------------------------------------------
app.post('/api/blog/submit', express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const { userId, text = '', images = [] } = req.body;
    const pics = Array.isArray(images) ? images.slice(0, 2) : [];
    if (!userId || (!text && pics.length === 0)) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'Text ya 1-2 images zaroori hain' });
    }

    const postId = 'POST_' + Date.now();
    const post = {
      id: postId,
      userId: String(userId),
      text: String(text),
      images: pics,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await firestoreDb.collection('blog_posts').doc(postId).set(post);
    return res.json({ success: true, uiPosition: 'center', message: 'Blog proof publish ho gaya', post });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.get('/api/blog/list', async (req, res) => {
  if (!needDb(res)) return;
  try {
    const snap = await firestoreDb.collection('blog_posts').get();
    return res.json({
      success: true,
      posts: snap.docs.map((d) => ({ id: d.id, ...d.data(), adminDownloadReady: true }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.get('/api/config', async (req, res) => {
  if (!needDb(res)) return;
  try {
    const [cfg, users] = await Promise.all([
      firestoreDb.collection('platform_settings').doc('global').get(),
      firestoreDb.collection('users').get()
    ]);
    const activeCount = users.docs.filter((d) => Boolean(d.data().isActive)).length;
    return res.json({
      success: true,
      activeUsersCount: activeCount,
      totalUsersCount: users.size,
      settings: cfg.exists
        ? cfg.data()
        : { popupBanner: { image: '', text: '', link: '' }, homeBanner: { image: '', text: '', link: '' } }
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/admin/config', verifyAdminToken, express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const { popupBanner, homeBanner, ...others } = req.body;
    await firestoreDb.collection('platform_settings').doc('global').set(
      {
        ...others,
        ...(popupBanner ? { popupBanner } : {}),
        ...(homeBanner ? { homeBanner } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    return res.json({ success: true, uiPosition: 'center', message: 'Banner/Settings update ho gaye' });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/admin/bonus/uid', verifyAdminToken, express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const { uid, amount, walletField = 'withdrawalBalance' } = req.body;
    const target = String(uid || '').trim();
    const amt = Number(amount || 0);
    if (!target || amt <= 0) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'Valid UID aur amount zaroori hai' });
    }

    const field = walletField === 'chargedBalance' ? 'chargedBalance' : 'withdrawalBalance';
    await firestoreDb.runTransaction(async (tx) => {
      const uRef = firestoreDb.collection('users').doc(target);
      const bRef = firestoreDb.collection('bills').doc();
      const uSnap = await tx.get(uRef);
      const cur = uSnap.exists ? Number(uSnap.data()[field] || 0) : 0;
      tx.set(uRef, { userId: target, [field]: cur + amt }, { merge: true });
      tx.set(bRef, {
        userId: target,
        type: 'UID Bonus',
        amount: `+₹${amt.toFixed(2)}`,
        status: 'Success',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return res.json({ success: true, uiPosition: 'center', message: `UID ${target} ko ₹${amt.toFixed(2)} bonus bhej diya` });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/service/ticket', express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const { userId, message } = req.body;
    if (!userId || !message) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'userId aur message zaroori hai' });
    }
    const ticketId = 'SUP_' + Date.now();
    const ticket = {
      id: ticketId,
      userId: String(userId),
      message: String(message),
      adminReply: '',
      status: 'Open',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await firestoreDb.collection('tickets').doc(ticketId).set(ticket);
    return res.json({ success: true, uiPosition: 'center', message: 'Support ticket submit ho gaya', ticket });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.post('/api/admin/service/reply', verifyAdminToken, express.json(), async (req, res) => {
  if (!needDb(res)) return;
  try {
    const { ticketId, reply } = req.body;
    if (!ticketId || !reply) {
      return res.status(400).json({ success: false, uiPosition: 'center', message: 'ticketId aur reply zaroori hai' });
    }
    await firestoreDb.collection('tickets').doc(String(ticketId)).set(
      { adminReply: String(reply), status: 'Answered', repliedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return res.json({ success: true, uiPosition: 'center', message: 'Reply send ho gaya' });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.get('/api/service/tickets/:userId', async (req, res) => {
  if (!needDb(res)) return;
  try {
    const snap = await firestoreDb.collection('tickets').where('userId', '==', String(req.params.userId)).get();
    return res.json({ success: true, tickets: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

app.get('/api/admin/overview', verifyAdminToken, async (req, res) => {
  if (!needDb(res)) return;
  try {
    const [usersSnap, wdSnap, ordSnap, rcSnap] = await Promise.all([
      firestoreDb.collection('users').get(),
      firestoreDb.collection('withdrawals').get(),
      firestoreDb.collection('orders').get(),
      firestoreDb.collection('recharges').get()
    ]);

    let totalChargedBalance = 0;
    let totalWithdrawalBalance = 0;
    let totalInvestmentAmount = 0;
    let totalRechargeAmount = 0;
    let totalWithdrawAmount = 0;

    const users = usersSnap.docs.map((d) => {
      const u = d.data();
      totalChargedBalance += Number(u.chargedBalance || 0);
      totalWithdrawalBalance += Number(u.withdrawalBalance || 0);
      totalInvestmentAmount += Number(u.totalInvestment || 0);
      const item = { id: d.id, ...u };
      delete item.passwordHash;
      delete item.withdrawPinHash;
      return item;
    });

    rcSnap.forEach((d) => {
      totalRechargeAmount += Number(d.data().amount || 0);
    });

    wdSnap.forEach((d) => {
      totalWithdrawAmount += Number(d.data().amount || 0);
    });

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
      investments: ordSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      withdrawals: wdSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, uiPosition: 'center', message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ProInvast API v2 running on port ${PORT}`);
});
