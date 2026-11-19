const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(cors());

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'MY_SUPER_ADMIN_SECRET_123';

const FIREBASE_PROJECT_ID =
    process.env.FIREBASE_PROJECT_ID || 'proinvast';

const FIREBASE_CLIENT_EMAIL =
    process.env.FIREBASE_CLIENT_EMAIL ||
    'firebase-adminsdk-fbsvc@proinvast.iam.gserviceaccount.com';

const rawPrivateKey =
    process.env.FIREBASE_PRIVATE_KEY ||
    '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDVm+EhqlaElKW0\nKQ1oTQEzLWwZc4yKSI+2uUpDxLJTWNjzDXbnScXGCO1sRJg0iQMt5AVFOw4ODmvY\n7pzDprsK0wxfiaT9fbT4GpRjNUjG9KIqKdj8d8E47Jaew9woCwdmMjz/pDN/qDzc\n1XW74HhAqoIfkm/tr/0V+nLoudpQ4HpT/iKGnlEx2xaYnPY8CcuuvDZbFpE+eMF1\nG1Oq9RBxnkvsuX/w3RmCkcGHlrGsXS1d7tIjUYrIxnAIgEY1tuGRHoynu08MsVQ3\n+LDyMdrEg36Y3FsO5IxaLZvhzLeIPjcIUaSZABFw0aTqh9hALdLMkxpBUUKEmCB7\nlaFECGmdAgMBAAECggEAUAxf1D1gucN4y2h8+UKuOe8CLRGDr8icbqXGQloiV6Ca\ngI7hqbAYOOvciW+1OC7GLbrfDMAiNrtJyBw3TAyd2GMZpm3PEh27JSTUyc7MjJ5d\nbP6MraP1GW9zzGBqjuj/J1mZSVXP5L13vWwS+EqY1ebv54P5hPGoHsXhrPwE57xg\nIma2RSwPwSNdeaQbHpPOb6jyTMWLyd+CJtmqxGC5sqcM2BPvumq1AysrNOIHSFIJ\nFSPa1pSS1ILB6kgmsjdh1ktMUVfWr0A9jsulH9jVH2gDMhEBQeKQaLScOXSw/FNU\n8sHxlVGlPzskq43ad28SMhW0d/mcVQpzSM/w2018kwKBgQD3IyRdQjpTAWMzQzpc\nAOK04UIdul8KGMG8POb5za3XB0pnPRIPS1ooMW+dhJp95FUyltsRX38LMmyOUNwl\nR22O1/sIRJ2ePhXDX4EKhrL13o47E6h9M/SoXbX0T0yu9uTrg5idPpIy+7QLCbIe\n3nyyBU++9F4xBa/nVLiUM5RmuwKBgQDdRO2hjo/bQe6SGL1LyoPtY8g+KpZNRqaO\nUtAS+6R2kn94L1Si7ourAWFIh8pmx93FHWLBEWFluFjTEQSllBrynCYsi6Q9MSoJ\n19Wqyu9pps4MgjQmX7HZ31fuTns75iBaVbKRVXG8R5IQ02tbC2Db+Fq512KmhXNC\n2SnDIcNnhwKBgEtvKpZctLjJX6IyDwouKwTTDP9N99x5Ggl+/XGaWkmcLBW/Clgo\nw+gozszhwNZUb7z1VwDCiWC9j20ROWEXoFVNj45Cg2ndwX7VE+pGmzF5MSjPI0q0\nJSWPFQ7xdZKiQdWxYU/93Vo6ggYse3X4q08bV/ANXwLPnZWawoxaAh4pAoGBANsX\ncSRTAOZddlh63pS5RcA82P2VNZX2qtyp6xWgzcwKauUaGHfsM6dzilxC+IqkxFZ1\nLl91UjdiPbFgXHWHHNe0/aeF7W4ZzEJK0Gp43m6Cl+uS0QheIMBWgb6ZPzSkPMy1\npkZ5kFCZnWvDq71Omu20EEGLn0a7RNGgLdXlDJLpAoGAMC5aEycItU7MjTmjn2KA\nc1SmYRjIy349UG5A1cwXmSWW5ELiYCiyMYvkof7AYpUBIgTxC82r1cKnclgtxbDr\n9GwP6c78GUpdk5pLuiQW7WRwK8oSDgKBOo4sEDLS4qX0SCKLUTAJBikd1ZlXt4Qn\njZCEsfM6/Js8HHY+7kRRzeI=\n-----END PRIVATE KEY-----\n';

const FIREBASE_PRIVATE_KEY = rawPrivateKey.replace(/\\n/g, '\n');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: FIREBASE_PROJECT_ID,
            clientEmail: FIREBASE_CLIENT_EMAIL,
            privateKey: FIREBASE_PRIVATE_KEY
        })
    });
}

const db = admin.firestore();

const COL = {
    USERS: 'users',
    PRODUCTS: 'products',
    INVESTMENTS: 'investments',
    RECHARGES: 'recharges',
    WITHDRAWALS: 'withdrawals',
    BILLS: 'bills',
    PROMOS: 'promo_codes',
    PROMO_CLAIMS: 'promo_claims',
    CONFIG: 'app_config',
    PAGES: 'custom_pages',
    SPIN_LOGS: 'spin_logs',
    BLOG_POSTS: 'blog_posts'
};

function getUserIdFromHeader(req) {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token.startsWith('token_')) return null;
    return token.replace('token_', '').trim();
}

function requireAdmin(req, res, next) {
    const secret = req.headers['admin-secret'] || req.query.adminSecret;
    if (secret !== ADMIN_SECRET) {
        return res.status(403).json({ success: false, message: 'Unauthorized admin secret' });
    }
    next();
}

async function addBillEntry(userId, uid, type, amountStr) {
    await db.collection(COL.BILLS).add({
        user_id: userId,
        uid: uid || null,
        type,
        amount: amountStr,
        created_at: new Date().toISOString()
    });
}

async function generateUnique6DigitUid() {
    for (let i = 0; i < 15; i++) {
        const candidate = String(Math.floor(100000 + Math.random() * 900000));
        const snap = await db.collection(COL.USERS).where('uid', '==', candidate).get();
        if (snap.empty) return candidate;
    }
    return String(Date.now()).slice(-6);
}

app.get('/', (req, res) => {
    res.json({ success: true, message: 'GrowthWave Capital Firebase API is running!' });
});

app.get('/api/config', async (req, res) => {
    try {
        const [cfgDoc, pagesSnap] = await Promise.all([
            db.collection(COL.CONFIG).doc('global').get(),
            db.collection(COL.PAGES).get()
        ]);

        const defaultConfig = {
            brandName: 'GrowthWave Capital',
            telegramLink: 'https://t.me/GrowthWaveCapital',
            upiId: 'ansari.mr.240@superyes',
            bannerTitle: 'Smart Maritime & Energy Infrastructure',
            bannerSubtitle: 'Earn stable daily dividends backed by global industrial assets.',
            bannerTag: 'Heavy Industries Fund',
            bannerImage: '',
            popupEnabled: false,
            popupTitle: 'Welcome to GrowthWave Capital',
            popupText: 'Register now and get ₹40 welcome bonus plus daily rewards!',
            popupImage: ''
        };

        const config = cfgDoc.exists ? { ...defaultConfig, ...cfgDoc.data() } : defaultConfig;
        const pages = pagesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        res.json({ success: true, config, pages });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/products', async (req, res) => {
    try {
        const snap = await db.collection(COL.PRODUCTS).get();
        const products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(products);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Public Blog Posts (Empty until real user uploads)
app.get('/api/blog', async (req, res) => {
    try {
        const snap = await db.collection(COL.BLOG_POSTS).get();
        const posts = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        res.json({ success: true, posts });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Upload Real User Blog Proof Post
app.post('/api/blog', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Please login to post proof' });

        const { message, payoutAmount, imageBase64, imageName } = req.body;
        if (!message && !imageBase64) {
            return res.status(400).json({ success: false, message: 'Write a message or attach payment proof image' });
        }

        const userDoc = await db.collection(COL.USERS).doc(userId).get();
        const uData = userDoc.exists ? userDoc.data() : {};
        const nowIso = new Date().toISOString();

        const postData = {
            user_id: userId,
            uid: uData.uid || userId.slice(0, 6),
            user_name: uData.nickname || 'Investor',
            message: String(message || 'Payment received proof').trim(),
            payout_amount: payoutAmount ? String(payoutAmount).trim() : '',
            image_data: imageBase64 || '',
            image_name: imageName || 'proof.png',
            created_at: nowIso
        };

        const ref = await db.collection(COL.BLOG_POSTS).add(postData);
        res.json({ success: true, id: ref.id, post: { id: ref.id, ...postData } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Register with Unique 6-Digit UID + ₹40 Bonus
app.post('/api/auth/register', async (req, res) => {
    try {
        const { phone, password, nickname, inviteCode } = req.body;
        if (!phone || !password) {
            return res.status(400).json({ success: false, message: 'Phone and password required' });
        }

        const cleanPhone = String(phone).trim();
        const existing = await db.collection(COL.USERS)
            .where('phone', '==', cleanPhone)
            .get();

        if (!existing.empty) {
            return res.status(400).json({ success: false, message: 'Phone number already registered' });
        }

        const uid = await generateUnique6DigitUid();
        const newInviteCode = 'GW' + uid;
        const nowIso = new Date().toISOString();

        const userData = {
            uid,
            phone: cleanPhone,
            password: String(password),
            nickname: (nickname && String(nickname).trim()) || 'Investor',
            charged_balance: 40,
            withdrawal_balance: 0,
            product_revenue: 0,
            vip_level: 0,
            vip_price: 0,
            vip_expires_at: null,
            spins: 0,
            invite_code: newInviteCode,
            invited_by: inviteCode ? String(inviteCode).trim().toUpperCase() : null,
            created_at: nowIso
        };

        const ref = await db.collection(COL.USERS).add(userData);
        await addBillEntry(ref.id, uid, 'Other', '+₹40.00');

        res.json({
            success: true,
            message: 'Registered successfully! ₹40 bonus credited.',
            token: 'token_' + ref.id,
            user: { id: ref.id, ...userData }
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// Login (Backfills 6-digit UID if older account lacked one)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const cleanPhone = String(phone || '').trim();
        const snap = await db.collection(COL.USERS)
            .where('phone', '==', cleanPhone)
            .where('password', '==', String(password || ''))
            .get();

        if (snap.empty) {
            return res.status(401).json({ success: false, message: 'Invalid phone or password' });
        }

        const doc = snap.docs[0];
        const raw = doc.data();
        let uid = raw.uid;
        if (!uid) {
            uid = await generateUnique6DigitUid();
            await doc.ref.update({ uid });
        }

        const user = { id: doc.id, ...raw, uid };
        res.json({ success: true, token: 'token_' + doc.id, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/user/profile', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const docRef = db.collection(COL.USERS).doc(userId);
        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({ success: false, message: 'User not found' });

        const user = doc.data();
        let uid = user.uid;
        if (!uid) {
            uid = await generateUnique6DigitUid();
            await docRef.update({ uid });
        }

        const [invSnap, billSnap, winSnap, refSnap] = await Promise.all([
            db.collection(COL.INVESTMENTS).where('user_id', '==', userId).get(),
            db.collection(COL.BILLS).where('user_id', '==', userId).get(),
            db.collection(COL.SPIN_LOGS).where('user_id', '==', userId).get(),
            user.invite_code
                ? db.collection(COL.USERS).where('invited_by', '==', user.invite_code).get()
                : Promise.resolve({ docs: [] })
        ]);

        const orders = invSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

        const bills = billSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

        const wins = winSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

        const invitedUsers = refSnap.docs.map(d => ({
            id: d.id,
            uid: d.data().uid || d.id.slice(0, 6),
            phone: d.data().phone,
            nickname: d.data().nickname,
            created_at: d.data().created_at
        }));

        res.json({
            success: true,
            id: doc.id,
            uid,
            phone: user.phone,
            nickname: user.nickname,
            inviteCode: user.invite_code,
            chargedBalance: Number(user.charged_balance || 0),
            withdrawalBalance: Number(user.withdrawal_balance || 0),
            productRevenue: Number(user.product_revenue || 0),
            vipLevel: Number(user.vip_level || 0),
            vipPrice: Number(user.vip_price || 0),
            vipExpiresAt: user.vip_expires_at || null,
            spins: Number(user.spins || 0),
            invitedCount: invitedUsers.length,
            invitedUsers,
            orders,
            bills,
            wins
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Buy Investment (Transaction-Safe + Spin to Buyer & Inviter)
app.post('/api/investment/buy', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const { packageName, price, dailyEarnings, durationDays, shares } = req.body;
        const unitCount = Math.max(1, Number(shares || 1));
        const cost = Number(price) * unitCount;

        if (!cost || cost <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid investment amount' });
        }

        const userRef = db.collection(COL.USERS).doc(userId);
        let userUid = null;
        let invitedBy = null;
        let newSpins = 0;

        await db.runTransaction(async (t) => {
            const uDoc = await t.get(userRef);
            if (!uDoc.exists) throw new Error('User not found');
            const uData = uDoc.data();
            userUid = uData.uid || userId.slice(0, 6);
            invitedBy = uData.invited_by || null;
            const currentBalance = Number(uData.charged_balance || 0);
            if (currentBalance < cost) throw new Error('Insufficient charged balance');

            newSpins = Number(uData.spins || 0) + 1;
            t.update(userRef, {
                charged_balance: currentBalance - cost,
                spins: newSpins
            });
        });

        if (invitedBy) {
            const invSnap = await db.collection(COL.USERS).where('invite_code', '==', String(invitedBy)).get();
            if (!invSnap.empty) {
                const invRef = invSnap.docs[0].ref;
                await db.runTransaction(async (t) => {
                    const iDoc = await t.get(invRef);
                    if (iDoc.exists) {
                        t.update(invRef, { spins: Number(iDoc.data().spins || 0) + 1 });
                    }
                });
            }
        }

        await db.collection(COL.INVESTMENTS).add({
            user_id: userId,
            uid: userUid,
            package_name: packageName || 'Investment Plan',
            shares: unitCount,
            price: cost,
            daily_earnings: Number(dailyEarnings || 0) * unitCount,
            duration_days: Number(durationDays || 45),
            status: 'In progress',
            generated: 0,
            created_at: new Date().toISOString()
        });

        await addBillEntry(userId, userUid, 'Buy Product', `-₹${cost.toFixed(2)}`);

        res.json({
            success: true,
            message: 'Investment order placed! +1 Lucky Spin unlocked.',
            spins: newSpins
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// Spin Wheel Claim (Only 8, 18, or 29 can be won)
app.post('/api/spin/claim', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const allowedAmounts = [8, 18, 29];
        const wonAmount = allowedAmounts[Math.floor(Math.random() * allowedAmounts.length)];
        const wonLabel = `₹${wonAmount}`;

        const userRef = db.collection(COL.USERS).doc(userId);
        let userUid = null;
        let spinsLeft = 0;
        let nextWithdraw = 0;

        await db.runTransaction(async (t) => {
            const uDoc = await t.get(userRef);
            if (!uDoc.exists) throw new Error('User not found');
            const uData = uDoc.data();
            userUid = uData.uid || userId.slice(0, 6);
            const curSpins = Number(uData.spins || 0);
            if (curSpins <= 0) throw new Error('No spins remaining');

            spinsLeft = curSpins - 1;
            nextWithdraw = Number(uData.withdrawal_balance || 0) + wonAmount;

            t.update(userRef, {
                spins: spinsLeft,
                withdrawal_balance: nextWithdraw
            });
        });

        await db.collection(COL.SPIN_LOGS).add({
            user_id: userId,
            uid: userUid,
            prize: wonLabel,
            amount: wonAmount,
            created_at: new Date().toISOString()
        });

        await addBillEntry(userId, userUid, 'Other', `+₹${wonAmount.toFixed(2)}`);

        res.json({
            success: true,
            won: { label: wonLabel, amount: wonAmount },
            spinsLeft,
            withdrawalBalance: nextWithdraw
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// Redeem Promo Code (Transaction-Safe)
app.post('/api/promo/redeem', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const code = String(req.body.code || '').trim().toUpperCase();
        if (!code) return res.status(400).json({ success: false, message: 'Enter a promo code' });

        const promoSnap = await db.collection(COL.PROMOS).where('code', '==', code).get();
        if (promoSnap.empty) {
            return res.status(404).json({ success: false, message: 'Invalid or expired promo code' });
        }

        const promo = promoSnap.docs[0].data();
        if (promo.expires_at && new Date(promo.expires_at).getTime() < Date.now()) {
            return res.status(400).json({ success: false, message: 'Promo code has expired' });
        }

        const claimedSnap = await db.collection(COL.PROMO_CLAIMS)
            .where('user_id', '==', userId)
            .where('code', '==', code)
            .get();

        if (!claimedSnap.empty) {
            return res.status(400).json({ success: false, message: 'You have already claimed this promo code' });
        }

        const reward = Number(promo.reward || 0);
        const userRef = db.collection(COL.USERS).doc(userId);
        let userUid = null;
        let nextCharged = 0;

        await db.runTransaction(async (t) => {
            const uDoc = await t.get(userRef);
            if (!uDoc.exists) throw new Error('User not found');
            const uData = uDoc.data();
            userUid = uData.uid || userId.slice(0, 6);
            nextCharged = Number(uData.charged_balance || 0) + reward;
            t.update(userRef, { charged_balance: nextCharged });
        });

        await db.collection(COL.PROMO_CLAIMS).add({
            user_id: userId,
            uid: userUid,
            code,
            reward,
            created_at: new Date().toISOString()
        });

        await addBillEntry(userId, userUid, 'Task Rewards', `+₹${reward.toFixed(2)}`);

        res.json({
            success: true,
            message: `Promo code ${code} claimed! +₹${reward} added to Charged Balance.`,
            chargedBalance: nextCharged
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// Recharge Submit
app.post('/api/recharge/submit', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const { amount, channel, utr } = req.body;
        const amt = Number(amount);
        if (!amt || amt <= 0) {
            return res.status(400).json({ success: false, message: 'Enter valid recharge amount' });
        }

        const uDoc = await db.collection(COL.USERS).doc(userId).get();
        const userUid = uDoc.exists ? (uDoc.data().uid || userId.slice(0, 6)) : userId.slice(0, 6);

        const ref = await db.collection(COL.RECHARGES).add({
            user_id: userId,
            uid: userUid,
            amount: amt,
            channel: channel || 'PaytmPay',
            utr: String(utr || '').trim(),
            status: 'pending',
            created_at: new Date().toISOString()
        });

        res.json({ success: true, id: ref.id, message: 'Recharge UTR submitted for admin approval!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Withdrawal Submit (Transaction-Safe + Full Bank Details)
app.post('/api/withdrawal/submit', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const { amount, channel, holderName, bankName, bankCode, accountNumber } = req.body;
        const amt = Number(amount);

        if (amt < 110 || amt > 50000) {
            return res.status(400).json({ success: false, message: 'Withdrawal must be between ₹110 and ₹50,000' });
        }

        const userRef = db.collection(COL.USERS).doc(userId);
        let userUid = null;

        await db.runTransaction(async (t) => {
            const uDoc = await t.get(userRef);
            if (!uDoc.exists) throw new Error('User not found');
            const uData = uDoc.data();
            userUid = uData.uid || userId.slice(0, 6);
            const withdrawBal = Number(uData.withdrawal_balance || 0);
            if (withdrawBal < amt) throw new Error('Insufficient withdrawal balance');
            t.update(userRef, { withdrawal_balance: withdrawBal - amt });
        });

        const ref = await db.collection(COL.WITHDRAWALS).add({
            user_id: userId,
            uid: userUid,
            amount: amt,
            channel: channel || 'BankPay',
            holder_name: String(holderName || '').trim(),
            bank_name: String(bankName || '').trim(),
            bank_code: String(bankCode || '').trim(),
            account_number: String(accountNumber || '').trim(),
            status: 'pending',
            created_at: new Date().toISOString()
        });

        await addBillEntry(userId, userUid, 'Withdrawal', `-₹${amt.toFixed(2)}`);

        res.json({ success: true, id: ref.id, message: 'Withdrawal request submitted with bank details!' });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// =========================================================
// ADMIN ENDPOINTS
// =========================================================

app.get('/api/admin/data', requireAdmin, async (req, res) => {
    try {
        const [usersSnap, rechargesSnap, withdrawalsSnap, productsSnap, promosSnap, pagesSnap, blogSnap, cfgDoc] = await Promise.all([
            db.collection(COL.USERS).get(),
            db.collection(COL.RECHARGES).get(),
            db.collection(COL.WITHDRAWALS).get(),
            db.collection(COL.PRODUCTS).get(),
            db.collection(COL.PROMOS).get(),
            db.collection(COL.PAGES).get(),
            db.collection(COL.BLOG_POSTS).get(),
            db.collection(COL.CONFIG).doc('global').get()
        ]);

        res.json({
            success: true,
            users: usersSnap.docs.map(d => ({ id: d.id, ...d.data(), uid: d.data().uid || d.id.slice(0, 6) })),
            recharges: rechargesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            withdrawals: withdrawalsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            products: productsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            promos: promosSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            pages: pagesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            blogPosts: blogSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            config: cfgDoc.exists ? cfgDoc.data() : {}
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin Adjust User Balance (+/-)
app.post('/api/admin/user/balance', requireAdmin, async (req, res) => {
    try {
        const { userId, walletType, mode, amount } = req.body;
        const amt = Number(amount);
        if (!userId || !amt || amt <= 0) {
            return res.status(400).json({ success: false, message: 'Valid userId and positive amount required' });
        }

        const field = walletType === 'withdrawal' ? 'withdrawal_balance' : 'charged_balance';
        const delta = mode === 'minus' ? -amt : amt;
        const userRef = db.collection(COL.USERS).doc(String(userId).trim());
        let userUid = null;
        let nextVal = 0;

        await db.runTransaction(async (t) => {
            const uDoc = await t.get(userRef);
            if (!uDoc.exists) throw new Error('User not found');
            const uData = uDoc.data();
            userUid = uData.uid || userId.slice(0, 6);
            nextVal = Math.max(0, Number(uData[field] || 0) + delta);
            t.update(userRef, { [field]: nextVal });
        });

        await addBillEntry(
            String(userId).trim(),
            userUid,
            'Other',
            `${delta >= 0 ? '+' : '-'}₹${amt.toFixed(2)}`
        );

        res.json({ success: true, message: `Balance updated (${mode === 'minus' ? '-' : '+'}₹${amt})`, balance: nextVal });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
    try {
        const { name, category, vip, price, daily_earnings, duration_days, image_url, tag } = req.body;
        if (!name || !price) {
            return res.status(400).json({ success: false, message: 'Product name and price required' });
        }
        const docData = {
            name: String(name).trim(),
            category: category || 'Steady',
            vip: vip || 'VIP1',
            tag: tag || 'Maritime',
            price: Number(price),
            daily_earnings: Number(daily_earnings || 0),
            duration_days: Number(duration_days || 45),
            image_url: String(image_url || '').trim(),
            created_at: new Date().toISOString()
        };
        const ref = await db.collection(COL.PRODUCTS).add(docData);
        res.json({ success: true, id: ref.id, product: { id: ref.id, ...docData } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, category, vip, price, daily_earnings, duration_days, image_url, tag } = req.body;
        const updateData = {};
        if (name !== undefined) updateData.name = String(name).trim();
        if (category !== undefined) updateData.category = category;
        if (vip !== undefined) updateData.vip = vip;
        if (tag !== undefined) updateData.tag = tag;
        if (price !== undefined) updateData.price = Number(price);
        if (daily_earnings !== undefined) updateData.daily_earnings = Number(daily_earnings);
        if (duration_days !== undefined) updateData.duration_days = Number(duration_days);
        if (image_url !== undefined) updateData.image_url = String(image_url).trim();

        await db.collection(COL.PRODUCTS).doc(id).update(updateData);
        res.json({ success: true, message: 'Product updated!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
    try {
        await db.collection(COL.PRODUCTS).doc(req.params.id).delete();
        res.json({ success: true, message: 'Product deleted!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Recharge Approve / Reject (Transaction-Safe)
app.post('/api/admin/recharge/review', requireAdmin, async (req, res) => {
    try {
        const { id, action } = req.body;
        if (!id || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid id or action' });
        }

        const recRef = db.collection(COL.RECHARGES).doc(id);
        let recData = null;

        await db.runTransaction(async (t) => {
            const recDoc = await t.get(recRef);
            if (!recDoc.exists) throw new Error('Recharge not found');
            recData = recDoc.data();
            if (recData.status !== 'pending') throw new Error(`Already ${recData.status}`);

            if (action === 'approve') {
                const userRef = db.collection(COL.USERS).doc(recData.user_id);
                const uDoc = await t.get(userRef);
                if (uDoc.exists) {
                    const nextBal = Number(uDoc.data().charged_balance || 0) + Number(recData.amount || 0);
                    t.update(userRef, { charged_balance: nextBal });
                }
                t.update(recRef, { status: 'approved', reviewed_at: new Date().toISOString() });
            } else {
                t.update(recRef, { status: 'rejected', reviewed_at: new Date().toISOString() });
            }
        });

        if (action === 'approve' && recData) {
            await addBillEntry(
                recData.user_id,
                recData.uid || null,
                'Recharge',
                `+₹${Number(recData.amount || 0).toFixed(2)}`
            );
        }

        res.json({ success: true, message: `Recharge ${action}d successfully!` });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// Withdrawal Approve / Reject (Transaction-Safe + Refund on Reject)
app.post('/api/admin/withdrawal/review', requireAdmin, async (req, res) => {
    try {
        const { id, action } = req.body;
        if (!id || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid id or action' });
        }

        const wdRef = db.collection(COL.WITHDRAWALS).doc(id);
        let wdData = null;

        await db.runTransaction(async (t) => {
            const wdDoc = await t.get(wdRef);
            if (!wdDoc.exists) throw new Error('Withdrawal not found');
            wdData = wdDoc.data();
            if (wdData.status !== 'pending') throw new Error(`Already ${wdData.status}`);

            if (action === 'reject') {
                const userRef = db.collection(COL.USERS).doc(wdData.user_id);
                const uDoc = await t.get(userRef);
                if (uDoc.exists) {
                    const refundBal = Number(uDoc.data().withdrawal_balance || 0) + Number(wdData.amount || 0);
                    t.update(userRef, { withdrawal_balance: refundBal });
                }
                t.update(wdRef, { status: 'rejected', reviewed_at: new Date().toISOString() });
            } else {
                t.update(wdRef, { status: 'approved', reviewed_at: new Date().toISOString() });
            }
        });

        if (action === 'reject' && wdData) {
            await addBillEntry(
                wdData.user_id,
                wdData.uid || null,
                'Other',
                `+₹${Number(wdData.amount || 0).toFixed(2)}`
            );
        }

        res.json({ success: true, message: `Withdrawal ${action}d successfully!` });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/promo/create', requireAdmin, async (req, res) => {
    try {
        const { code, reward, expires_at } = req.body;
        const cleanCode = String(code || '').trim().toUpperCase();
        if (!cleanCode || !Number(reward)) {
            return res.status(400).json({ success: false, message: 'Promo code and reward amount required' });
        }

        const docData = {
            code: cleanCode,
            reward: Number(reward),
            expires_at: expires_at || null,
            created_at: new Date().toISOString()
        };
        const ref = await db.collection(COL.PROMOS).add(docData);
        res.json({ success: true, id: ref.id, promo: { id: ref.id, ...docData } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/user/vip', requireAdmin, async (req, res) => {
    try {
        const { userId, vip_level, vip_price, vip_expires_at, spins } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: 'User ID required' });

        const updateData = {};
        if (vip_level !== undefined) updateData.vip_level = Number(vip_level);
        if (vip_price !== undefined) updateData.vip_price = Number(vip_price);
        if (vip_expires_at !== undefined) updateData.vip_expires_at = vip_expires_at || null;
        if (spins !== undefined) updateData.spins = Number(spins);

        await db.collection(COL.USERS).doc(String(userId).trim()).update(updateData);
        res.json({ success: true, message: 'User VIP & settings updated!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/config', requireAdmin, async (req, res) => {
    try {
        const payload = {
            ...req.body,
            updated_at: new Date().toISOString()
        };
        await db.collection(COL.CONFIG).doc('global').set(payload, { merge: true });
        res.json({ success: true, message: 'Banners & popup settings saved!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin/pages', requireAdmin, async (req, res) => {
    try {
        const { title, featureNote, htmlCode } = req.body;
        if (!title) return res.status(400).json({ success: false, message: 'Page title required' });

        const pageData = {
            title: String(title).trim(),
            featureNote: String(featureNote || '').trim(),
            htmlCode: String(htmlCode || ''),
            created_at: new Date().toISOString()
        };
        const ref = await db.collection(COL.PAGES).add(pageData);
        res.json({ success: true, id: ref.id, page: { id: ref.id, ...pageData } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/admin/pages/:id', requireAdmin, async (req, res) => {
    try {
        await db.collection(COL.PAGES).doc(req.params.id).delete();
        res.json({ success: true, message: 'Custom page deleted!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GrowthWave Firebase Server running on port ${PORT}`));
