const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/auth");
const requireAdmin = require("../middleware/admin");

const router = express.Router();

router.use(authenticateToken);
router.use(requireAdmin);

router.get("/admin/users", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, email, balance, role, is_frozen, created_at
       FROM users
       ORDER BY id`
    );

    res.json({
      userCount: result.rows.length,
      users: result.rows,
    });
  } catch (error) {
    res.status(500).json({
      message: "Could not fetch customer accounts",
    });
  }
});

router.get("/admin/transactions", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  try {
    const [transactionsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT
           transactions.id,
           users.full_name,
           users.email,
           transactions.transaction_type,
           transactions.amount,
           transactions.description,
           transactions.created_at
         FROM transactions
         JOIN users ON users.id = transactions.user_id
         ORDER BY transactions.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query("SELECT COUNT(*) FROM transactions"),
    ]);

    res.json({
      totalTransactions: Number(countResult.rows[0].count),
      limit,
      offset,
      transactions: transactionsResult.rows,
    });
  } catch (error) {
    res.status(500).json({
      message: "Could not fetch transactions",
    });
  }
});

router.patch("/admin/users/:id/freeze", async (req, res) => {
  const userId = Number(req.params.id);
  const { isFrozen } = req.body;

  if (!Number.isInteger(userId) || typeof isFrozen !== "boolean") {
    return res.status(400).json({
      message: "A valid customer ID and freeze status are required",
    });
  }

  if (userId === req.user.userId) {
    return res.status(400).json({
      message: "Administrators cannot freeze their own account",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `UPDATE users
       SET is_frozen = $1
       WHERE id = $2
       RETURNING id, full_name, email, is_frozen`,
      [isFrozen, userId]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Customer account not found",
      });
    }

    const action = isFrozen ? "ACCOUNT_FROZEN" : "ACCOUNT_UNFROZEN";

    await client.query(
      `INSERT INTO admin_audit_logs (
        admin_user_id,
        target_user_id,
        action
      )
      VALUES ($1, $2, $3)`,
      [req.user.userId, userId, action]
    );

    await client.query("COMMIT");

    res.json({
      message: isFrozen
        ? "Account frozen successfully"
        : "Account unfrozen successfully",
      user: userResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    res.status(500).json({
      message: "Could not update account status",
    });
  } finally {
    client.release();
  }
});

router.get("/admin/audit-logs", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         admin_audit_logs.id,
         admin.full_name AS admin_name,
         target.full_name AS target_name,
         admin_audit_logs.action,
         admin_audit_logs.created_at
       FROM admin_audit_logs
       JOIN users AS admin
         ON admin.id = admin_audit_logs.admin_user_id
       JOIN users AS target
         ON target.id = admin_audit_logs.target_user_id
       ORDER BY admin_audit_logs.created_at DESC
       LIMIT 100`
    );

    res.json({
      auditLogCount: result.rows.length,
      logs: result.rows,
    });
  } catch (error) {
    res.status(500).json({
      message: "Could not fetch admin activity logs",
    });
  }
});

router.get("/admin/summary", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*) AS total_customers,
         COUNT(*) FILTER (WHERE is_frozen = TRUE) AS frozen_accounts,
         COALESCE(SUM(balance), 0) AS total_balance
       FROM users`
    );

    const transactionResult = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_transaction_value
       FROM transactions`
    );

    res.json({
      totalCustomers: Number(result.rows[0].total_customers),
      frozenAccounts: Number(result.rows[0].frozen_accounts),
      totalBalance: result.rows[0].total_balance,
      totalTransactionValue: transactionResult.rows[0].total_transaction_value,
    });
  } catch (error) {
    res.status(500).json({
      message: "Could not fetch admin summary",
    });
  }
});

module.exports = router;