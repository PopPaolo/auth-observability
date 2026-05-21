import { NextFunction, Request, Response } from "express";

import { isValidLocalToken } from "../auth/localUser.js";
import { getBearerToken } from "../auth/token.js";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = getBearerToken(req.headers.authorization);

  if (!isValidLocalToken(token)) {
    res.status(401).json({
      error: "unauthorized",
    });
    return;
  }

  next();
}
