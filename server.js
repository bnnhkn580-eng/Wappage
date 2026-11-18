const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(cors());

const SUPABASE_URL = "https://ojjqykehnnihcqrcweej.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "YOUR_SUPABASE_ANON_KEY"; 
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ADMIN_SECRET = "MY_SUPER_ADMIN_SECRET_123";

// Middleware to verify User Token
const verifyUserToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ message: 'No token provided' });
    const token = authHeader.split(' ')[1];
    
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', token)
      .single();

    if (error || !user) return res.status(401).json({ message: 'Invalid token' });
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ message: 'Authentication failed' });
  }
};

// --- AUTH: REGISTER WITH UNIQUE UID & REFERRAL ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone, password, nickname, invitedBy } = req.body;
    
    // Generate unique UID & Referral Code for this new user
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    const uid = `APEX${randomNum}`;
    const referralCode = `REF${randomNum}`;

    const { data, error } = await supabase
      .from('users')
      .insert([{ 
        phone, 
        password, 
        nickname: nickname || 'User', 
        uid, 
        referral_code: referralCode,
        invited_by: invitedBy || null,
        charged_balance: 0, 
        withdrawal_balance: 0, 
        product_revenue: 0 
      }])
      .select();

    if (error) return res.status(400).json({ message: error.message });
    res.json({ success: true, message: 'Registered successfully', uid });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// --- AUTH: LOGIN ---
app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('phone', phone)
      .eq('password', password);

    if (error || !users || users.length === 0) {
      return res.status(400).json({ message: 'Invalid phone or password' });
    }

    const user = users[0];
    res.json({ token: user.id, user });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// --- USER PROFILE (Returns UID and Referral Link) ---
app.get('/api/user/profile', verifyUserToken, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(404).json({ message: 'User not found' });
  
  // Construct user's unique referral link
  const refLink = `https://wappage-4.onrender.com/reg?code=${data.referral_code}`;

  res.json({
    id: data.id,
    uid: data.uid,
    nickname: data.nickname,
    phone: data.phone,
    chargedBalance: data.charged_balance,
    withdrawalBalance: data.withdrawal_balance,
    productRevenue: data.product_revenue,
    referralCode: data.referral_code,
    referralLink: refLink
  });
});

// --- PRODUCTS ---
app.get('/api/products', async (req, res) => {
  const { data, error } = await supabase.from('products').select('*');
  if (error) return res.status(500).json({ message: error.message });
  res.json(data);
});

// --- GIFT CODE REDEMPTION ---
app.post('/api/user/redeem-gift', verifyUserToken, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'Please enter a gift code' });

    let bonusAmount = 0;
    const upperCode = code.trim().toUpperCase();

    if (upperCode === 'APEX500' || upperCode === 'APEX2026') {
      bonusAmount = 500;
    } else if (upperCode === 'WELCOME100') {
      bonusAmount = 100;
    } else {
      return res.status(400).json({ message: 'Invalid or expired gift code!' });
    }

    const currentBalance = Number(req.user.withdrawal_balance || 0);
    const newBalance = currentBalance + bonusAmount;

    const { error: updateError } = await supabase
      .from('users')
      .update({ withdrawal_balance: newBalance })
      .eq('id', req.user.id);

    if (updateError) return res.status(500).json({ message: 'Failed to update balance' });

    res.json({ success: true, message: `Successfully claimed ₹${bonusAmount}!`, newBalance });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// --- ADMIN USERS LIST ---
app.get('/api/admin/users', async (req, res) => {
  const secret = req.headers['admin-secret'];
  if (secret !== ADMIN_SECRET) return res.status(403).json({ message: 'Unauthorized' });

  const { data, error } = await supabase.from('users').select('*');
  if (error) return res.status(500).json({ message: error.message });
  res.json({ success: true, users: data });
});

// --- ADMIN ADD PRODUCT ---
app.post('/api/admin/products', async (req, res) => {
  const secret = req.headers['admin-secret'];
  if (secret !== ADMIN_SECRET) return res.status(403).json({ message: 'Unauthorized' });

  const { name, image, price, dailyEarnings, durationDays, vip, category } = req.body;
  const { error } = await supabase.from('products').insert([{ name, image, price, daily_earnings: dailyEarnings, duration_days: durationDays, vip, category }]);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
