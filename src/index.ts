import express from "express";

import { authRouter } from "./routes/auth.js";
import { debugRouter } from "./routes/debug.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const host = "0.0.0.0";

app.use(express.json());
app.use(authRouter);
app.use(debugRouter);

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
  });
});

app.listen(port, host, () => {
  console.log(`Service listening on ${host}:${port}`);
});
