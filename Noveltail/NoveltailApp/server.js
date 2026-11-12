
require("dotenv").config();

const { validateRuntimeConfig } = require("./config/runtime-validation");
try {
    validateRuntimeConfig();
} catch (error) {
    if (require.main !== module) throw error;
    console.error("Noveltail startup validation failed", { reason: error.message });
    process.exit(1);
}

const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const pool = require("./db");
const { csrfProtection } = require("./middleware/csrf");

const authRoutes = require("./routes/auth");
const novelRoutes = require("./routes/novels");
const writerRoutes = require("./routes/writer");
const bookmarkRoutes = require("./routes/bookmarks");
const commentRoutes = require("./routes/comments");
const reviewRoutes = require("./routes/reviews");
const reactionRoutes = require("./routes/reactions");
const historyRoutes = require("./routes/history");
const profileRoutes = require("./routes/profile");
const uploadRoutes = require("./routes/uploads");
const walletRoutes = require("./routes/wallet");
const notificationRoutes = require("./routes/notifications");
const followRoutes = require("./routes/follows");
const adminRoutes = require("./routes/admin");
const appealRoutes = require("./routes/appeals");
const reportRoutes = require("./routes/reports");
const announcementRoutes = require("./routes/announcements");
const { startAnnouncementScheduler } =
    require("./services/announcement-service");

const app = express();
app.disable("x-powered-by");
const PORT = process.env.PORT || 3000;
const trustedProxyHops = process.env.TRUST_PROXY_HOPS;
if (trustedProxyHops && /^\d+$/.test(trustedProxyHops)) {
    app.set("trust proxy", Number(trustedProxyHops));
}

// =====================================
// Middleware
// =====================================

app.use((req, res, next) => {
    res.set({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
    });
    if (process.env.NODE_ENV === "production" && req.secure) {
        res.set("Strict-Transport-Security", "max-age=31536000");
    }
    next();
});

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(csrfProtection);

// =====================================
// Database Test
// =====================================

app.get("/api/test-db", async (req, res) => {
    try {
        await pool.query("SELECT NOW()");

        res.json({
            message: "Database connected"
        });

    } catch (error) {
        console.error("Database health check failed", {
            code: error.code || "UNKNOWN"
        });

        res.status(500).json({
            message: "Database connection failed"
        });
    }
});

// =====================================
// API Routes
// =====================================

app.use("/api/auth", authRoutes);
app.use("/api/novels", novelRoutes);
app.use("/api/writer", writerRoutes);
app.use("/api/bookmarks", bookmarkRoutes);
app.use("/api/comments", commentRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/reactions", reactionRoutes);
app.use("/api/history", historyRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/follows", followRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/appeals", appealRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/announcements", announcementRoutes);

// Upload API
app.use("/api/uploads", uploadRoutes);

// =====================================
// Static Files
// =====================================

// รูปโปรไฟล์และรูปปกนิยาย
app.use(
    "/uploads",
    express.static(path.join(__dirname, "uploads"))
);

// ไฟล์ HTML, CSS, JavaScript
app.use(express.static(path.join(__dirname, "public")));

// =====================================
// 404 Not Found
// =====================================

app.use((req, res) => {
    res.status(404).json({
        message: "Page or API not found."
    });
});

// =====================================
// Global Error Handler
// =====================================

app.use((error, req, res, next) => {
    console.error("Unhandled request error", {
        name: error.name || "Error",
        code: error.code || "UNKNOWN",
        method: req.method,
        path: req.path
    });

    res.status(500).json({
        message: "An internal server error occurred."
    });
});

// =====================================
// Start Server
// =====================================

async function startServer() {
    if (process.env.NODE_ENV === "production") {
        const { validateProductionDatabase } =
            require("./config/production-database");
        await validateProductionDatabase(pool, process.env.DB_NAME);
    }

    return app.listen(PORT, () => {
        startAnnouncementScheduler();
        console.log(`Noveltail server listening on port ${PORT}`);
    });
}

if (require.main === module) {
    startServer().catch(async error => {
        console.error("Noveltail startup validation failed", {
            reason: error.message
        });
        await pool.end();
        process.exitCode = 1;
    });
}

module.exports = app;
module.exports.startServer = startServer;
