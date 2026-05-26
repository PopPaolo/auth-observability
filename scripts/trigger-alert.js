const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_DURATION_SECONDS = 180;
const DEFAULT_DELAY_MS = 100;
// The latency alert uses rate(...[5m]) plus for: 2m, so this scenario needs a longer run.
const LOGIN_LATENCY_DURATION_SECONDS = 420;

// Each scenario sends one bounded request shape repeatedly so Prometheus rates cross one alert threshold.
const scenarios = {
  "5xx": {
    description: "High 5xx rate via /debug/error",
    request: () => get("/debug/error"),
  },
  "login-latency": {
    description: "High login latency via valid /login traffic",
    note: "Start the stack with AUTH_LOGIN_DELAY_MS=750 docker compose up --build before running this scenario.",
    defaultDurationSeconds: LOGIN_LATENCY_DURATION_SECONDS,
    expectedMinimumDurationMs: 500,
    request: () =>
      postJson("/login", {
        username: "walter.white",
        password: "say-my-name",
      }),
  },
  "failed-login": {
    description: "Failed login spike via invalid /login traffic",
    request: () =>
      postJson("/login", {
        username: "walter.white",
        password: "wrong",
      }),
  },
  "token-failure": {
    description: "Token validation failure spike via invalid /validate traffic",
    request: () =>
      get("/validate", {
        Authorization: "Bearer bad-token",
      }),
  },
};

const scenarioName = process.argv[2];
const scenario = scenarios[scenarioName];
const baseUrl = process.env.BASE_URL ?? DEFAULT_BASE_URL;
// Scenario defaults can override the general duration, while env vars still win for ad hoc tuning.
const durationSeconds = Number(process.env.DURATION_SECONDS ?? scenario?.defaultDurationSeconds ?? DEFAULT_DURATION_SECONDS);
const delayMs = Number(process.env.DELAY_MS ?? DEFAULT_DELAY_MS);

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  validateConfig();

  if (!scenario) {
    printUsage();
    process.exit(1);
  }

  console.log(`Scenario: ${scenario.description}`);
  console.log(`Target: ${baseUrl}`);
  console.log(`Duration: ${durationSeconds}s`);
  console.log(`Delay: ${delayMs}ms`);
  console.log("Prometheus alerts: http://localhost:9090/alerts");

  if (scenario.note) {
    console.log(`Note: ${scenario.note}`);
  }

  const stopAt = Date.now() + durationSeconds * 1000;
  const counts = new Map();
  // Client-side durations are only a sanity check; Prometheus evaluates server-side histogram buckets.
  const durations = [];

  // Sequential traffic keeps the effective request rate easy to reason about from DELAY_MS.
  while (Date.now() < stopAt) {
    const startedAt = performance.now();

    try {
      const response = await scenario.request();
      durations.push(performance.now() - startedAt);
      increment(counts, response.status);
      process.stdout.write(".");
    } catch (error) {
      durations.push(performance.now() - startedAt);
      increment(counts, "request_error");
      process.stdout.write("x");
    }

    await sleep(delayMs);
  }

  console.log("\n\nHTTP status counts:");
  printMap(counts);

  if (durations.length > 0) {
    const p95DurationMs = percentile(durations, 0.95);
    console.log(`\nObserved client-side p95 duration: ${Math.round(p95DurationMs)}ms`);

    // A low observed p95 usually means the container was not recreated with AUTH_LOGIN_DELAY_MS.
    if (scenario.expectedMinimumDurationMs && p95DurationMs < scenario.expectedMinimumDurationMs) {
      console.log(
        `Warning: observed latency is below ${scenario.expectedMinimumDurationMs}ms. ` +
          "Confirm auth-service was recreated with AUTH_LOGIN_DELAY_MS set.",
      );
    }
  }
}

function validateConfig() {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("DURATION_SECONDS must be a positive number.");
  }

  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("DELAY_MS must be a non-negative number.");
  }
}

function printUsage() {
  console.error("Usage: node scripts/trigger-alert.js <scenario>");
  console.error("");
  console.error("Scenarios:");

  for (const [name, candidate] of Object.entries(scenarios)) {
    console.error(`  ${name.padEnd(14)} ${candidate.description}`);
  }

  console.error("");
  console.error("Optional environment:");
  console.error(`  BASE_URL=http://localhost:3000`);
  console.error(`  DURATION_SECONDS=${DEFAULT_DURATION_SECONDS}`);
  console.error(`  DELAY_MS=${DEFAULT_DELAY_MS}`);
  console.error("");
  console.error(`The login-latency scenario defaults to DURATION_SECONDS=${LOGIN_LATENCY_DURATION_SECONDS}.`);
}

function get(path, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers,
  });
}

function postJson(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function printMap(map) {
  for (const [key, value] of map.entries()) {
    console.log(`${key}: ${value}`);
  }
}

function percentile(values, quantile) {
  const sortedValues = values.toSorted((left, right) => left - right);
  const index = Math.ceil(sortedValues.length * quantile) - 1;

  return sortedValues[Math.max(index, 0)];
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
