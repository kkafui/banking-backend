const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();

router.get("/recipients", authenticateToken, async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return res.status(400).json({
      message: "A valid recipient email is required",
    });
  }

  try {
    const result = await pool.query(
      `SELECT full_name, email
       FROM users
       WHERE email = $1`,
      [email]
    );

    const recipient = result.rows[0];

    if (!recipient) {
      return res.status(404).json({
        message: "Recipient account was not found",
      });
    }

    res.json({
      recipient,
    });
  } catch (error) {
    res.status(500).json({
      message: "Could not verify recipient",
    });
  }
});

module.exports = router;