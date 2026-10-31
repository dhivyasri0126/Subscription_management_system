const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.join(__dirname, "../.env") });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Add it to server/.env");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function runSchema() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(schema);
    console.log("Database schema applied successfully.");
  } catch (error) {
    console.error("Schema application failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

runSchema();