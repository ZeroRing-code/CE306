const express = require("express");
const path = require("path");


const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend files
app.use(express.static(path.join(__dirname, "public")));

// Test API
app.get("/api/status", (req, res) => {
res.json({
success: true,
message: "Welcome to NovelHub API!",
status: "Running"
});
});

// Start server
app.listen(PORT, () => {
  console.log("--------------------------------");
  console.log("NovelHub Server is running!");
  console.log("http://localhost:" + PORT);
  console.log("--------------------------------");
});