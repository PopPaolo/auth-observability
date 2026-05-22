import { NextFunction, Request, Response } from "express";

import { isValidLocalToken } from "../auth/localUser.js";
import { getBearerToken } from "../auth/token.js";
import { authAuthorizationFailuresTotal } from "../metrics.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = getBearerToken(req.headers.authorization);

  if (!isValidLocalToken(token)) {
    // Keep the reason label bounded and do not expose token contents.
    authAuthorizationFailuresTotal.inc({
      reason: token === null ? "missing_token" : "invalid_token",
    });

    res.status(401).json({
      error: "unauthorized",
    });
    return;
  }

  next();
}
