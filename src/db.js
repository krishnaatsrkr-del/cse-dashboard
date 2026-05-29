require("dotenv").config();
const mongoose = require("mongoose");

let connectPromise = null;

function resolveMongoUri() {
  const rawValue = String(process.env.MONGODB_URI || process.env.MONGODB_UR || "").trim();
  const candidate = rawValue.replace(/^['"]|['"]$/g, "");
  if (!candidate) {
    const error = new Error("MONGODB_URI is required");
    error.code = "MONGODB_URI_MISSING";
    throw error;
  }
  if (!/^mongodb(\+srv)?:\/\//i.test(candidate)) {
    const error = new Error(
      "MONGODB_URI must start with mongodb:// or mongodb+srv:// (check for accidental extra characters)"
    );
    error.code = "MONGODB_URI_INVALID";
    throw error;
  }
  return candidate;
}

async function connectDb() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  if (connectPromise) {
    await connectPromise;
    return mongoose.connection;
  }

  connectPromise = mongoose.connect(resolveMongoUri(), {
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
    minPoolSize: 1,
  });

  try {
    await connectPromise;
    return mongoose.connection;
  } finally {
    connectPromise = null;
  }
}

function getDbStatus() {
  if (mongoose.connection.readyState === 1) {
    return "ok";
  }
  if (mongoose.connection.readyState === 2) {
    return "connecting";
  }
  return "error";
}

module.exports = {
  connectDb,
  getDbStatus,
  mongoose,
};
