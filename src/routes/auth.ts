import { Router } from "express";

import { isValidLocalLogin, isValidLocalToken, localTestUser } from "../auth/localUser.js";
import { getBearerToken } from "../auth/token.js";
import { requireAuth } from "../middleware/requireAuth.js";

export const authRouter = Router();

// Local-only login flow for exercising auth metrics without real user data.
authRouter.post("/login", (req, res) => {
  const { username, password } = req.body as {
    username?: string;
    password?: string;
  };

  if (!isValidLocalLogin(username, password)) {
    res.status(401).json({
      error: "invalid_credentials",
    });
    return;
  }

  res.status(200).json({
    token: localTestUser.token,
  });
});

authRouter.get("/validate", (req, res) => {
  const token = getBearerToken(req.headers.authorization);

  if (!isValidLocalToken(token)) {
    res.status(401).json({
      error: "invalid_token",
    });
    return;
  }

  res.status(200).json({
    valid: true,
  });
});

authRouter.get("/profile", requireAuth, (_req, res) => {
  res.status(200).json({
    username: localTestUser.username,
    displayName: localTestUser.displayName,
  });
});
