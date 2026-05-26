# Auth Observability Lab

An SRE-focused observability lab built around a small Express authentication service.

This project is meant to show practical familiarity with backend instrumentation, Docker Compose, Prometheus, Grafana, Loki, Promtail, structured logging, and operational dashboard design. The service is intentionally small so the observability work is easy to inspect: each endpoint exists to create realistic health, auth, latency, error, metric, and log signals.

## What I Built

- A TypeScript and Express service with health, login, token validation, protected profile, slow-debug, and error-debug routes
- Prometheus metrics for request volume, status codes, latency, auth outcomes, token validation outcomes, authorization failures, CPU, and memory
- Structured JSON request logs with request ID, route, method, status, latency, auth outcome, and safe failure reason
- A Docker Compose stack for the app, Prometheus, Grafana, Loki, Promtail, and Grafana image rendering
- A provisioned Grafana dashboard showing service health, traffic, auth behavior, latency, resource usage, and Loki logs in one view
- A randomized traffic generator that creates mostly successful traffic plus controlled failed-login, invalid-token, `5xx`, slow-request, and `404` events
- Evidence showing metrics and logs correlated in the same Grafana time window

## Why This Project Exists

The goal is not to build a production identity provider. The goal is to demonstrate that I can instrument a backend service, choose useful operational signals, avoid unsafe observability practices, and connect metrics and logs into a workflow that supports troubleshooting.

The auth flow is fake and local-only by design. That keeps the scope focused on observability patterns rather than real credential handling.

## Architecture

| Area | Technology | What It Does Here |
|---|---|---|
| Backend service | Express + TypeScript | Provides controlled endpoints that produce normal traffic, auth failures, latency, and server errors |
| Container runtime | Docker Compose | Runs the app and observability services together with predictable local networking |
| Metrics | Prometheus + `prom-client` | Scrapes numeric time-series data from `/metrics` for rates, latency, auth outcomes, and process health |
| Dashboard | Grafana | Visualizes Prometheus metrics and Loki logs in one operational view |
| Logs | Loki | Stores queryable application logs without needing a heavyweight log platform |
| Log collector | Promtail | Reads Docker container logs and ships them to Loki with service labels |
| Image export | Grafana image renderer | Allows dashboard and panel screenshots to be exported as evidence |

## Observability Technologies

**Prometheus**

Prometheus is the metrics system. The service exposes a `/metrics` endpoint in Prometheus exposition format, and Prometheus scrapes it on an interval. This is useful for answering aggregate operational questions such as:

- Is the service up?
- How many requests are happening per second?
- What percentage of requests are failing?
- Are login failures increasing?
- Is p95 latency getting worse?

The project uses bounded labels such as `route`, `method`, `status`, `outcome`, and `reason`. It intentionally does not put request IDs, usernames, tokens, or other high-cardinality values into metrics.

**Grafana**

Grafana is the visualization and investigation layer. It connects to Prometheus for metrics and Loki for logs. The dashboard is provisioned from JSON so the view is repeatable instead of manually configured.

The dashboard is designed to answer practical questions quickly:

- Is the auth service up?
- Are login attempts succeeding or failing?
- Are token validations failing?
- Are `5xx` errors happening?
- Did latency degrade?
- Do logs in the same time window explain the metric movement?

**Loki**

Loki stores logs and makes them queryable with LogQL. It is a good fit for this lab because it works naturally with Grafana and uses labels to find streams of logs without indexing every word like a traditional full-text logging system.

The app writes newline-delimited JSON logs to stdout. Loki stores those logs so they can be filtered by fields like:

- `authFlow`
- `authOutcome`
- `failureReason`
- `route`
- `status`
- `requestId`

**Promtail**

Promtail is the log shipper. In this project it discovers Docker containers through the Docker socket, reads their stdout logs, adds labels such as `service="auth-service"`, and pushes the logs to Loki.

That means the app does not need to know about Loki directly. It only needs to write safe structured logs to stdout, which is the normal container-friendly logging pattern.

**Structured JSON Logs**

The request logger emits one JSON log per completed request. The important fields are:

- `requestId`
- `method`
- `route`
- `status`
- `durationMs`
- `authFlow`
- `authOutcome`
- `failureReason`

The logger deliberately excludes request bodies, passwords, raw tokens, authorization headers, user IDs, and IP addresses. This demonstrates the security side of observability: logs should help investigation without becoming a sensitive-data leak.

## Signals Implemented

| Signal | Where It Appears | Why It Matters |
|---|---|---|
| Service up/down | Prometheus `up`, Grafana status panel | Basic availability check |
| Request rate | `http_requests_total` | Shows traffic volume and spikes |
| Error rate | `http_requests_total{status=~"5.."}` | Shows server-side failures |
| Request latency | `http_request_duration_seconds` | Shows degradation even when requests still succeed |
| Login success/failure | `auth_login_attempts_total` and JSON logs | Shows auth behavior and failed-login spikes |
| Token validation success/failure | `auth_token_validation_attempts_total` and JSON logs | Shows invalid or missing token patterns |
| Protected-route auth failures | `auth_authorization_failures_total` and JSON logs | Shows access attempts that fail authorization |
| CPU and memory | default `prom-client` process metrics | Shows basic runtime resource behavior |

## Dashboard Evidence

Evidence is stored in:

- `evidence/Auth Observability Dashboard.png`

The screenshot shows Grafana displaying Prometheus metrics and Loki logs in the same dashboard time window. Promtail is not a visual dashboard component; it is the log shipping layer that reads Docker container stdout, labels the stream as `service="auth-service"`, and sends those JSON logs to Loki.

The useful workflow is:

1. Prometheus panels show a change in service behavior.
2. Loki logs show the request-level events from the same time range.
3. Grafana keeps both views together so the metric spike and related logs can be inspected without switching tools.

Example correlations:

- A failed-login rate increase lines up with logs where `authFlow="login"` and `authOutcome="failure"`.
- A token-validation failure increase lines up with logs where `authFlow="token_validation"` and `failureReason="invalid_token"`.
- A `5xx` error-rate increase lines up with logs where `status=500`.
- Slow-request latency samples line up with logs where `route="/debug/slow"`.

## Useful Queries

Prometheus metrics:

Service availability:

```promql
up{job="auth-service"}
```

Request rate by route, method, and status:

```promql
sum by (route, method, status) (
  rate(http_requests_total[5m])
)
```

Error rate:

```promql
sum(rate(http_requests_total{status=~"5.."}[5m]))
```

p95 request latency:

```promql
histogram_quantile(
  0.95,
  sum by (le) (rate(http_request_duration_seconds_bucket[5m]))
)
```

Login outcomes:

```promql
sum by (outcome) (
  rate(auth_login_attempts_total[5m])
)
```

Token validation outcomes:

```promql
sum by (outcome) (
  rate(auth_token_validation_attempts_total[5m])
)
```

Loki logs:

Failed login logs:

```logql
{service="auth-service"} | json | authFlow="login" | authOutcome="failure"
```

Invalid token validation logs:

```logql
{service="auth-service"} | json | authFlow="token_validation" | failureReason="invalid_token"
```

Server error logs:

```logql
{service="auth-service"} | json | status >= 500
```

Slow request logs:

```logql
{service="auth-service"} | json | route="/debug/slow"
```

Application logs without routine health and metrics noise:

```logql
{service="auth-service"} | json | route!="/health" | route!="/metrics"
```

## API Surface

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Basic service health check |
| `GET` | `/metrics` | Prometheus-formatted metrics |
| `POST` | `/login` | Fake local-only credential check |
| `GET` | `/validate` | Validate a token-like value |
| `GET` | `/profile` | Protected route requiring a valid token-like value |
| `GET` | `/debug/slow` | Predictable latency for dashboard and alert testing |
| `GET` | `/debug/error` | Predictable `500` response for error-rate testing |

## Fake Auth Data

The app uses one fake local test user:

```text
username: walter.white
password: say-my-name
token: heisenberg-local-token
```

These values are intentionally fake. The project does not implement production identity provider behavior.

## Local Reference

The repository can be run locally, but the main purpose is to show the instrumentation and observability workflow.

Install dependencies:

```bash
npm install
```

Run tests:

```bash
npm test
```

Start the full stack:

```bash
docker compose up --build
```

Generate varied traffic:

```bash
npm run traffic
```

Local endpoints:

| Service | URL |
|---|---|
| Auth service | `http://localhost:3000` |
| Prometheus | `http://localhost:9090` |
| Grafana | `http://localhost:3001` |
| Loki | `http://localhost:3100` |

Default Grafana login:

```text
username: admin
password: admin
```

## Project Guardrails

- Fake local-only credentials only
- No real user data
- No production identity provider behavior
- No frontend application
- No passwords, raw tokens, secrets, or full authorization headers in logs
- No high-cardinality request values in Prometheus labels
