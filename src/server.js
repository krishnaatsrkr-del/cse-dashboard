const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const multer = require("multer");
const { Worker } = require("worker_threads");

const { connectDb, getDbStatus, mongoose } = require("./db");
const { Student } = require("./models");
const {
  createPermission,
  listPermissions,
  softDeletePermission,
  updatePermission,
} = require("./permissionsService");
const { getStudentSummary } = require("./summaryService");
const { updateSubjectRecord } = require("./subjectService");

const app = express();
const PORT = Number.parseInt(process.env.PORT || "8000", 10);

const BASE_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(BASE_DIR, "public");
const STATIC_DIR = path.join(PUBLIC_DIR, "static");
const INDEX_PATH = path.join(PUBLIC_DIR, "index.html");
const FAVICON_PATH = path.join(PUBLIC_DIR, "favicon.ico");
const IMPORT_WORKER_PATH = path.join(__dirname, "importWorker.js");
const UPLOAD_TMP_DIR = path.join(os.tmpdir(), "student-dashboard-imports");
let importInProgress = false;

const importUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
        cb(null, UPLOAD_TMP_DIR);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      const ext = path.extname(String(file?.originalname || "")).toLowerCase() || ".xlsx";
      const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
      cb(null, uniqueName);
    },
  }),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(String(file?.originalname || "")).toLowerCase();
    const mime = String(file?.mimetype || "").toLowerCase();
    const knownExcelExt = ext === ".xlsx" || ext === ".xls";
    const knownExcelMime =
      mime.includes("spreadsheet") ||
      mime.includes("excel") ||
      mime === "application/octet-stream";
    if (knownExcelExt || knownExcelMime) {
      cb(null, true);
      return;
    }
    const error = new Error("Only Excel files (.xlsx, .xls) are supported");
    error.status = 422;
    cb(error);
  },
});

function normalizeRollNo(value) {
  return String(value || "").trim().toUpperCase();
}

function validateRequiredText(value, fieldName, maxLength) {
  if (typeof value !== "string") {
    const error = new Error(`${fieldName} is required`);
    error.status = 422;
    throw error;
  }
  const normalized = value.trim();
  if (!normalized) {
    const error = new Error(`${fieldName} is required`);
    error.status = 422;
    throw error;
  }
  if (normalized.length > maxLength) {
    const error = new Error(`${fieldName} exceeds max length ${maxLength}`);
    error.status = 422;
    throw error;
  }
  return normalized;
}

function validateOptionalText(value, fieldName, maxLength) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    const error = new Error(`${fieldName} must be a string`);
    error.status = 422;
    throw error;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length > maxLength) {
    const error = new Error(`${fieldName} exceeds max length ${maxLength}`);
    error.status = 422;
    throw error;
  }
  return normalized;
}

function validateOptionalNonEmptyText(value, fieldName, maxLength) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    const error = new Error(`${fieldName} must be a string`);
    error.status = 422;
    throw error;
  }
  const normalized = value.trim();
  if (!normalized) {
    const error = new Error(`${fieldName} cannot be empty`);
    error.status = 422;
    throw error;
  }
  if (normalized.length > maxLength) {
    const error = new Error(`${fieldName} exceeds max length ${maxLength}`);
    error.status = 422;
    throw error;
  }
  return normalized;
}

function parsePermissionCreate(body) {
  return {
    letter_no: validateRequiredText(body.letter_no, "letter_no", 100),
    permission_type: validateRequiredText(body.permission_type, "permission_type", 100),
    reason: validateOptionalText(body.reason, "reason", 500),
    issued_on: validateOptionalText(body.issued_on, "issued_on", 20),
    valid_from: validateOptionalText(body.valid_from, "valid_from", 20),
    valid_to: validateOptionalText(body.valid_to, "valid_to", 20),
    remarks: validateOptionalText(body.remarks, "remarks", 1000),
  };
}

function parsePermissionUpdate(body) {
  const payload = {};
  if (Object.hasOwn(body, "letter_no")) {
    payload.letter_no = validateOptionalNonEmptyText(body.letter_no, "letter_no", 100);
  }
  if (Object.hasOwn(body, "permission_type")) {
    payload.permission_type = validateOptionalNonEmptyText(body.permission_type, "permission_type", 100);
  }
  if (Object.hasOwn(body, "reason")) {
    payload.reason = validateOptionalText(body.reason, "reason", 500);
  }
  if (Object.hasOwn(body, "issued_on")) {
    payload.issued_on = validateOptionalText(body.issued_on, "issued_on", 20);
  }
  if (Object.hasOwn(body, "valid_from")) {
    payload.valid_from = validateOptionalText(body.valid_from, "valid_from", 20);
  }
  if (Object.hasOwn(body, "valid_to")) {
    payload.valid_to = validateOptionalText(body.valid_to, "valid_to", 20);
  }
  if (Object.hasOwn(body, "remarks")) {
    payload.remarks = validateOptionalText(body.remarks, "remarks", 1000);
  }
  return payload;
}

async function ensureStudentExists(rollNo) {
  const student = await Student.findOne({ roll_no: rollNo }).select({ roll_no: 1 }).lean();
  return Boolean(student);
}

function runImportInWorker(filePath) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(IMPORT_WORKER_PATH, {
      workerData: { filePath },
    });

    function finish(handler, value) {
      if (settled) {
        return;
      }
      settled = true;
      handler(value);
    }

    worker.once("message", (message) => {
      if (message?.ok) {
        finish(resolve, message.payload);
        return;
      }
      const error = new Error(message?.error?.message || "Import failed");
      if (message?.error?.code) {
        error.code = message.error.code;
      }
      finish(reject, error);
    });

    worker.once("error", (error) => finish(reject, error));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        finish(reject, new Error(`Import worker exited with code ${code}`));
      }
    });
  });
}

async function deleteTempFile(filePath) {
  if (!filePath) {
    return;
  }
  try {
    await fs.promises.unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn(`Failed to remove temp upload ${filePath}: ${error?.message || error}`);
    }
  }
}

app.use(express.json({ limit: "2mb" }));
app.use("/static", express.static(STATIC_DIR));

app.get("/", (req, res) => {
  res.sendFile(INDEX_PATH);
});

app.get("/favicon.ico", (req, res) => {
  if (fs.existsSync(FAVICON_PATH)) {
    res.sendFile(FAVICON_PATH);
    return;
  }
  res.status(204).end();
});

app.get("/api/health", async (req, res) => {
  const dbStatus = getDbStatus();
  let studentCount = 0;

  if (dbStatus === "ok") {
    studentCount = await Student.countDocuments();
  }

  res.json({
    overall: dbStatus === "ok" ? "ok" : "error",
    components: {
      database: {
        status: dbStatus,
        msg: `MongoDB (${mongoose.connection.name || "not-connected"}) | students=${studentCount}`,
      },
    },
  });
});

app.post("/api/import/results", importUpload.single("results_file"), async (req, res) => {
  const uploadedPath = req.file?.path || "";
  const uploadedFileName = req.file?.originalname || null;
  const inputPath = typeof req.body?.file_path === "string" ? req.body.file_path.trim() : "";
  const sourcePath = uploadedPath || inputPath;

  if (sourcePath.length < 3) {
    await deleteTempFile(uploadedPath);
    res
      .status(422)
      .json({ detail: "Upload an Excel file or provide a valid server file_path." });
    return;
  }
  if (importInProgress) {
    await deleteTempFile(uploadedPath);
    res.status(409).json({ detail: "Import already running. Please wait for it to finish." });
    return;
  }

  importInProgress = true;
  try {
    const payload = await runImportInWorker(sourcePath);
    if (uploadedFileName) {
      payload.uploaded_file = uploadedFileName;
    }
    res.json(payload);
  } catch (error) {
    if (error?.code === "ENOENT") {
      res.status(404).json({ detail: error.message });
      return;
    }
    res.status(500).json({ detail: `Import failed: ${error?.message || error}` });
  } finally {
    importInProgress = false;
    await deleteTempFile(uploadedPath);
  }
});

app.get("/api/students/:rollNo/summary", async (req, res) => {
  const rollNo = normalizeRollNo(req.params.rollNo);
  const summary = await getStudentSummary(rollNo);
  if (!summary) {
    res.status(404).json({ detail: `Student ${rollNo} not found` });
    return;
  }
  res.json(summary);
});

app.get("/api/students/:rollNo/permissions", async (req, res) => {
  const rollNo = normalizeRollNo(req.params.rollNo);
  const studentExists = await ensureStudentExists(rollNo);
  if (!studentExists) {
    res.status(404).json({ detail: `Student ${rollNo} not found` });
    return;
  }
  const items = await listPermissions(rollNo);
  res.json({ roll_no: rollNo, items });
});

app.post("/api/students/:rollNo/permissions", async (req, res) => {
  try {
    const rollNo = normalizeRollNo(req.params.rollNo);
    const studentExists = await ensureStudentExists(rollNo);
    if (!studentExists) {
      res.status(404).json({ detail: `Student ${rollNo} not found` });
      return;
    }

    const payload = parsePermissionCreate(req.body || {});
    const item = await createPermission(rollNo, payload);
    res.json({ item });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    res.status(status).json({ detail: error?.message || "Request failed" });
  }
});

app.put("/api/permissions/:permissionId", async (req, res) => {
  try {
    const permissionId = String(req.params.permissionId || "");
    if (!mongoose.Types.ObjectId.isValid(permissionId)) {
      res.status(422).json({ detail: "permission_id must be a valid identifier" });
      return;
    }

    const payload = parsePermissionUpdate(req.body || {});
    const item = await updatePermission(permissionId, payload);
    if (!item) {
      res.status(404).json({ detail: `Permission ${permissionId} not found` });
      return;
    }
    res.json({ item });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    res.status(status).json({ detail: error?.message || "Request failed" });
  }
});

app.delete("/api/permissions/:permissionId", async (req, res) => {
  const permissionId = String(req.params.permissionId || "");
  if (!mongoose.Types.ObjectId.isValid(permissionId)) {
    res.status(422).json({ detail: "permission_id must be a valid identifier" });
    return;
  }

  const deleted = await softDeletePermission(permissionId);
  if (!deleted) {
    res.status(404).json({ detail: `Permission ${permissionId} not found` });
    return;
  }
  res.json({ status: "deleted", permission_id: permissionId });
});

app.put("/api/subjects/:subjectId", async (req, res) => {
  const subjectId = String(req.params.subjectId || "");
  if (!mongoose.Types.ObjectId.isValid(subjectId)) {
    res.status(422).json({ detail: "subject_id must be a valid identifier" });
    return;
  }

  try {
    const payload = await updateSubjectRecord(subjectId, req.body || {});
    if (!payload) {
      res.status(404).json({ detail: `Subject ${subjectId} not found` });
      return;
    }
    res.json(payload);
  } catch (error) {
    if (error?.code === 11000) {
      res.status(409).json({ detail: "Subject update conflicts with an existing subject record" });
      return;
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    res.status(status).json({ detail: error?.message || "Request failed" });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ detail: "Uploaded file is too large (max 25MB)." });
      return;
    }
    res.status(400).json({ detail: error.message || "Invalid multipart upload payload" });
    return;
  }
  if (Number.isInteger(error?.status)) {
    res.status(error.status).json({ detail: error?.message || "Request failed" });
    return;
  }
  if (error instanceof SyntaxError && Object.hasOwn(error, "body")) {
    res.status(400).json({ detail: "Invalid JSON body" });
    return;
  }
  next(error);
});

async function startServer() {
  await connectDb();
  return new Promise((resolve) => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Student dashboard running on http://0.0.0.0:${PORT}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`Startup failed: ${error?.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
};