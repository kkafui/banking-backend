const pool = require("../db");

async function requireAdmin(req, res, next) {
  try {
    const result = await pool.query(
      "SELECT role FROM users WHERE id = $1",
      [req.user.userId]
    );

    const user = result.rows[0];

    if (!user || user.role !== "admin") {
      return res.status(403).json({
        message: "Administrator access is required",
      });
    }

    next();
  } catch (error) {
    res.status(500).json({
      message: "Could not verify administrator access",
    });
  }
}

module.exports = requireAdmin;