import { NextFunction, Request, Response } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    // Keep logs safe: do not include bodies, passwords, tokens, or auth headers.
    console.log(
      JSON.stringify({
        event: "http_request",
        requestId: res.locals.requestId,
        method: req.method,
        route: req.route?.path ?? req.path,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
      }),
    );
  });

  next();
}
