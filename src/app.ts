import express from "express";

import { requestId } from "./middleware/requestId.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { metricsMiddleware, metricsRegister } from "./metrics.js";
import { authRouter } from "./routes/auth.js";
import { debugRouter } from "./routes/debug.js";

export const app = express();

app.use(requestId);
app.use(requestLogger);
app.use(metricsMiddleware);
app.use(express.json());
app.use(authRouter);
app.use(debugRouter);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
  });
});

app.get("/metrics", async (_req, res) => {
  // Prometheus expects this endpoint to return text in its exposition format.
  res.setHeader("Content-Type", metricsRegister.contentType);
  res.status(200).send(await metricsRegister.metrics());
});
