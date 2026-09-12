const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function formatMoney(amount) {
  return `GHS ${Number(amount).toFixed(2)}`;
}

const SUBJECTS = {
  deposit: "Deposit received",
  withdrawal: "Withdrawal processed",
  transfer_sent: "Transfer sent",
  transfer_received: "Transfer received",
};

function buildMessage(type, { fullName, amount, description, balance, counterpartyName }) {
  const lines = [`Hi ${fullName},`, ""];

  switch (type) {
    case "deposit":
      lines.push(`A deposit of ${formatMoney(amount)} was credited to your account.`);
      break;
    case "withdrawal":
      lines.push(`A withdrawal of ${formatMoney(amount)} was made from your account.`);
      break;
    case "transfer_sent":
      lines.push(
        `You sent ${formatMoney(amount)} to ${counterpartyName || "a recipient"}.`,
      );
      break;
    case "transfer_received":
      lines.push(
        `You received ${formatMoney(amount)} from ${counterpartyName || "a sender"}.`,
      );
      break;
    default:
      lines.push(`A transaction of ${formatMoney(amount)} occurred on your account.`);
  }

  if (description) {
    lines.push(`Note: ${description}`);
  }

  lines.push("", `New balance: ${formatMoney(balance)}`, "", "If this wasn't you, contact support immediately.");

  return lines.join("\n");
}

async function sendTransactionEmail(type, recipient) {
  if (!process.env.SMTP_HOST) {
    // Email not configured — skip silently rather than failing the transaction.
    return;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "no-reply@bankingapp.local",
      to: recipient.email,
      subject: SUBJECTS[type] || "Account transaction",
      text: buildMessage(type, recipient),
    });
  } catch (error) {
    console.error(`Failed to send ${type} email to ${recipient.email}:`, error.message);
  }
}

module.exports = { sendTransactionEmail };
