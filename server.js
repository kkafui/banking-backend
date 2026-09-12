require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");

const pool = require("./db");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const bankingRoutes = require("./routes/bankingRoutes");
const emailTransferRoutes = require("./routes/emailTransferRoutes");
const recipientRoutes = require("./routes/recipientRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();
const PORT = 3000;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many login attempts. Please try again in 15 minutes.",
  },
});

app.use(helmet());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/auth/login", loginLimiter);

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      message: "Database connection is healthy",
      databaseTime: result.rows[0].now,
    });
  } catch (error) {
    console.error("HEALTH CHECK ERROR:", error); // TEMP — remove after debugging

    res.status(500).json({
      message: "Database connection failed",
    });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api", userRoutes);
app.use("/api", bankingRoutes);
app.use("/api", emailTransferRoutes);
app.use("/api", recipientRoutes);
app.use("/api", adminRoutes);

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
