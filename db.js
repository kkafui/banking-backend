const { Pool } = require("pg");

const isLocalHost = ["localhost", "127.0.0.1"].includes(process.env.DB_HOST);

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: isLocalHost ? false : { rejectUnauthorized: false },
});

module.exports = pool;
