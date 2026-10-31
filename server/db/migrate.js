const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Client } = require("pg");

const serverDirectory = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(serverDirectory, ".env") });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Add it to server/.env");
}

const migrationsDirectory = path.join(__dirname, "migrations");
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function runMigrations() {
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const files = fs
      .readdirSync(migrationsDirectory)
      .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
      .sort();

    for (const filename of files) {
      await client.query("BEGIN");
      try {
        const applied = await client.query(
          "SELECT 1 FROM admin_schema_migrations WHERE filename = $1",
          [filename]
        );
        if (applied.rowCount) {
          await client.query("COMMIT");
          console.log(`Already applied: ${filename}`);
          continue;
        }

        const sql = fs.readFileSync(
          path.join(migrationsDirectory, filename),
          "utf8"
        );
        await client.query(sql);
        await client.query(
          "INSERT INTO admin_schema_migrations (filename) VALUES ($1)",
          [filename]
        );
        await client.query("COMMIT");
        console.log(`Applied: ${filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${filename} failed: ${error.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

runMigrations().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
