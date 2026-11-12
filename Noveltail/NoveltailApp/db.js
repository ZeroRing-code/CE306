require("dotenv").config();

const fs = require("node:fs");
const { Pool } = require("pg");

const poolMax = Number(process.env.DB_POOL_MAX || 10);
const ssl = process.env.DB_SSL === "true"
    ? { rejectUnauthorized: true }
    : false;
const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
});

pool.on("error", error => {
    console.error("Unexpected idle database client error", {
        code: error.code || "UNKNOWN"
    });
});

module.exports = pool;