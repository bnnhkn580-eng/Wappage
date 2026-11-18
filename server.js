const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Supabase Configuration using Environment Variables
const SUPABASE_URL = process.env.SUPABASE_URL || "https://ojjqykehnnihcqrcweej.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_KEY) {
    console.error("Error: SUPABASE_KEY is required in environment variables.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 1. Get All Products
app.get('/api/products', async (req, res) => {
    try {
        const { data, error } = await supabase.from('products').select('*');
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. User Register (With ₹40 Signup Bonus & Referral Code Support)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { phone, password, nickname, inviteCode } = req.body;
        const { data: existing } = await supabase.from('users').select('*').eq('phone', phone).single();
        if (existing) return res.status(400).json({ success: false, message: 'Phone number already registered' });

        const generatedInviteCode = 'HD' + Math.floor(10000 + Math.random() * 90000);

        const { data, error } = await supabase.from('users').insert([{
            phone,
            password,
            nickname: nickname || 'Investor',
            charged_balance: 40.00, // ₹40 Signup Bonus
            withdrawal_balance: 0.00,
            product_revenue: 0.00,
            invite_code: generatedInviteCode,
            invited_by: inviteCode || null
        }]).select();

        if (error) throw error;
        res.json({ success: true, message: 'Registered successfully! ₹40 bonus credited.', user: data[0] });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
});

// 3. User Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const { data, error } = await supabase.from('users').select('*').eq('phone', phone).eq('password', password).single();
        if (error || !data) {
            return res.status(401).json({ success: false, message: 'Invalid phone or password' });
        }
        const token = 'token_' + data.id;
        res.json({ success: true, token, user: data });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4. Get User Profile & Balances
app.get('/api/user/profile', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ message: 'No token provided' });
        const userId = authHeader.split('_')[1];

        const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
        if (error) throw error;
        res.json({
            id: data.id,
            chargedBalance: data.charged_balance,
            withdrawalBalance: data.withdrawal_balance,
            productRevenue: data.product_revenue,
            phone: data.phone,
            nickname: data.nickname,
            inviteCode: data.invite_code
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Buy Investment Product
app.post('/api/investment/buy', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
        const userId = authHeader.split('_')[1];
        const { packageName, price, dailyEarnings, durationDays } = req.body;

        const { data: user } = await supabase.from('users').select('charged_balance').eq('id', userId).single();
        if (Number(user.charged_balance) < Number(price)) {
            return res.status(400).json({ success: false, message: 'Insufficient charged balance' });
        }

        await supabase.from('users').update({ charged_balance: Number(user.charged_balance) - Number(price) }).eq('id', userId);

        const { error: invError } = await supabase.from('investments').insert([{
            user_id: userId,
            package_name: packageName,
            price,
            daily_earnings: dailyEarnings,
            duration_days: durationDays,
            status: 'In progress',
            generated: 0
        }]);
        if (invError) throw invError;

        res.json({ success: true, message: 'Investment order placed successfully! Daily profit scheduled at 8:00 AM.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. Submit Recharge (QR & UTR Flow)
app.post('/api/recharge/submit', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
        const userId = authHeader.split('_')[1];
        const { amount, channel, utr } = req.body;

        const { error } = await supabase.from('recharges').insert([{
            user_id: userId,
            amount,
            channel: channel || 'PaytmPay',
            utr,
            status: 'pending'
        }]);
        if (error) throw error;

        res.json({ success: true, message: 'UTR submitted successfully! Waiting for admin approval.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. Submit Withdrawal (Min ₹110, Max ₹50,000)
app.post('/api/withdrawal/submit', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
        const userId = authHeader.split('_')[1];
        const { amount, channel } = req.body;

        if (amount < 110 || amount > 50000) {
            return res.status(400).json({ success: false, message: 'Withdrawal amount must be between ₹110 and ₹50,000' });
        }

        const { data: user } = await supabase.from('users').select('withdrawal_balance').eq('id', userId).single();
        if (Number(user.withdrawal_balance) < Number(amount)) {
            return res.status(400).json({ success: false, message: 'Insufficient withdrawal balance' });
        }

        await supabase.from('users').update({ withdrawal_balance: Number(user.withdrawal_balance) - Number(amount) }).eq('id', userId);

        const { error } = await supabase.from('withdrawals').insert([{
            user_id: userId,
            amount,
            channel: channel || 'BankPay',
            status: 'pending'
        }]);
        if (error) throw error;

        res.json({ success: true, message: 'Withdrawal request submitted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 8. Blog Community Post (Text & Image)
app.get('/api/blog/posts', async (req, res) => {
    try {
        const { data, error } = await supabase.from('blog_posts').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/blog/publish', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
        const userId = authHeader.split('_')[1];
        const { message, image, payout, utr } = req.body;

        const { data: user } = await supabase.from('users').select('nickname').eq('id', userId).single();

        const { error } = await supabase.from('blog_posts').insert([{
            user_id: userId,
            username: user.nickname || 'Investor',
            message,
            image: image || null,
            payout: payout || '₹1,000.00',
            utr: utr || 'UTR: ' + Math.floor(100000000000 + Math.random() * 900000000000)
        }]);
        if (error) throw error;

        res.json({ success: true, message: 'Post published successfully!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 9. Customer Service Feedback & Admin Reply API
app.get('/api/feedback/list', async (req, res) => {
    try {
        const { data, error } = await supabase.from('feedback').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/feedback/submit', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
        const userId = authHeader.split('_')[1];
        const { description, orderInfo } = req.body;

        const { error } = await supabase.from('feedback').insert([{
            user_id: userId,
            description,
            order_info: orderInfo || 'General Inquiry',
            admin_reply: null,
            status: 'Pending'
        }]);
        if (error) throw error;

        res.json({ success: true, message: 'Support ticket submitted!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/admin/feedback/reply', async (req, res) => {
    try {
        const secret = req.headers['admin-secret'];
        if (secret !== 'MY_SUPER_ADMIN_SECRET_123') return res.status(403).json({ message: 'Unauthorized' });
        const { feedbackId, adminReply } = req.body;

        const { error } = await supabase.from('feedback').update({ admin_reply: adminReply, status: 'Resolved' }).eq('id', feedbackId);
        if (error) throw error;

        res.json({ success: true, message: 'Reply sent successfully!' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 10. Referral Tracking & Stats API
app.get('/api/user/referral-stats', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
        const userId = authHeader.split('_')[1];

        const { data: user } = await supabase.from('users').select('invite_code').eq('id', userId).single();
        
        // Fetch count of users invited by this user's invite_code
        const { count: level1Count } = await supabase.from('users').select('*', { count: 'exact', head: true }).eq('invited_by', user.invite_code);

        res.json({
            success: true,
            inviteCode: user.invite_code,
            inviteLink: `https://wappage-9.onrender.com/reg?code=${user.invite_code}`,
            totalTeamSize: level1Count || 0,
            level1Count: level1Count || 0,
            level2Count: 0,
            level3Count: 0,
            totalRebate: 0.00
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 11. Admin Master Endpoints
app.get('/api/admin/data', async (req, res) => {
    try {
        const secret = req.headers['admin-secret'];
        if (secret !== 'MY_SUPER_ADMIN_SECRET_123') return res.status(403).json({ message: 'Unauthorized' });

        const { data: users } = await supabase.from('users').select('*');
        const { data: recharges } = await supabase.from('recharges').select('*');
        const { data: withdrawals } = await supabase.from('withdrawals').select('*');
        const { data: products } = await supabase.from('products').select('*');
        const { data: blogPosts } = await supabase.from('blog_posts').select('*');

        res.json({ success: true, users, recharges, withdrawals, products, blogPosts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
