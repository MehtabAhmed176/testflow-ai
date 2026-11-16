import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import type { ErrorRequestHandler } from "express";
import { formsRouter } from "./routes/forms.js";
import { documentsRouter } from "./routes/documents.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const mongoUri = process.env.MONGODB_URI;

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
}));

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error(error);

  const invalidJson =
    error instanceof SyntaxError &&
    (error as { type?: string }).type === "entity.parse.failed";

  res.status(invalidJson ? 400 : 500).json({
    message: invalidJson ? "Invalid JSON body" : "Internal server error",
  });
};

app.use(errorHandler);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  const connected = mongoose.connection.readyState === 1;

  res.status(connected ? 200 : 503).json({
    status: connected ? "ok" : "unavailable",
    database: connected ? "connected" : "disconnected",
  });
});
// Api routes
app.use("/api/forms", formsRouter);
app.use("/api/documents", documentsRouter);


async function start() {
  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing from server/.env");
  }

  await mongoose.connect(mongoUri);
  console.log("MongoDB connected");

  app.listen(port, () => {
    console.log(`Backend running at http://localhost:${port}`);
  });
}

start().catch((error: unknown) => {
  console.error(
    "Failed to start backend:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});