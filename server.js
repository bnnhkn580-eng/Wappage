const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(cors());

// Supabase Configuration
const SUPABASE_URL = "https://ojjqykehnnihcqrcweej.supabase.co";
const SUPABASE_KEY = "sb_secret_XuflgQSKVI2fw_T1Gnw3Yw_61Dvbjlr";
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

// 2. User Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { phone, password, nickname } = req.body;
        const { data, error } = await supabase.from('users').insert([{ phone, password, nickname: nickname || 'User' }]).select();
        if (error) throw error;
        res.json({ success: true, message: 'Registered successfully', user: data[0] });
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

// 4. Get User Profile
app.get('/api/user/profile', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ message: 'No token provided' });
        const userId = authHeader.split('_')[1];

        const { data, error } = await supabase.from('users').select('*').eq('id', userId).single();
        if (error) throw error;
        res.json({
            chargedBalance: data.charged_balance,
            withdrawalBalance: data.withdrawal_balance,
            productRevenue: data.product_revenue,
            phone: data.phone,
            nickname: data.nickname
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

        const { error: invError } = await supabase.from('investments').insert([{
            user_id: userId,
            package_name: packageName,
            price,
            daily_earnings: dailyEarnings,
            duration_days: durationDays,
            status: 'active'
        }]);
        if (invError) throw invError;

        res.json({ success: true, message: 'Investment package activated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. Submit Recharge (Deposit & UTR Flow)
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

        res.json({ success: true, message: 'Recharge UTR submitted successfully for approval' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. Submit Withdrawal Request
app.post('/api/withdrawal/submit', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
        const userId = authHeader.split('_')[1];
        const { amount, channel } = req.body;

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

// 8. Submit Feedback / Recharge Issue Ticket
app.post('/api/feedback/submit', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
        const userId = authHeader.split('_')[1];
        const { orderInfo, senderName, description } = req.body;

        const { error } = await supabase.from('feedback').insert([{
            user_id: userId,
            order_info: orderInfo,
            sender_name: senderName,
            description,
            status: 'pending'
        }]);
        if (error) throw error;

        res.json({ success: true, message: 'Feedback ticket submitted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 9. Redeem Gift Code
app.post('/api/giftcode/redeem', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });
        const userId = authHeader.split('_')[1];
        const { code } = req.body;

        // Check gift code
        const { data: giftData, error: giftError } = await supabase.from('gift_codes').select('*').eq('code', code).single();
        if (giftError || !giftData) return res.status(400).json({ success: false, message: 'Invalid gift code' });
        if (giftData.is_claimed) return res.status(400).json({ success: false, message: 'Gift code already claimed' });

        // Mark as claimed
        await supabase.from('gift_codes').update({ is_claimed: true }).eq('id', giftData.id);

        // Add amount to user's balance
        const { data: userData } = await supabase.from('users').select('charged_balance').eq('id', userId).single();
        const newBalance = Number(userData.charged_balance || 0) + Number(giftData.amount);
        await supabase.from('users').update({ charged_balance: newBalance }).eq('id', userId);

        res.json({ success: true, message: `Successfully claimed ₹${giftData.amount}!` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 10. Admin: Get All Users
app.get('/api/admin/users', async (req, res) => {
    try {
        const secret = req.headers['admin-secret'];
        if (secret !== 'MY_SUPER_ADMIN_SECRET_123') {
            return res.status(403).json({ success: false, message: 'Unauthorized Admin Key' });
        }
        const { data, error } = await supabase.from('users').select('*');
        if (error) throw error;
        
        const formattedUsers = data.map(u => ({
            _id: u.id,
            phone: u.phone,
            nickname: u.nickname,
            chargedBalance: u.charged_balance,
            withdrawalBalance: u.withdrawal_balance
        }));
        res.json({ success: true, users: formattedUsers });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 11. Admin: Add Product
app.post('/api/admin/products', async (req, res) => {
    try {
        const secret = req.headers['admin-secret'];
        if (secret !== 'MY_SUPER_ADMIN_SECRET_123') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        const { name, category, vip, image, price, dailyEarnings, durationDays } = req.body;
        const { error } = await supabase.from('products').insert([{
            name, category: category || 'Steady', vip: vip || 'VIP1', image, price, daily_earnings: dailyEarnings, duration_days: durationDays || 45
        }]);
        if (error) throw error;
        res.json({ success: true, message: 'Product published successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Server Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Apex Invest Server running on port ${PORT}`);
});
