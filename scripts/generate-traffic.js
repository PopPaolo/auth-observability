const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_DURATION_SECONDS = 120;
const DEFAULT_DELAY_MS = 250;

const baseUrl = process.env.BASE_URL ?? DEFAULT_BASE_URL;
const durationSeconds = Number(process.env.DURATION_SECONDS ?? DEFAULT_DURATION_SECONDS);
const delayMs = Number(process.env.DELAY_MS ?? DEFAULT_DELAY_MS);
const token = "heisenberg-local-token";

// Keep normal traffic common while still creating auth failures, 5xxs, and latency samples.
const scenarios = [
  { name: "health", weight: 8, request: () => get("/health") },
  { name: "login_success", weight: 5, request: () => postJson("/login", { username: "walter.white", password: "say-my-name" }) },
  { name: "login_failure", weight: 4, request: () => postJson("/login", { username: "walter.white", password: "wrong" }) },
  { name: "validate_success", weight: 5, request: () => get("/validate", { Authorization: `Bearer ${token}` }) },
  { name: "validate_failure", weight: 3, request: () => get("/validate", { Authorization: "Bearer bad-token" }) },
  { name: "profile_success", weight: 3, request: () => get("/profile", { Authorization: `Bearer ${token}` }) },
  { name: "profile_missing_token", weight: 2, request: () => get("/profile") },
  { name: "profile_invalid_token", weight: 2, request: () => get("/profile", { Authorization: "Bearer bad-token" }) },
  { name: "debug_error", weight: 1, request: () => get("/debug/error") },
  { name: "debug_slow", weight: 1, request: () => get("/debug/slow") },
];

const counts = new Map(scenarios.map((scenario) => [scenario.name, 0]));
const statuses = new Map();

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

async function main() {
  validateConfig();

  const stopAt = Date.now() + durationSeconds * 1000;
  console.log(`Generating fake traffic against ${baseUrl} for ${durationSeconds}s.`);

  // Sequential requests make DELAY_MS easy to reason about when watching dashboard rates.
  while (Date.now() < stopAt) {
    const scenario = chooseScenario();

    try {
      const response = await scenario.request();
      increment(counts, scenario.name);
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
