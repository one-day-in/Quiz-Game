const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

/* =====================
   MEDIA DIRECTORY
   ВАЖЛИВО: process.cwd()
===================== */
const MEDIA_DIR = path.join(process.cwd(), "media");
console.log("MEDIA_DIR =", MEDIA_DIR);

/* =====================
   ENSURE MEDIA FOLDER
===================== */
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

/* =====================
   MULTER CONFIG
===================== */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, MEDIA_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.random().toString(36).slice(2);
    cb(null, name + ext);
  }
});

const upload = multer({ storage });

/* =====================
   MIDDLEWARE
===================== */
app.use(express.json());
const PUBLIC_DIR = path.join(process.cwd(), "public");
app.use(express.static(PUBLIC_DIR));

app.use("/media", express.static(MEDIA_DIR));

/* =====================
   UPLOAD
===================== */
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  res.json({
    path: "media/" + req.file.filename
  });
});

/* =====================
   RESET MEDIA (DELETE FILES)
===================== */
app.post("/reset-media", (_req, res) => {
  try {
    if (fs.existsSync(MEDIA_DIR)) {
      fs.readdirSync(MEDIA_DIR).forEach((file) => {
        fs.unlinkSync(path.join(MEDIA_DIR, file));
      });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("RESET MEDIA ERROR:", err);
    res.status(500).json({ ok: false });
  }
});

/* =====================
   START SERVER
===================== */
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
