const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/auth");
const ensureAccountActive = require("../middleware/accountStatus");
const { sendTransactionEmail } = require("../utils/mailer");

const router = express.Router();

router.post(
  "/transfers/email",
  authenticateToken,
  ensureAccountActive,
  async (req, res) => {
    const senderId = req.user.userId;
    const receiverEmail = String(req.body.receiverEmail || "")
      .trim()
      .toLowerCase();
    const amount = Number(req.body.amount);
    const description = req.body.description || "Online transfer";

    if (!receiverEmail || !receiverEmail.includes("@")) {
      return res.status(400).json({
        message: "A valid recipient email is required",
      });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        message: "A positive transfer amount is required",
      });
    }

    if (receiverEmail === req.user.email.toLowerCase()) {
      return res.status(400).json({
        message: "You cannot transfer money to your own account",
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const accountsResult = await client.query(
        `SELECT id, full_name, email, balance
         FROM users
         WHERE id = $1 OR email = $2
         ORDER BY id
         FOR UPDATE`,
        [senderId, receiverEmail]
      );

      if (accountsResult.rows.length !== 2) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          message: "Recipient account was not found",
        });
      }

      const sender = accountsResult.rows.find(
        (user) => user.id === senderId
      );

      const receiver = accountsResult.rows.find(
        (user) => user.id !== senderId
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
        [amount, senderId]
      );

      const receiverResult = await client.query(
        `UPDATE users
         SET balance = balance + $1
         WHERE id = $2
         RETURNING id, full_name, email, balance`,
        [amount, receiver.id]
      );

      await client.query(
        `INSERT INTO transactions (user_id, transaction_type, amount, description)
         VALUES ($1, 'transfer_sent', $2, $3)`,
        [senderId, amount, `Transfer to ${receiver.full_name}: ${description}`]
      );

      await client.query(
        `INSERT INTO transactions (user_id, transaction_type, amount, description)
         VALUES ($1, 'transfer_received', $2, $3)`,
        [
          receiver.id,
          amount,
          `Transfer from ${sender.full_name}: ${description}`,
        ]
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
  }
);

module.exports = router;