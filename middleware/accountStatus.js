const pool = require("../db");

async function ensureAccountActive(req, res, next) {
  try {
    const result = await pool.query(
      "SELECT is_frozen FROM users WHERE id = $1",
      [req.user.userId]
    );

    const user = result.rows[0];

    if (!user || user.is_frozen) {
      return res.status(403).json({
        message: "This account is frozen. Contact an administrator.",
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      message: "Could not verify account status",
    });
  }
}

module.exports = ensureAccountActive;