const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- Database Connection ---
const MONGO_URI = "mongodb://bnnhkn580_db_user:sOsOPBdT4u2xscOz@ac-ejzv0tg-shard-00-00.zcpjfa9.mongodb.net:27017,ac-ejzv0tg-shard-00-01.zcpjfa9.mongodb.net:27017,ac-ejzv0tg-shard-00-02.zcpjfa9.mongodb.net:27017/?ssl=true&replicaSet=atlas-yogt5d-shard-0&authSource=admin";

mongoose.connect(MONGO_URI)
  .then(() => console.log("Database Connected Successfully"))
  .catch(err => console.log("DB Connection Error:", err));

// --- Schemas & Models ---
const userSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  nickname: { type: String, default: "User" },
  chargedBalance: { type: Number, default: 0 },
  withdrawalBalance: { type: Number, default: 0 }, // Initial 0
  productRevenue: { type: Number, default: 0 },
  bonusBalance: { type: Number, default: 0 },
  vipLevel: { type: Number, default: 0 },
  bankDetails: {
    bankName: { type: String, default: "" },
    accountNumber: { type: String, default: "" },
    ifsc: { type: String, default: "" }
  },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

// Product Schema (Admin se Image ke sath add karne ke liye)
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, default: 'Steady' }, // Steady, Benefits, Event
  vip: { type: String, default: 'VIP1' },
  image: { type: String, required: true }, // Image URL
  price: { type: Number, required: true },
  dailyEarnings: { type: Number, required: true },
  durationDays: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Product = mongoose.model('Product', productSchema);

const investmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  packageName: { type: String, required: true },
  price: { type: Number, required: true },
  dailyEarnings: { type: Number, required: true },
  durationDays: { type: Number, required: true },
  startDate: { type: Date, default: Date.now },
  status: { type: String, default: 'active' }
});
const Investment = mongoose.model('Investment', investmentSchema);

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true }, 
  amount: { type: Number, required: true },
  status: { type: String, default: 'Success' },
  date: { type: Date, default: Date.now }
});
const Transaction = mongoose.model('Transaction', transactionSchema);

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
  res.json({ message: "Invast Pro API with Product & Admin Management is Running!" });
});

// --- User APIs ---
app.post('/api/auth/register', async (req, res) => {
  try {
    const { phone, password, nickname } = req.body;
    const existingUser = await User.findOne({ phone });
    if (existingUser) return res.status(400).json({ message: "Phone number already registered!" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      phone,
      password: hashedPassword,
      nickname: nickname || "New User",
      chargedBalance: 0,
      withdrawalBalance: 0,
      bonusBalance: 0
    });

    await newUser.save();
    res.status(201).json({ message: "Registration successful!", userId: newUser._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ message: "User not found!" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials!" });

    const token = jwt.sign({ id: user._id, phone: user.phone }, "SECRET_KEY_JWT", { expiresIn: '7d' });
    res.json({ message: "Login successful", token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public Route: Get All Products for User Site
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/investment/buy', verifyToken, async (req, res) => {
  try {
    const { packageName, price, dailyEarnings, durationDays } = req.body;
    const user = await User.findById(req.user.id);

    if (user.chargedBalance < price) {
      return res.status(400).json({ message: "Insufficient charged balance!" });
    }

    user.chargedBalance -= price;
    await user.save();

    const newInvestment = new Investment({
      userId: user._id,
      packageName,
      price,
      dailyEarnings,
      durationDays
    });
    await newInvestment.save();

    await Transaction.create({ userId: user._id, type: 'Buy Product', amount: -price });
    res.json({ message: "Investment successful!", newInvestment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/investment/orders', verifyToken, async (req, res) => {
  try {
    const orders = await Investment.find({ userId: req.user.id });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/wallet/withdraw', verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.user.id);

    if (!user.bankDetails || !user.bankDetails.accountNumber) {
      return res.status(403).json({ success: false, popup: "Please create withdraw account", message: "Bank account not linked!" });
    }

    if (user.withdrawalBalance < amount) {
      return res.status(400).json({ message: "Insufficient withdrawal balance!" });
    }

    user.withdrawalBalance -= amount;
    await user.save();
    await Transaction.create({ userId: user._id, type: 'Withdrawal', amount: -amount });
    res.json({ message: "Withdrawal request submitted successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// --- ADMIN PANEL APIs (Full Access) ---
// ==========================================

// 1. Get All Users
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, count: users.length, users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Update User Balance (Charged ya Withdrawal balance add/minus karne ke liye)
app.post('/api/admin/update-balance', verifyAdmin, async (req, res) => {
  try {
    const { userId, walletType, type, amount } = req.body; // walletType: 'charged' or 'withdrawal'
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found!" });

    const field = walletType === 'charged' ? 'chargedBalance' : 'withdrawalBalance';

    if (type === 'add') {
      user[field] += Number(amount);
    } else if (type === 'sub') {
      user[field] = Math.max(0, user[field] - Number(amount));
    } else {
      return res.status(400).json({ message: "Invalid type!" });
    }

    await user.save();
    await Transaction.create({
      userId: user._id,
      type: type === 'add' ? 'Admin Deposit' : 'Admin Deduction',
      amount: type === 'add' ? Number(amount) : -Number(amount)
    });

    res.json({ success: true, message: `Balance updated successfully!`, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Delete / Ban User
app.delete('/api/admin/user/:id', verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    await User.findByIdAndDelete(userId);
    await Investment.deleteMany({ userId });
    res.json({ success: true, message: "User deleted!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Add New Product with Image URL
app.post('/api/admin/products', verifyAdmin, async (req, res) => {
  try {
    const { name, category, vip, image, price, dailyEarnings, durationDays } = req.body;
    const newProduct = new Product({
      name,
      category,
      vip,
      image,
      price: Number(price),
      dailyEarnings: Number(dailyEarnings),
      durationDays: Number(durationDays)
    });
    await newProduct.save();
    res.status(201).json({ success: true, message: "Product added successfully!", product: newProduct });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Delete Product
app.delete('/api/admin/products/:id', verifyAdmin, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Product deleted!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Get All Active Investments
app.get('/api/admin/investments', verifyAdmin, async (req, res) => {
  try {
    const investments = await Investment.find().populate('userId', 'phone nickname').sort({ startDate: -1 });
    res.json({ success: true, investments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
