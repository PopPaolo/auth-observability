const assert = require("node:assert/strict");
const { after, before, describe, it } = require("node:test");
const request = require("supertest");

const { app } = require("../dist/app.js");

const originalLog = console.log;

before(() => {
  console.log = () => {};
});

after(() => {
  console.log = originalLog;
});

describe("health and request IDs", () => {
  it("returns health status and preserves incoming request ID", async () => {
    const incomingRequestId = "test-request-id";
    const response = await request(app).get("/health").set("X-Request-Id", incomingRequestId);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: "ok" });
    assert.equal(response.headers["x-request-id"], incomingRequestId);
  });

  it("generates a request ID when one is not provided", async () => {
    const response = await request(app).get("/health");

    assert.equal(response.status, 200);
    assert.match(response.headers["x-request-id"], /^[0-9a-f-]{36}$/);
  });
});

describe("login", () => {
  it("returns a token-like value for valid local credentials", async () => {
    const response = await request(app)
      .post("/login")
      .send({ username: "walter.white", password: "say-my-name" });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      token: "heisenberg-local-token",
    });
  });

  it("rejects invalid credentials", async () => {
    const response = await request(app)
      .post("/login")
      .send({ username: "walter.white", password: "wrong" });

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      error: "invalid_credentials",
    });
  });
});

describe("token validation", () => {
  it("accepts a valid bearer token", async () => {
    const response = await request(app)
      .get("/validate")
      .set("Authorization", "Bearer heisenberg-local-token");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      valid: true,
    });
  });

  it("rejects an invalid bearer token", async () => {
    const response = await request(app).get("/validate").set("Authorization", "Bearer bad-token");

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      error: "invalid_token",
    });
  });
});

describe("profile authorization", () => {
  it("rejects missing authorization", async () => {
    const response = await request(app).get("/profile");

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      error: "unauthorized",
    });
  });

  it("rejects invalid authorization", async () => {
    const response = await request(app).get("/profile").set("Authorization", "Bearer bad-token");

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      error: "unauthorized",
    });
  });

  it("returns the local profile for valid authorization", async () => {
    const response = await request(app)
      .get("/profile")
      .set("Authorization", "Bearer heisenberg-local-token");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      username: "walter.white",
      displayName: "Walter White",
    });
  });
});

describe("debug endpoints", () => {
  it("returns a predictable slow response", async () => {
    const startedAt = performance.now();
    const response = await request(app).get("/debug/slow");
    const durationMs = performance.now() - startedAt;

    assert.equal(response.status, 200);
    assert.equal(response.body.status, "slow_response_complete");
    assert.equal(response.body.delayMs, 1000);
    assert.ok(durationMs >= 900);
  });

  it("returns a predictable error response", async () => {
    const response = await request(app).get("/debug/error");

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      error: "forced_debug_error",
    });
  });
});

describe("metrics", () => {
  it("exposes Prometheus text and default process metrics", async () => {
    const response = await request(app).get("/metrics");

    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /text\/plain/);
    assert.match(response.text, /# HELP process_cpu_user_seconds_total/);
  });

  it("records HTTP request count and duration by route, method, and status", async () => {
    const beforeMetrics = await getMetricText();
    const beforeHealthCount = getMetricValue(beforeMetrics, "http_requests_total", {
      method: "GET",
      route: "/health",
      status: "200",
    });

    await request(app).get("/health");

    const afterMetrics = await getMetricText();
    const afterHealthCount = getMetricValue(afterMetrics, "http_requests_total", {
      method: "GET",
      route: "/health",
      status: "200",
    });

    assert.equal(afterHealthCount, beforeHealthCount + 1);
    assert.match(afterMetrics, /http_request_duration_seconds_bucket\{le="[^"]+",method="GET",route="\/health"\}/);
  });

  it("records login outcomes", async () => {
    const beforeMetrics = await getMetricText();
    const beforeSuccess = getMetricValue(beforeMetrics, "auth_login_attempts_total", {
      outcome: "success",
    });
    const beforeFailure = getMetricValue(beforeMetrics, "auth_login_attempts_total", {
      outcome: "failure",
    });

    await request(app).post("/login").send({ username: "walter.white", password: "say-my-name" });
    await request(app).post("/login").send({ username: "walter.white", password: "wrong" });

    const afterMetrics = await getMetricText();

    assert.equal(
      getMetricValue(afterMetrics, "auth_login_attempts_total", { outcome: "success" }),
      beforeSuccess + 1,
    );
    assert.equal(
      getMetricValue(afterMetrics, "auth_login_attempts_total", { outcome: "failure" }),
      beforeFailure + 1,
    );
  });

  it("records token validation outcomes", async () => {
    const beforeMetrics = await getMetricText();
    const beforeSuccess = getMetricValue(beforeMetrics, "auth_token_validation_attempts_total", {
      outcome: "success",
    });
    const beforeFailure = getMetricValue(beforeMetrics, "auth_token_validation_attempts_total", {
      outcome: "failure",
    });

    await request(app).get("/validate").set("Authorization", "Bearer heisenberg-local-token");
    await request(app).get("/validate").set("Authorization", "Bearer bad-token");

    const afterMetrics = await getMetricText();

    assert.equal(
      getMetricValue(afterMetrics, "auth_token_validation_attempts_total", { outcome: "success" }),
      beforeSuccess + 1,
    );
    assert.equal(
      getMetricValue(afterMetrics, "auth_token_validation_attempts_total", { outcome: "failure" }),
      beforeFailure + 1,
    );
  });

  it("records protected-route authorization failure reasons", async () => {
    const beforeMetrics = await getMetricText();
    const beforeMissing = getMetricValue(beforeMetrics, "auth_authorization_failures_total", {
      reason: "missing_token",
    });
    const beforeInvalid = getMetricValue(beforeMetrics, "auth_authorization_failures_total", {
      reason: "invalid_token",
    });

    await request(app).get("/profile");
    await request(app).get("/profile").set("Authorization", "Bearer bad-token");

    const afterMetrics = await getMetricText();

    assert.equal(
      getMetricValue(afterMetrics, "auth_authorization_failures_total", { reason: "missing_token" }),
      beforeMissing + 1,
    );
    assert.equal(
      getMetricValue(afterMetrics, "auth_authorization_failures_total", { reason: "invalid_token" }),
      beforeInvalid + 1,
    );
  });

  it("uses a bounded label for unmatched routes", async () => {
    const beforeMetrics = await getMetricText();
    const beforeUnmatched = getMetricValue(beforeMetrics, "http_requests_total", {
      method: "GET",
      route: "unmatched",
      status: "404",
    });

    await request(app).get("/unknown/raw/path/123");

    const afterMetrics = await getMetricText();

    assert.equal(
      getMetricValue(afterMetrics, "http_requests_total", {
        method: "GET",
        route: "unmatched",
        status: "404",
      }),
      beforeUnmatched + 1,
    );
    assert.doesNotMatch(afterMetrics, /unknown\/raw\/path\/123/);
  });
});

async function getMetricText() {
  const response = await request(app).get("/metrics");

  assert.equal(response.status, 200);
  return response.text;
}

function getMetricValue(metricsText, metricName, labels) {
  const matchingLine = metricsText
    .split("\n")
    .find((line) => line.startsWith(`${metricName}{`) && hasLabels(line, labels));

  if (!matchingLine) {
    return 0;
  }

  const value = matchingLine.split(" ").at(-1);

  return Number(value);
}

function hasLabels(metricLine, labels) {
  return Object.entries(labels).every(([key, value]) => metricLine.includes(`${key}="${value}"`));
}
