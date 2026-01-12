const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const dotenv = require("dotenv");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit per file
  },
});

// Middleware
app.use(cors());
app.use(express.json({ limit: "5gb" }));
app.use(express.urlencoded({ extended: true, limit: "5gb" }));

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/dataManager", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

// File/Data Item Schema
const DataItemSchema = new mongoose.Schema({
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  fileName: { type: String },
  fileType: { type: String },
  fileSize: { type: Number },
  isFile: { type: Boolean, default: false },
  downloaded: { type: Boolean, default: false },
  downloadedAt: { type: Date },
});

// Main Data Schema (can contain multiple items)
const DataSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  items: [DataItemSchema], // Array of files/data items
  verified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  verifiedAt: { type: Date },
});

const DataModel = mongoose.model("Data", DataSchema);

// Generate unique code (6 digits)
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// API Routes

// Generate code and store initial data (text/JSON) - supports multiple data items
app.post("/api/generate-code", async (req, res) => {
  try {
    const { data, multipleData } = req.body;

    if (!data && (!multipleData || multipleData.length === 0)) {
      return res.status(400).json({ error: "Data is required" });
    }

    let code;
    let isUnique = false;

    // Ensure code is unique
    while (!isUnique) {
      code = generateCode();
      const existing = await DataModel.findOne({ code });
      if (!existing) {
        isUnique = true;
      }
    }

    // Support both single data and multiple data items
    let items = [];
    if (multipleData && Array.isArray(multipleData)) {
      items = multipleData.map((item) => ({
        data: item,
        isFile: false,
        downloaded: false,
      }));
    } else {
      items = [
        {
          data: data,
          isFile: false,
          downloaded: false,
        },
      ];
    }

    const newData = new DataModel({
      code,
      items,
      verified: false,
    });

    await newData.save();

    res.json({
      success: true,
      code,
      itemCount: items.length,
      message: `${items.length} data item(s) stored and code generated successfully`,
    });
  } catch (error) {
    console.error("Error generating code:", error);
    res.status(500).json({ error: "Failed to generate code" });
  }
});

// Upload single or multiple files and generate code (up to 50 files, 5GB each)
app.post("/api/upload-file", upload.array("files", 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "At least one file is required" });
    }

    let code;
    let isUnique = false;

    // Ensure code is unique
    while (!isUnique) {
      code = generateCode();
      const existing = await DataModel.findOne({ code });
      if (!existing) {
        isUnique = true;
      }
    }

    // Process all files
    const items = req.files.map((file) => ({
      data: file.buffer.toString("base64"),
      fileName: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size,
      isFile: true,
      downloaded: false,
    }));

    const newData = new DataModel({
      code,
      items,
      verified: false,
    });

    await newData.save();

    res.json({
      success: true,
      code,
      items: items.map((item) => ({
        fileName: item.fileName,
        fileType: item.fileType,
        fileSize: item.fileSize,
      })),
      message: `${items.length} file(s) uploaded and code generated successfully`,
    });
  } catch (error) {
    console.error("Error uploading file:", error);
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: "File size exceeds 5GB limit. Please upload smaller files.",
      });
    }
    res.status(500).json({ error: "Failed to upload file: " + error.message });
  }
});

// Verify code and get data info (without downloading)
app.post("/api/verify-code", async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Code is required" });
    }

    const dataEntry = await DataModel.findOne({ code: code.toUpperCase() });

    if (!dataEntry) {
      return res.status(404).json({ error: "Invalid code" });
    }

    // Mark as verified
    dataEntry.verified = true;
    dataEntry.verifiedAt = new Date();
    await dataEntry.save();

    // Return all items metadata
    const items = dataEntry.items.map((item, index) => ({
      id: index,
      isFile: item.isFile,
      fileName: item.fileName,
      fileType: item.fileType,
      fileSize: item.fileSize,
      downloaded: item.downloaded,
      // Only return data if it's not a file (text/JSON)
      data: item.isFile ? null : item.data,
    }));

    res.json({
      success: true,
      code: dataEntry.code,
      items,
      itemCount: items.length,
      verified: true,
      createdAt: dataEntry.createdAt,
    });
  } catch (error) {
    console.error("Error verifying code:", error);
    res.status(500).json({ error: "Failed to verify code" });
  }
});

// Get data info by code
app.get("/api/data/:code", async (req, res) => {
  try {
    const { code } = req.params;

    const dataEntry = await DataModel.findOne({ code: code.toUpperCase() });

    if (!dataEntry) {
      return res.status(404).json({ error: "Data not found" });
    }

    const items = dataEntry.items.map((item, index) => ({
      id: index,
      isFile: item.isFile,
      fileName: item.fileName,
      fileType: item.fileType,
      fileSize: item.fileSize,
      downloaded: item.downloaded,
      data: item.isFile ? null : item.data,
    }));

    res.json({
      success: true,
      code: dataEntry.code,
      items,
      itemCount: items.length,
      verified: dataEntry.verified,
      createdAt: dataEntry.createdAt,
      verifiedAt: dataEntry.verifiedAt,
    });
  } catch (error) {
    console.error("Error fetching data:", error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// Download specific item by code and item index
app.get("/api/download/:code/:itemId", async (req, res) => {
  try {
    const { code, itemId } = req.params;
    const itemIndex = parseInt(itemId);

    const dataEntry = await DataModel.findOne({ code: code.toUpperCase() });

    if (!dataEntry) {
      return res.status(404).json({ error: "Data not found" });
    }

    if (itemIndex < 0 || itemIndex >= dataEntry.items.length) {
      return res.status(404).json({ error: "Item not found" });
    }

    const item = dataEntry.items[itemIndex];

    if (item.downloaded) {
      return res
        .status(410)
        .json({ error: "This item has already been downloaded" });
    }

    // Mark item as downloaded
    item.downloaded = true;
    item.downloadedAt = new Date();
    await dataEntry.save();

    if (item.isFile) {
      // Handle file download
      const fileBuffer = Buffer.from(item.data, "base64");
      const fileName = item.fileName || `file-${code}-${itemId}`;

      res.setHeader(
        "Content-Type",
        item.fileType || "application/octet-stream"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`
      );
      res.setHeader("Content-Length", fileBuffer.length);

      res.send(fileBuffer);
    } else {
      // Handle text/JSON data download
      const jsonData = JSON.stringify(
        {
          code: dataEntry.code,
          itemId: itemIndex,
          data: item.data,
          createdAt: dataEntry.createdAt,
        },
        null,
        2
      );

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="data-${code}-${itemId}.json"`
      );
      res.send(jsonData);
    }
  } catch (error) {
    console.error("Error downloading data:", error);
    res.status(500).json({ error: "Failed to download data" });
  }
});

// Delete entire code and all its data
app.delete("/api/data/:code", async (req, res) => {
  try {
    const { code } = req.params;

    const dataEntry = await DataModel.findOne({ code: code.toUpperCase() });

    if (!dataEntry) {
      return res.status(404).json({ error: "Data not found" });
    }

    await DataModel.deleteOne({ code: code.toUpperCase() });

    res.json({
      success: true,
      message: "Data deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting data:", error);
    res.status(500).json({ error: "Failed to delete data" });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server accessible at http://localhost:${PORT}`);
  console.log(`Server accessible on network at http://YOUR_IP:${PORT}`);
});
