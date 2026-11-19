const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

const FIREBASE_PROJECT_ID =
    process.env.FIREBASE_PROJECT_ID || 'proinvast';

const FIREBASE_CLIENT_EMAIL =
    process.env.FIREBASE_CLIENT_EMAIL ||
    'firebase-adminsdk-fbsvc@proinvast.iam.gserviceaccount.com';

const rawPrivateKey =
    process.env.FIREBASE_PRIVATE_KEY ||
    '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDVm+EhqlaElKW0\nKQ1oTQEzLWwZc4yKSI+2uUpDxLJTWNjzDXbnScXGCO1sRJg0iQMt5AVFOw4ODmvY\n7pzDprsK0wxfiaT9fbT4GpRjNUjG9KIqKdj8d8E47Jaew9woCwdmMjz/pDN/qDzc\n1XW74HhAqoIfkm/tr/0V+nLoudpQ4HpT/iKGnlEx2xaYnPY8CcuuvDZbFpE+eMF1\nG1Oq9RBxnkvsuX/w3RmCkcGHlrGsXS1d7tIjUYrIxnAIgEY1tuGRHoynu08MsVQ3\n+LDyMdrEg36Y3FsO5IxaLZvhzLeIPjcIUaSZABFw0aTqh9hALdLMkxpBUUKEmCB7\nlaFECGmdAgMBAAECggEAUAxf1D1gucN4y2h8+UKuOe8CLRGDr8icbqXGQloiV6Ca\ngI7hqbAYOOvciW+1OC7GLbrfDMAiNrtJyBw3TAyd2GMZpm3PEh27JSTUyc7MjJ5d\nbP6MraP1GW9zzGBqjuj/J1mZSVXP5L13vWwS+EqY1ebv54P5hPGoHsXhrPwE57xg\nIma2RSwPwSNdeaQbHpPOb6jyTMWLyd+CJtmqxGC5sqcM2BPvumq1AysrNOIHSFIJ\nFSPa1pSS1ILB6kgmsjdh1ktMUVfWr0A9jsulH9jVH2gDMhEBQeKQaLScOXSw/FNU\n8sHxlVGlPzskq43ad28SMhW0d/mcVQpzSM/w2018kwKBgQD3IyRdQjpTAWMzQzpc\nAOK04UIdul8KGMG8POb5za3XB0pnPRIPS1ooMW+dhJp95FUyltsRX38LMmyOUNwl\nR22O1/sIRJ2ePhXDX4EKhrL13o47E6h9M/SoXbX0T0yu9uTrg5idPpIy+7QLCbIe\n3nyyBU++9F4xBa/nVLiUM5RmuwKBgQDdRO2hjo/bQe6SGL1LyoPtY8g+KpZNRqaO\nUtAS+6R2kn94L1Si7ourAWFIh8pmx93FHWLBEWFluFjTEQSllBrynCYsi6Q9MSoJ\n19Wqyu9pps4MgjQmX7HZ31fuTns75iBaVbKRVXG8R5IQ02tbC2Db+Fq512KmhXNC\n2SnDIcNnhwKBgEtvKpZctLjJX6IyDwouKwTTDP9N99x5Ggl+/XGaWkmcLBW/Clgo\nw+gozszhwNZUb7z1VwDCiWC9j20ROWEXoFVNj45Cg2ndwX7VE+pGmzF5MSjPI0q0\nJSWPFQ7xdZKiQdWxYU/93Vo6ggYse3X4q08bV/ANXwLPnZWawoxaAh4pAoGBANsX\ncSRTAOZddlh63pS5RcA82P2VNZX2qtyp6xWgzcwKauUaGHfsM6dzilxC+IqkxFZ1\nLl91UjdiPbFgXHWHHNe0/aeF7W4ZzEJK0Gp43m6Cl+uS0QheIMBWgb6ZPzSkPMy1\npkZ5kFCZnWvDq71Omu20EEGLn0a7RNGgLdXlDJLpAoGAMC5aEycItU7MjTmjn2KA\nc1SmYRjIy349UG5A1cwXmSWW5ELiYCiyMYvkof7AYpUBIgTxC82r1cKnclgtxbDr\n9GwP6c78GUpdk5pLuiQW7WRwK8oSDgKBOo4sEDLS4qX0SCKLUTAJBikd1ZlXt4Qn\njZCEsfM6/Js8HHY+7kRRzeI=\n-----END PRIVATE KEY-----\n';

const FIREBASE_PRIVATE_KEY = rawPrivateKey.replace(/\\n/g, '\n');

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY
    })
});

const db = admin.firestore();

const COL = {
    USERS: 'users',
    PRODUCTS: 'products',
    INVESTMENTS: 'investments',
    RECHARGES: 'recharges',
    WITHDRAWALS: 'withdrawals',
    BLOG: 'blog_posts',
    FEEDBACK: 'feedback'
};

function getUserIdFromHeader(req) {
    const auth = req.headers.authorization || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token.startsWith('token_')) return null;
    return token.replace('token_', '');
}

// Health Check
app.get('/', (req, res) => {
    res.json({ success: true, message: 'HD Hyundai Firebase API is running!' });
});

// Get Products
app.get('/api/products', async (req, res) => {
    try {
        const snap = await db.collection(COL.PRODUCTS).get();
        const products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Register (₹40 Bonus + Invite Code)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { phone, password, nickname, inviteCode } = req.body;
        if (!phone || !password) {
            return res.status(400).json({ success: false, message: 'Phone and password required' });
        }

        const existing = await db.collection(COL.USERS)
            .where('phone', '==', String(phone))
            .get();

        if (!existing.empty) {
            return res.status(400).json({ success: false, message: 'Phone number already registered' });
        }

        const newInviteCode = 'HD' + Math.floor(10000 + Math.random() * 90000);
        const userData = {
            phone: String(phone),
            password: String(password),
            nickname: nickname || 'Investor',
            charged_balance: 40,
            withdrawal_balance: 0,
            product_revenue: 0,
            invite_code: newInviteCode,
            invited_by: inviteCode || null,
            created_at: new Date().toISOString()
        };

        const ref = await db.collection(COL.USERS).add(userData);
        res.json({
            success: true,
            message: 'Registered successfully! ₹40 bonus credited.',
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
        const snap = await db.collection(COL.USERS)
            .where('phone', '==', String(phone))
            .where('password', '==', String(password))
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

// Profile
app.get('/api/user/profile', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const doc = await db.collection(COL.USERS).doc(userId).get();
        if (!doc.exists) return res.status(404).json({ message: 'User not found' });

        const user = doc.data();
        res.json({
            id: doc.id,
            chargedBalance: Number(user.charged_balance || 0),
            withdrawalBalance: Number(user.withdrawal_balance || 0),
            productRevenue: Number(user.product_revenue || 0),
            phone: user.phone,
            nickname: user.nickname,
            inviteCode: user.invite_code
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Buy Investment
app.post('/api/investment/buy', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const { packageName, price, dailyEarnings, durationDays } = req.body;
        const userRef = db.collection(COL.USERS).doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) return res.status(404).json({ success: false, message: 'User not found' });

        const currentBalance = Number(userDoc.data().charged_balance || 0);
        const cost = Number(price);

        if (currentBalance < cost) {
            return res.status(400).json({ success: false, message: 'Insufficient charged balance' });
        }

        await userRef.update({
            charged_balance: currentBalance - cost
        });

        await db.collection(COL.INVESTMENTS).add({
            user_id: userId,
            package_name: packageName,
            price: cost,
            daily_earnings: Number(dailyEarnings),
            duration_days: Number(durationDays),
            status: 'In progress',
            generated: 0,
            created_at: new Date().toISOString()
        });

        res.json({ success: true, message: 'Investment order placed successfully!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Recharge UTR
app.post('/api/recharge/submit', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const { amount, channel, utr } = req.body;
        await db.collection(COL.RECHARGES).add({
            user_id: userId,
            amount: Number(amount),
            channel: channel || 'PaytmPay',
            utr: String(utr),
            status: 'pending',
            created_at: new Date().toISOString()
        });

        res.json({ success: true, message: 'UTR submitted successfully!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Withdrawal (₹110 - ₹50,000)
app.post('/api/withdrawal/submit', async (req, res) => {
    try {
        const userId = getUserIdFromHeader(req);
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const { amount, channel } = req.body;
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

        await db.collection(COL.WITHDRAWALS).add({
            user_id: userId,
            amount: amt,
            channel: channel || 'BankPay',
            status: 'pending',
            created_at: new Date().toISOString()
        });

        res.json({ success: true, message: 'Withdrawal request submitted!' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin Data
app.get('/api/admin/data', async (req, res) => {
    try {
        const secret = req.headers['admin-secret'];
        if (secret !== 'MY_SUPER_ADMIN_SECRET_123') {
            return res.status(403).json({ message: 'Unauthorized' });
        }

        const [usersSnap, rechargesSnap, withdrawalsSnap, productsSnap] = await Promise.all([
            db.collection(COL.USERS).get(),
            db.collection(COL.RECHARGES).get(),
            db.collection(COL.WITHDRAWALS).get(),
            db.collection(COL.PRODUCTS).get()
        ]);

        res.json({
            success: true,
            users: usersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            recharges: rechargesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            withdrawals: withdrawalsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            products: productsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Firebase Server running on port ${PORT}`));
