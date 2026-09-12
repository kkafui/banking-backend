const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/auth");
const ensureAccountActive = require("../middleware/accountStatus");
const { sendTransactionEmail } = require("../utils/mailer");



const router = express.Router();

router.post("/users/:id/deposit", authenticateToken, async (req, res) => {
  const userId = Number(req.params.id);
  const amount = Number(req.body.amount);
  const { description = "Account deposit" } = req.body;

  if (req.user.userId !== userId) {
    return res.status(403).json({
      message: "You can only perform actions on your own account",
    });
  }

  if (!Number.isInteger(userId) || !Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({
      message: "A valid user ID and positive deposit amount are required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `UPDATE users
       SET balance = balance + $1
       WHERE id = $2
       RETURNING id, full_name, email, balance`,
      [amount, userId],
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        message: "Customer account not found",
      });
    }

    const transactionResult = await client.query(
      `INSERT INTO transactions (user_id, transaction_type, amount, description)
       VALUES ($1, 'deposit', $2, $3)
       RETURNING id, transaction_type, amount, description, created_at`,
      [userId, amount, description],
    );

    await client.query("COMMIT");

    sendTransactionEmail("deposit", {
      email: userResult.rows[0].email,
      fullName: userResult.rows[0].full_name,
      amount,
      description,
      balance: userResult.rows[0].balance,
    });

    res.status(201).json({
      message: "Deposit completed successfully",
      user: userResult.rows[0],
      transaction: transactionResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");

    res.status(500).json({
      message: "Deposit could not be completed",
    });
  } finally {
    client.release();
  }
});

router.post(
  "/users/:id/withdraw",
  authenticateToken,
  ensureAccountActive,
  async (req, res) => {
    const userId = Number(req.params.id);
    const amount = Number(req.body.amount);
    const { description = "Account withdrawal" } = req.body;

    if (req.user.userId !== userId) {
      return res.status(403).json({
        message: "You can only perform actions on your own account",
      });
    }

    if (!Number.isInteger(userId) || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        message: "A valid user ID and positive withdrawal amount are required",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const accountResult = await client.query(
        "SELECT id, full_name, email, balance FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );

      if (accountResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          message: "Customer account not found",
        });
      }

      const user = accountResult.rows[0];

      if (Number(user.balance) < amount) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "Insufficient funds",
        });
      }

      const updatedUserResult = await client.query(
        `UPDATE users
       SET balance = balance - $1
       WHERE id = $2
       RETURNING id, full_name, email, balance`,
        [amount, userId],
      );

      const transactionResult = await client.query(
        `INSERT INTO transactions (user_id, transaction_type, amount, description)
       VALUES ($1, 'withdrawal', $2, $3)
       RETURNING id, transaction_type, amount, description, created_at`,
        [userId, amount, description],
      );

      await client.query("COMMIT");

      sendTransactionEmail("withdrawal", {
        email: updatedUserResult.rows[0].email,
        fullName: updatedUserResult.rows[0].full_name,
        amount,
        description,
        balance: updatedUserResult.rows[0].balance,
      });

      res.status(201).json({
        message: "Withdrawal completed successfully",
        user: updatedUserResult.rows[0],
        transaction: transactionResult.rows[0],
      });
    } catch (error) {
      await client.query("ROLLBACK");

      res.status(500).json({
        message: "Withdrawal could not be completed",
      });
    } finally {
      client.release();
    }
  },
);

router.get("/users/:id/transactions", authenticateToken, async (req, res) => {
  const userId = Number(req.params.id);

  if (req.user.userId !== userId) {
    return res.status(403).json({
      message: "You can only view your own transaction history",
    });
  }

  try {
    const result = await pool.query(
      `SELECT id, transaction_type, amount, description, created_at
       FROM transactions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );

    res.json({
      transactionCount: result.rows.length,
      transactions: result.rows,
    });
  } catch (error) {
    res.status(500).json({
      message: "Could not fetch transaction history",
    });
  }
});

router.get("/me/transactions", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, transaction_type, amount, description, created_at
       FROM transactions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.userId],
    );

    res.json({
      transactionCount: result.rows.length,
      transactions: result.rows,
    });
  } catch (error) {
    res.status(500).json({
      message: "Could not fetch transaction history",
    });
  }
});

router.post(
  "/transfers",
  authenticateToken,
  ensureAccountActive,
  async (req, res) => {
    const senderId = Number(req.body.senderId);
    const receiverId = Number(req.body.receiverId);
    const amount = Number(req.body.amount);
    const { description = "Account transfer" } = req.body;

    if (
      !Number.isInteger(senderId) ||
      !Number.isInteger(receiverId) ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        message:
          "Valid sender ID, receiver ID, and positive amount are required",
      });
    }

    if (req.user.userId !== senderId) {
      return res.status(403).json({
        message: "You can only transfer money from your own account",
      });
    }

    if (senderId === receiverId) {
      return res.status(400).json({
        message: "Money cannot be transferred to the same account",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const accountsResult = await client.query(
        `SELECT id, full_name, email, balance
       FROM users
       WHERE id IN ($1, $2)
       ORDER BY id
       FOR UPDATE`,
        [senderId, receiverId],
      );

      if (accountsResult.rows.length !== 2) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          message: "One or both customer accounts were not found",
        });
      }

      const sender = accountsResult.rows.find((user) => user.id === senderId);
      const receiver = accountsResult.rows.find(
        (user) => user.id === receiverId,
      );

      if (Number(sender.balance) < amount) {
        await client.query("ROLLBACK");

        return res.status(400).json({
          message: "Insufficient funds for this transfer",
        });
      }

      const senderResult = await client.query(
        `UPDATE users
       SET balance = balance - $1
       WHERE id = $2
       RETURNING id, full_name, email, balance`,
        [amount, senderId],
      );

      const receiverResult = await client.query(
        `UPDATE users
       SET balance = balance + $1
       WHERE id = $2
       RETURNING id, full_name, email, balance`,
        [amount, receiverId],
      );

      await client.query(
        `INSERT INTO transactions (user_id, transaction_type, amount, description)
       VALUES ($1, 'transfer_sent', $2, $3)`,
        [senderId, amount, `Transfer to ${receiver.full_name}: ${description}`],
      );

      await client.query(
        `INSERT INTO transactions (user_id, transaction_type, amount, description)
       VALUES ($1, 'transfer_received', $2, $3)`,
        [
          receiverId,
          amount,
          `Transfer from ${sender.full_name}: ${description}`,
        ],
      );

      await client.query("COMMIT");

      sendTransactionEmail("transfer_sent", {
        email: senderResult.rows[0].email,
        fullName: senderResult.rows[0].full_name,
        amount,
        description,
        balance: senderResult.rows[0].balance,
        counterpartyName: receiver.full_name,
      });

      sendTransactionEmail("transfer_received", {
        email: receiverResult.rows[0].email,
        fullName: receiverResult.rows[0].full_name,
        amount,
        description,
        balance: receiverResult.rows[0].balance,
        counterpartyName: sender.full_name,
      });

      res.status(201).json({
        message: "Transfer completed successfully",
        sender: senderResult.rows[0],
        receiver: receiverResult.rows[0],
        amount,
      });
    } catch (error) {
      await client.query("ROLLBACK");

      res.status(500).json({
        message: "Transfer could not be completed",
      });
    } finally {
      client.release();
    }
  },
);

module.exports = router;
