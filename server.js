const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(express.json({ limit: '10mb' }));
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
    SPIN_LOGS: 'spin_logs'
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

async function addBillEntry(userId, type, amountStr) {
    await db.collection(COL.BILLS).add({
        user_id: userId,
        type,
        amount: amountStr,
        created_at: new Date().toISOString()
    });
}

// Health Check
app.get('/', (req, res) => {
    res.json({ success: true, message: 'GrowthWave Capital Firebase API is running!' });
});

// Public App Config (Banners, Popup, Custom Pages)
app.get('/api/config', async (req, res) => {
    try {
        const [cfgDoc, pagesSnap] = await Promise.all([
            db.collection(COL.CONFIG).doc('global').get(),
            db.collection(COL.PAGES).get()
        ]);

        const defaultConfig = {
            brandName: 'GrowthWave Capital',
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

// Products List
app.get('/api/products', async (req, res) => {
    try {
        const snap = await db.collection(COL.PRODUCTS).get();
        const products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(products);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Register (₹40 Bonus + Fresh New User State)
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

        const newInviteCode = 'GW' + Math.floor(10000 + Math.random() * 90000);
        const nowIso = new Date().toISOString();

        const userData = {
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
        await addBillEntry(ref.id, 'Other', '+₹40.00');

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

// Login
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
        const user = { id: doc.id, ...doc.data() };
        res.json({ success: true, token: 'token_' + doc.id, user });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// User Profile + Fresh Orders, Bills, Spins & Team Count
app.get('/api/user/profile', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const doc = await db.collection(COL.USERS).doc(userId).get();
        if (!doc.exists) return res.status(404).json({ success: false, message: 'User not found' });

        const user = doc.data();
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
            phone: d.data().phone,
            nickname: d.data().nickname,
            created_at: d.data().created_at
        }));

        res.json({
            success: true,
            id: doc.id,
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

// Buy Investment (+1 Spin Reward + Direct Inviter Spin)
app.post('/api/investment/buy', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const { packageName, price, dailyEarnings, durationDays, shares } = req.body;
        const userRef = db.collection(COL.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) return res.status(404).json({ success: false, message: 'User not found' });

        const uData = userDoc.data();
        const currentBalance = Number(uData.charged_balance || 0);
        const unitCount = Math.max(1, Number(shares || 1));
        const cost = Number(price) * unitCount;

        if (!cost || cost <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid investment amount' });
        }

        if (currentBalance < cost) {
            return res.status(400).json({ success: false, message: 'Insufficient charged balance' });
        }

        const newSpins = Number(uData.spins || 0) + 1;
        await userRef.update({
            charged_balance: currentBalance - cost,
            spins: newSpins
        });

        // Grant 1 spin to direct inviter when user buys a product
        if (uData.invited_by) {
            const inviterSnap = await db.collection(COL.USERS)
                .where('invite_code', '==', String(uData.invited_by))
                .get();
            if (!inviterSnap.empty) {
                const invDoc = inviterSnap.docs[0];
                await invDoc.ref.update({
                    spins: Number(invDoc.data().spins || 0) + 1
                });
            }
        }

        const nowIso = new Date().toISOString();
        await db.collection(COL.INVESTMENTS).add({
            user_id: userId,
            package_name: packageName || 'Investment Plan',
            shares: unitCount,
            price: cost,
            daily_earnings: Number(dailyEarnings || 0) * unitCount,
            duration_days: Number(durationDays || 45),
            status: 'In progress',
            generated: 0,
            created_at: nowIso
        });

        await addBillEntry(userId, 'Buy Product', `-₹${cost.toFixed(2)}`);

        res.json({
            success: true,
            message: 'Investment order placed! +1 Lucky Spin unlocked.',
            spins: newSpins
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Claim Lucky Spin
app.post('/api/spin/claim', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const userRef = db.collection(COL.USERS).doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ success: false, message: 'User not found' });

        const uData = userDoc.data();
        const currentSpins = Number(uData.spins || 0);
        if (currentSpins <= 0) {
            return res.status(400).json({ success: false, message: 'No spins remaining' });
        }

        const prizePool = [
            { num: 1, label: '₹50', amount: 50 },
            { num: 2, label: '₹200', amount: 200 },
            { num: 3, label: 'Thanks', amount: 0 },
            { num: 4, label: '₹100', amount: 100 },
            { num: 5, label: '₹2,500', amount: 2500 },
            { num: 6, label: '₹20', amount: 20 },
            { num: 7, label: '₹500', amount: 500 },
            { num: 8, label: '₹1,000', amount: 1000 }
        ];

        const won = prizePool[Math.floor(Math.random() * prizePool.length)];
        const newWithdrawBal = Number(uData.withdrawal_balance || 0) + won.amount;

        await userRef.update({
            spins: currentSpins - 1,
            withdrawal_balance: newWithdrawBal
        });

        const nowIso = new Date().toISOString();
        await db.collection(COL.SPIN_LOGS).add({
            user_id: userId,
            prize: won.label,
            amount: won.amount,
            created_at: nowIso
        });

        if (won.amount > 0) {
            await addBillEntry(userId, 'Other', `+₹${won.amount.toFixed(2)}`);
        }

        res.json({
            success: true,
            won,
            spinsLeft: currentSpins - 1,
            withdrawalBalance: newWithdrawBal
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Redeem Promo Code
app.post('/api/promo/redeem', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const code = String(req.body.code || '').trim().toUpperCase();
        if (!code) return res.status(400).json({ success: false, message: 'Enter a promo code' });

        const promoSnap = await db.collection(COL.PROMOS)
            .where('code', '==', code)
            .get();

        if (promoSnap.empty) {
            return res.status(404).json({ success: false, message: 'Invalid or expired promo code' });
        }

        const promoDoc = promoSnap.docs[0];
        const promo = promoDoc.data();

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
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ success: false, message: 'User not found' });

        const nextCharged = Number(userDoc.data().charged_balance || 0) + reward;
        await userRef.update({ charged_balance: nextCharged });

        await db.collection(COL.PROMO_CLAIMS).add({
            user_id: userId,
            code,
            reward,
            created_at: new Date().toISOString()
        });

        await addBillEntry(userId, 'Task Rewards', `+₹${reward.toFixed(2)}`);

        res.json({
            success: true,
            message: `Promo code ${code} claimed! +₹${reward} added to Charged Balance.`,
            chargedBalance: nextCharged
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Recharge UTR Submit
app.post('/api/recharge/submit', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const { amount, channel, utr } = req.body;
        const amt = Number(amount);
        if (!amt || amt <= 0) {
            return res.status(400).json({ success: false, message: 'Enter valid recharge amount' });
        }

        const ref = await db.collection(COL.RECHARGES).add({
            user_id: userId,
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

// Withdrawal Submit (Full Bank Details + 11-Digit Code)
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
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).json({ success: false, message: 'User not found' });

        const withdrawBal = Number(userDoc.data().withdrawal_balance || 0);
        if (withdrawBal < amt) {
            return res.status(400).json({ success: false, message: 'Insufficient withdrawal balance' });
        }

        await userRef.update({
            withdrawal_balance: withdrawBal - amt
        });

        const ref = await db.collection(COL.WITHDRAWALS).add({
            user_id: userId,
            amount: amt,
            channel: channel || 'BankPay',
            holder_name: String(holderName || '').trim(),
            bank_name: String(bankName || '').trim(),
            bank_code: String(bankCode || '').trim(),
            account_number: String(accountNumber || '').trim(),
            status: 'pending',
            created_at: new Date().toISOString()
        });

        await addBillEntry(userId, 'Withdrawal', `-₹${amt.toFixed(2)}`);

        res.json({ success: true, id: ref.id, message: 'Withdrawal request submitted with bank details!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// =========================================================
// ADMIN ENDPOINTS
// =========================================================

app.get('/api/admin/data', requireAdmin, async (req, res) => {
    try {
        const [usersSnap, rechargesSnap, withdrawalsSnap, productsSnap, promosSnap, pagesSnap, cfgDoc] = await Promise.all([
            db.collection(COL.USERS).get(),
            db.collection(COL.RECHARGES).get(),
            db.collection(COL.WITHDRAWALS).get(),
            db.collection(COL.PRODUCTS).get(),
            db.collection(COL.PROMOS).get(),
            db.collection(COL.PAGES).get(),
            db.collection(COL.CONFIG).doc('global').get()
        ]);

        res.json({
            success: true,
            users: usersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            recharges: rechargesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            withdrawals: withdrawalsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            products: productsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            promos: promosSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            pages: pagesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            config: cfgDoc.exists ? cfgDoc.data() : {}
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Product Add / Edit / Delete
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

// Recharge Approve / Reject
app.post('/api/admin/recharge/review', requireAdmin, async (req, res) => {
    try {
        const { id, action } = req.body;
        if (!id || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid id or action' });
        }

        const recRef = db.collection(COL.RECHARGES).doc(id);
        const recDoc = await recRef.get();
        if (!recDoc.exists) return res.status(404).json({ success: false, message: 'Recharge not found' });

        const rec = recDoc.data();
        if (rec.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Already ${rec.status}` });
        }

        if (action === 'approve') {
            const userRef = db.collection(COL.USERS).doc(rec.user_id);
            const userDoc = await userRef.get();
            if (userDoc.exists) {
                const nextBal = Number(userDoc.data().charged_balance || 0) + Number(rec.amount || 0);
                await userRef.update({ charged_balance: nextBal });
                await addBillEntry(rec.user_id, 'Recharge', `+₹${Number(rec.amount || 0).toFixed(2)}`);
            }
            await recRef.update({ status: 'approved', reviewed_at: new Date().toISOString() });
        } else {
            await recRef.update({ status: 'rejected', reviewed_at: new Date().toISOString() });
        }

        res.json({ success: true, message: `Recharge ${action}d successfully!` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Withdrawal Approve / Reject
app.post('/api/admin/withdrawal/review', requireAdmin, async (req, res) => {
    try {
        const { id, action } = req.body;
        if (!id || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid id or action' });
        }

        const wdRef = db.collection(COL.WITHDRAWALS).doc(id);
        const wdDoc = await wdRef.get();
        if (!wdDoc.exists) return res.status(404).json({ success: false, message: 'Withdrawal not found' });

        const wd = wdDoc.data();
        if (wd.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Already ${wd.status}` });
        }

        if (action === 'reject') {
            const userRef = db.collection(COL.USERS).doc(wd.user_id);
            const userDoc = await userRef.get();
            if (userDoc.exists) {
                const refundBal = Number(userDoc.data().withdrawal_balance || 0) + Number(wd.amount || 0);
                await userRef.update({ withdrawal_balance: refundBal });
                await addBillEntry(wd.user_id, 'Other', `+₹${Number(wd.amount || 0).toFixed(2)}`);
            }
            await wdRef.update({ status: 'rejected', reviewed_at: new Date().toISOString() });
        } else {
            await wdRef.update({ status: 'approved', reviewed_at: new Date().toISOString() });
        }

        res.json({ success: true, message: `Withdrawal ${action}d successfully!` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Create Promo Code
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

// Set User VIP Level, Price & Expiry Time
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

// Save Banners & Popup Config
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

// Create / Delete Custom Pages
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
