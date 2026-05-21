import { Router } from "express";

export const debugRouter = Router();

// Predictable latency endpoint for testing dashboards and alerts.
debugRouter.get("/debug/slow", async (_req, res) => {
  await delay(1000);

  res.status(200).json({
    status: "slow_response_complete",
    delayMs: 1000,
  });
});

// Predictable failure endpoint for testing error-rate metrics.
debugRouter.get("/debug/error", (_req, res) => {
  res.status(500).json({
    error: "forced_debug_error",
  });
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
