const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();

router.post("/users", async (req, res) => {
  const { fullName, email, password, openingBalance = 0 } = req.body;
  const startingBalance = Number(openingBalance);

  if (!fullName || !email || !password) {
    return res.status(400).json({
      message: "fullName, email, and password are required",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      message: "Password must be at least 8 characters long",
    });
  }

  if (!Number.isFinite(startingBalance) || startingBalance < 0) {
    return res.status(400).json({
      message: "Opening balance must be zero or greater",
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, balance)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name, email, balance, created_at`,
      [fullName, email.toLowerCase(), passwordHash, startingBalance]
    );

    res.status(201).json({
      message: "Customer account created successfully",
      user: result.rows[0],
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        message: "An account with that email already exists",
      });
    }

    res.status(500).json({
      message: "Could not create customer account",
    });
  }
});

router.get("/me", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, balance, created_at
       FROM users
       WHERE id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Customer account not found",
      });
    }

    res.json({
      user: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({
      message: "Could not fetch account details",
    });
  }
});

router.get("/me/summary", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         u.id,
         u.full_name,
         u.email,
         u.balance,
         u.is_frozen,
         COALESCE(SUM(CASE WHEN t.transaction_type = 'deposit' THEN t.amount ELSE 0 END), 0) AS total_deposits,
         COALESCE(SUM(CASE WHEN t.transaction_type = 'withdrawal' THEN t.amount ELSE 0 END), 0) AS total_withdrawals,
         COALESCE(SUM(CASE WHEN t.transaction_type = 'transfer_sent' THEN t.amount ELSE 0 END), 0) AS total_sent,
         COALESCE(SUM(CASE WHEN t.transaction_type = 'transfer_received' THEN t.amount ELSE 0 END), 0) AS total_received
       FROM users u
       LEFT JOIN transactions t ON t.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.id, u.full_name, u.email, u.balance`,
      [req.user.userId]
    );

    res.json({
      account: result.rows[0],
    });
  } catch (error) {
    res.status(500).json({
      message: "Could not fetch account summary",
    });
  }
});

router.put("/me/password", authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      message: "Current password and new password are required",
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      message: "New password must be at least 8 characters long",
    });
  }

  try {
    const userResult = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [req.user.userId]
    );

    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({
        message: "Customer account not found",
      });
    }

    const passwordIsCorrect = await bcrypt.compare(
      currentPassword,
      user.password_hash
    );

    if (!passwordIsCorrect) {
      return res.status(401).json({
        message: "Current password is incorrect",
      });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [newPasswordHash, req.user.userId]
    );

    res.json({
      message: "Password changed successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: "Password could not be changed",
    });
  }
});

module.exports = router;