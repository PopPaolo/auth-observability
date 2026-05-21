import { randomUUID } from "node:crypto";

import { NextFunction, Request, Response } from "express";

export const requestIdHeader = "X-Request-Id";

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incomingRequestId = req.header(requestIdHeader);
  const requestId = incomingRequestId?.trim() || randomUUID();

  res.locals.requestId = requestId;
  res.setHeader(requestIdHeader, requestId);

  next();
}
