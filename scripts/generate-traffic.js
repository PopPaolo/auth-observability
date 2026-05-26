const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_DURATION_SECONDS = 120;
const DEFAULT_DELAY_MS = 250;

const baseUrl = process.env.BASE_URL ?? DEFAULT_BASE_URL;
const durationSeconds = Number(process.env.DURATION_SECONDS ?? DEFAULT_DURATION_SECONDS);
const delayMs = Number(process.env.DELAY_MS ?? DEFAULT_DELAY_MS);
const token = "heisenberg-local-token";

// Login traffic is weighted toward the valid local user so the service looks mostly healthy,
// while still producing enough failed-login events for metrics, logs, and alerts.
const loginAttempts = [
  {
    name: "valid_credentials",
    weight: 14,
    body: () => ({ username: "walter.white", password: "say-my-name" }),
  },
  {
    name: "wrong_password",
    weight: 3,
    body: () => ({ username: "walter.white", password: pick(["wrong", "not-the-one", "blue-sky"]) }),
  },
  {
    name: "unknown_user",
    weight: 1,
    body: () => ({ username: pick(["jesse.pinkman", "saul.goodman", "gus.fring"]), password: "say-my-name" }),
  },
  {
    name: "missing_password",
    weight: 1,
    body: () => ({ username: "walter.white" }),
  },
  {
    name: "missing_username",
    weight: 1,
    body: () => ({ password: "say-my-name" }),
  },
  {
    name: "empty_body",
    weight: 1,
    body: () => ({}),
  },
  {
    name: "random_credentials",
    weight: 1,
    body: () => ({ username: `user-${randomId()}`, password: `pass-${randomId()}` }),
  },
];

// These variants exercise successful validation, invalid tokens, missing headers, and malformed
// auth headers without sending real secrets or high-cardinality user data.
const tokenVariants = [
  { name: "valid_token", weight: 14, headers: () => ({ Authorization: `Bearer ${token}` }) },
  { name: "bad_token", weight: 3, headers: () => ({ Authorization: `Bearer bad-token-${randomId()}` }) },
  { name: "empty_bearer", weight: 1, headers: () => ({ Authorization: "Bearer " }) },
  { name: "wrong_scheme", weight: 1, headers: () => ({ Authorization: `Basic ${randomId()}` }) },
  { name: "missing_header", weight: 1, headers: () => ({}) },
  { name: "malformed_header", weight: 1, headers: () => ({ Authorization: randomId() }) },
];

// Random 404s verify that route labels stay bounded as "unmatched" in Prometheus.
const unknownPaths = [
  () => `/unknown/${randomId()}`,
  () => `/debug/missing-${randomId()}`,
  () => `/profile/${randomId()}`,
  () => `/login/${randomId()}`,
];

// Keep normal traffic common while creating varied auth failures, 5xxs, latency samples, and 404s.
const scenarios = [
  { name: "health", weight: 10, request: () => get("/health") },
  { name: "login", weight: 9, request: loginRequest },
  { name: "validate", weight: 8, request: validateRequest },
  { name: "profile", weight: 6, request: profileRequest },
  { name: "debug_error", weight: 1, request: () => get("/debug/error") },
  { name: "debug_slow", weight: 1, request: () => get("/debug/slow") },
  { name: "unknown_route", weight: 1, request: () => get(pick(unknownPaths)()) },
];

const counts = new Map();
const statuses = new Map();

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  validateConfig();

  const stopAt = Date.now() + durationSeconds * 1000;
  console.log(`Generating fake traffic against ${baseUrl} for ${durationSeconds}s.`);

  // Sequential requests make DELAY_MS easy to reason about while watching dashboard rates.
  while (Date.now() < stopAt) {
    const scenario = chooseScenario();

    try {
      const response = await scenario.request();
      // Variant-specific buckets make it clear which random auth paths ran during a demo.
      increment(counts, scenario.lastVariant ? `${scenario.name}_${scenario.lastVariant}` : scenario.name);
      increment(statuses, response.status);
      process.stdout.write(".");
    } catch (error) {
      increment(counts, `${scenario.name}_error`);
      process.stdout.write("x");
    }

    await sleep(delayMs);
  }

  console.log("\n\nScenario counts:");
  printMap(counts);
  console.log("\nHTTP status counts:");
  printMap(statuses);
}

function validateConfig() {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("DURATION_SECONDS must be a positive number.");
  }

  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error("DELAY_MS must be a non-negative number.");
  }
}

function chooseScenario() {
  // Pick one scenario from the weighted list without pulling in a dependency.
  const totalWeight = scenarios.reduce((sum, scenario) => sum + scenario.weight, 0);
  let remaining = Math.random() * totalWeight;

  for (const scenario of scenarios) {
    remaining -= scenario.weight;

    if (remaining <= 0) {
      return scenario;
    }
  }

  return scenarios.at(-1);
}

function loginRequest() {
  const attempt = pickWeighted(loginAttempts);
  const scenario = scenarios.find((candidate) => candidate.name === "login");
  // Store the chosen variant so the final summary can show more than just "login".
  scenario.lastVariant = attempt.name;

  return postJson("/login", attempt.body());
}

function validateRequest() {
  const variant = pickWeighted(tokenVariants);
  const scenario = scenarios.find((candidate) => candidate.name === "validate");
  // Store the chosen variant so success, invalid token, and malformed header paths are visible.
  scenario.lastVariant = variant.name;

  return get("/validate", variant.headers());
}

function profileRequest() {
  const variant = pickWeighted(tokenVariants);
  const scenario = scenarios.find((candidate) => candidate.name === "profile");
  // Reuse token variants so protected-route authorization logs have the same realistic spread.
  scenario.lastVariant = variant.name;

  return get("/profile", variant.headers());
}

function get(path, headers = {}) {
  return fetch(`${baseUrl}${path}`, { headers });
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

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function pickWeighted(items) {
  // Weighting keeps successful traffic dominant while sampling failure modes often enough
  // for Grafana and Loki to show useful activity.
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let remaining = Math.random() * totalWeight;

  for (const item of items) {
    remaining -= item.weight;

    if (remaining <= 0) {
      return item;
    }
  }

  return items.at(-1);
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
