import { Router } from "express";

import { isValidLocalLogin, isValidLocalToken, localTestUser } from "../auth/localUser.js";
import { getBearerToken } from "../auth/token.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { authLoginAttemptsTotal, authTokenValidationAttemptsTotal } from "../metrics.js";

export const authRouter = Router();

// Local-only login flow for exercising auth metrics without real user data.
authRouter.post("/login", (req, res) => {
  const { username, password } = req.body as {
    username?: string;
    password?: string;
  };

  if (!isValidLocalLogin(username, password)) {
    res.locals.authFlow = "login";
    res.locals.authOutcome = "failure";
    res.locals.failureReason = "invalid_credentials";

    // Count only bounded outcomes, never usernames or credential values.
    authLoginAttemptsTotal.inc({
      outcome: "failure",
    });

    res.status(401).json({
      error: "invalid_credentials",
    });
    return;
  }

  // Count only bounded outcomes, never usernames or credential values.
  res.locals.authFlow = "login";
  res.locals.authOutcome = "success";

  authLoginAttemptsTotal.inc({
    outcome: "success",
  });

  res.status(200).json({
    token: localTestUser.token,
  });
});

authRouter.get("/validate", (req, res) => {
  const token = getBearerToken(req.headers.authorization);

  if (!isValidLocalToken(token)) {
    res.locals.authFlow = "token_validation";
    res.locals.authOutcome = "failure";
    res.locals.failureReason = token === null ? "missing_token" : "invalid_token";

    // Count validation outcomes without recording token contents.
    authTokenValidationAttemptsTotal.inc({
      outcome: "failure",
    });

    res.status(401).json({
      error: "invalid_token",
    });
    return;
  }

  // Count validation outcomes without recording token contents.
  res.locals.authFlow = "token_validation";
  res.locals.authOutcome = "success";

  authTokenValidationAttemptsTotal.inc({
    outcome: "success",
  });

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
