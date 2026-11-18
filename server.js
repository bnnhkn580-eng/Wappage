const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// --- Database Connection (Cloud Safe - Data Never Resets) ---
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
  withdrawalBalance: { type: Number, default: 37 }, 
  productRevenue: { type: Number, default: 0 },
  bonusBalance: { type: Number, default: 40 },
  vipLevel: { type: Number, default: 1 },
  bankDetails: {
    bankName: { type: String, default: "" },
    accountNumber: { type: String, default: "" },
    ifsc: { type: String, default: "" }
  },
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

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
// User Authentication Middleware
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ message: "Access Denied. No token provided." });
  
  jwt.verify(token.split(" ")[1], "SECRET_KEY_JWT", (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid Token" });
    req.user = decoded;
    next();
  });
};

// Admin Authentication Middleware
const verifyAdmin = (req, res, next) => {
  const adminSecret = req.headers['admin-secret'];
  if (adminSecret !== "MY_SUPER_ADMIN_SECRET_123") {
    return res.status(403).json({ message: "Access Denied. Unauthorized Admin." });
  }
  next();
};

// Test Route for Home URL
app.get('/', (req, res) => {
  res.json({ message: "Invast Pro API is running successfully!" });
});


// ==========================================
// --- USER / SITE API ROUTES ---
// ==========================================

// 1. Register API (₹40 Bonus)
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
      bonusBalance: 40 
    });

    await newUser.save();
    res.status(201).json({ message: "Registration successful! ₹40 bonus added.", userId: newUser._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Login API
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

// 3. User Profile API
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Investment Buy API
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

    await Transaction.create({
      userId: user._id,
      type: 'Buy Product',
      amount: -price
    });

    res.json({ message: "Investment successful!", newInvestment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Get User Orders
app.get('/api/investment/orders', verifyToken, async (req, res) => {
  try {
    const orders = await Investment.find({ userId: req.user.id });
    
    const updatedOrders = orders.map(order => {
      const daysPassed = Math.floor((Date.now() - new Date(order.startDate)) / (1000 * 60 * 60 * 24));
      return {
        ...order._doc,
        daysPassed: Math.min(daysPassed, order.durationDays),
        totalGenerated: Math.min(daysPassed, order.durationDays) * order.dailyEarnings
      };
    });

    res.json(updatedOrders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Withdraw API (Bank Check Popup Logic)
app.post('/api/wallet/withdraw', verifyToken, async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await User.findById(req.user.id);

    if (!user.bankDetails || !user.bankDetails.accountNumber) {
      return res.status(403).json({ 
        success: false, 
        popup: "Please create withdraw account", 
        message: "Bank account not linked!" 
      });
    }

    if (user.withdrawalBalance < amount) {
      return res.status(400).json({ message: "Insufficient withdrawal balance!" });
    }

    user.withdrawalBalance -= amount;
    await user.save();

    await Transaction.create({
      userId: user._id,
      type: 'Withdrawal',
      amount: -amount
    });

    res.json({ message: "Withdrawal request submitted successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// --- ADMIN PANEL API ROUTES ---
// ==========================================

// 1. Get All Users List
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get All Investments (Sabhi users ka investment data)
app.get('/api/admin/investments', verifyAdmin, async (req, res) => {
  try {
    const investments = await Investment.find().populate('userId', 'phone nickname');
    res.json({
      success: true,
      investments
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Update User Balance (Coins Add / Minus by Admin)
app.post('/api/admin/update-balance', verifyAdmin, async (req, res) => {
  try {
    const { userId, type, amount } = req.body; // type: 'add' ya 'sub'
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found!" });

    if (type === 'add') {
      user.withdrawalBalance += Number(amount);
    } else if (type === 'sub') {
      user.withdrawalBalance -= Number(amount);
    } else {
      return res.status(400).json({ message: "Invalid type! Use 'add' or 'sub'." });
    }

    await user.save();

    await Transaction.create({
      userId: user._id,
      type: type === 'add' ? 'Admin Deposit' : 'Admin Deduction',
      amount: type === 'add' ? Number(amount) : -Number(amount)
    });

    res.json({ 
      success: true, 
      message: `Successfully ${type}ed ₹${amount}`, 
      user 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Delete User (Ban/Delete user account)
app.delete('/api/admin/user/:id', verifyAdmin, async (req, res) => {
  try {
    const userId = req.params.id;
    const deletedUser = await User.findByIdAndDelete(userId);
    if (!deletedUser) return res.status(404).json({ message: "User not found!" });

    await Investment.deleteMany({ userId });

    res.json({ success: true, message: "User and their data deleted successfully!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
