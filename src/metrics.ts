import { NextFunction, Request, Response } from "express";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

export const metricsRegister = new Registry();

// Collect Node.js process/runtime metrics alongside the service-specific metrics.
collectDefaultMetrics({
  register: metricsRegister,
});

const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests.",
  labelNames: ["route", "method", "status"],
  registers: [metricsRegister],
});

const httpRequestDurationSeconds = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["route", "method"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegister],
});

export const authLoginAttemptsTotal = new Counter({
  name: "auth_login_attempts_total",
  help: "Total number of local login attempts.",
  labelNames: ["outcome"],
  registers: [metricsRegister],
});

export const authTokenValidationAttemptsTotal = new Counter({
  name: "auth_token_validation_attempts_total",
  help: "Total number of token validation attempts.",
  labelNames: ["outcome"],
  registers: [metricsRegister],
});

export const authAuthorizationFailuresTotal = new Counter({
  name: "auth_authorization_failures_total",
  help: "Total number of protected-route authorization failures.",
  labelNames: ["reason"],
  registers: [metricsRegister],
});

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Start timing before route handlers run and record the final status after response finish.
  const endTimer = httpRequestDurationSeconds.startTimer({ method: req.method });

  res.on("finish", () => {
    const route = typeof req.route?.path === "string" ? req.route.path : "unmatched";

    httpRequestsTotal.inc({
      route,
      method: req.method,
      status: String(res.statusCode),
    });

    endTimer({
      route,
      method: req.method,
    });
  });

  next();
}
