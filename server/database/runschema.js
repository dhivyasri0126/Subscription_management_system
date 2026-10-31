const fs = require("fs");
const path = require("path");
const pool = require("../config/db");

async function runSchema() {
    try {
        const schemaPath = path.join(__dirname, "schema.sql");
        const sql = fs.readFileSync(schemaPath, "utf8");

        await pool.query(sql);

        console.log("Database schema created successfully!");
    } catch (error) {
        console.error("Schema creation failed:", error.message);
    } finally {
        await pool.end();
    }
}

runSchema();