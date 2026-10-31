
const pool = require("../config/db");
const bcrypt = require("bcryptjs");

const register = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Validate required fields
        if (!name || !email || !password) {
            return res.status(400).json({
                message: "All fields are required"
            });
        }

        // Password validation
        const passwordRegex =
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$/;

        if (!passwordRegex.test(password)) {
            return res.status(400).json({
                message: "Password must contain more than 8 characters, uppercase, lowercase and special character"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Check existing user
        const existingUser = await pool.query(
            "SELECT id FROM users WHERE email = $1",
            [normalizedEmail]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                message: "Email already registered"
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(
            password,
            Number(process.env.BCRYPT_ROUNDS) || 12
        );

        // Insert customer
        const result = await pool.query(
            `INSERT INTO users (name, email, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, name, email, role, status, created_at`,
            [name.trim(), normalizedEmail, hashedPassword]
        );

        return res.status(201).json({
            message: "Registration successful",
            user: result.rows[0]
        });

    } catch (error) {
        console.error("Registration error:", error);

        return res.status(500).json({
            message: "Internal server error"
        });
    }
};

module.exports = { register };
