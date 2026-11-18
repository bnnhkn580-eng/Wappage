const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- Supabase Connection ---
const SUPABASE_URL = "https://ojjqykehnnihcqrcweej.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_C2DDYmW98y0XFFBZb83xUQ_3dWRzxT9";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Middlewares ---
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ message: "Access Denied. No token provided." });
  
  jwt.verify(token.split(" ")[1], "SECRET_KEY_JWT", (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid Token" });
    req.user = decoded;
    next();
  });
};

const verifyAdmin = (req, res, next) => {
  const adminSecret = req.headers['admin-secret'];
  if (adminSecret !== "MY_SUPER_ADMIN_SECRET_123") {
    return res.status(403).json({ message: "Access Denied. Unauthorized Admin." });
  }
  next();
};

app.get('/', (req, res) => {
  res.json({ message: "Wappage Supabase API v3 is running successfully!" });
});

// --- User Auth APIs ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone, password, nickname } = req.body;
    if (!phone || !password) return res.status(400).json({ message: "Phone and password required!" });

    const { data: existing } = await supabase.from('users').select('*').eq('phone', phone).single();
    if (existing) return res.status(400).json({ message: "Phone number already registered!" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const { data, error } = await supabase.from('users').insert([
      { phone, password: hashedPassword, nickname: nickname || "User", charged_balance: 0, withdrawal_balance: 0, product_revenue: 0 }
    ]).select();

    if (error) throw error;
    res.status(201).json({ success: true, message: "Registration successful! Please login.", userId: data[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const { data: user, error } = await supabase.from('users').select('*').eq('phone', phone).single();
    if (error || !user) return res.status(404).json({ message: "User not found!" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials!" });

    const token = jwt.sign({ id: user.id, phone: user.phone }, "SECRET_KEY_JWT", { expiresIn: '7d' });
    const { password: _, ...userWithoutPassword } = user;
    
    // Map Supabase snake_case to camelCase for frontend compatibility
    const formattedUser = {
      _id: userWithoutPassword.id,
      phone: userWithoutPassword.phone,
      nickname: userWithoutPassword.nickname,
      chargedBalance: userWithoutPassword.charged_balance,
      withdrawalBalance: userWithoutPassword.withdrawal_balance,
      productRevenue: userWithoutPassword.product_revenue,
      vipLevel: userWithoutPassword.vip_level
    };

    res.json({ message: "Login successful", token, user: formattedUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    if (error || !user) return res.status(404).json({ message: "User not found" });
    
    const formattedUser = {
      _id: user.id,
      phone: user.phone,
      nickname: user.nickname,
      chargedBalance: user.charged_balance,
      withdrawalBalance: user.withdrawal_balance,
      productRevenue: user.product_revenue,
      vipLevel: user.vip_level
    };
    res.json(formattedUser);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    
    const formattedProducts = data.map(p => ({
      _id: p.id,
      name: p.name,
      category: p.category,
      vip: p.vip,
      image: p.image,
      price: p.price,
      dailyEarnings: p.daily_earnings,
      durationDays: p.duration_days
    }));
    res.json(formattedProducts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/investment/buy', verifyToken, async (req, res) => {
  try {
    const { packageName, price, dailyEarnings, durationDays } = req.body;
    const { data: user, error } = await supabase.from('users').select('*').eq('id', req.user.id).single();
    
    if (error || !user || user.charged_balance < price) {
      return res.status(400).json({ message: "Insufficient charged balance!" });
    }

    const newCharged = user.charged_balance - price;
    await supabase.from('users').update({ charged_balance: newCharged }).eq('id', user.id);

    const { data: investment, error: invError } = await supabase.from('investments').insert([
      { user_id: user.id, package_name: packageName, price, daily_earnings: dailyEarnings, duration_days: durationDays }
    ]).select();

    if (invError) throw invError;
    res.json({ message: "Investment successful!", investment: investment[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Admin APIs ---
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    
    const users = data.map(u => ({
      _id: u.id,
      phone: u.phone,
      nickname: u.nickname,
      chargedBalance: u.charged_balance,
      withdrawalBalance: u.withdrawal_balance,
      productRevenue: u.product_revenue
    }));
    res.json({ success: true, count: users.length, users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/update-balance', verifyAdmin, async (req, res) => {
  try {
    const { userId, walletType, type, amount } = req.body;
    const field = walletType === 'charged' ? 'charged_balance' : 'withdrawal_balance';

    const { data: user, error: fetchErr } = await supabase.from('users').select('*').eq('id', userId).single();
    if (fetchErr || !user) return res.status(404).json({ message: "User not found!" });

    let currentVal = Number(user[field]) || 0;
    let newVal = type === 'add' ? currentVal + Number(amount) : Math.max(0, currentVal - Number(amount));

    const { data, error } = await supabase.from('users').update({ [field]: newVal }).eq('id', userId).select();
    if (error) throw error;

    res.json({ success: true, message: "Balance updated successfully", user: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/user/:id', verifyAdmin, async (req, res) => {
  try {
    await supabase.from('investments').delete().eq('user_id', req.params.id);
    const { error } = await supabase.from('users').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true, message: "User deleted successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/products', verifyAdmin, async (req, res) => {
  try {
    const { name, category, vip, image, price, dailyEarnings, durationDays } = req.body;
    const { data, error } = await supabase.from('products').insert([
      { name, category: category || 'Steady', vip: vip || 'VIP1', image, price: Number(price), daily_earnings: Number(dailyEarnings), duration_days: Number(durationDays) }
    ]).select();

    if (error) throw error;
    res.status(201).json({ success: true, message: "Product added!", product: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/products/:id', verifyAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('products').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true, message: "Product deleted!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
