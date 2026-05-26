# Auth Observability Lab

An SRE-focused observability lab built around a small Express authentication service. The goal is to demonstrate practical familiarity with backend instrumentation, containerized observability tooling, metrics, logs, dashboards, and safe operational debugging.

![Auth Observability Grafana dashboard showing Prometheus metrics and Loki logs in the same time window](evidence/Auth%20Observability%20Dashboard.png)

## Project Summary

This repo is intentionally small so the observability work is easy to inspect. The auth service creates realistic operational signals: normal requests, failed logins, invalid tokens, protected-route failures, slow responses, `5xx` errors, process metrics, and structured request logs.

What this demonstrates:

- Instrumenting an Express service with Prometheus metrics
- Designing bounded, useful metric labels
- Writing safe structured JSON logs
- Collecting container logs with Promtail
- Querying logs with Loki and LogQL
- Building a Grafana dashboard that combines metrics and logs
- Using Docker Compose to run a local multi-service observability stack
- Avoiding sensitive data in logs and high-cardinality values in metrics

## Architecture

| Component | Technology | Purpose |
|---|---|---|
| Auth service | Express + TypeScript | Produces controlled auth, latency, error, metric, and log signals |
| Runtime | Docker Compose | Runs the app, Prometheus, Grafana, Loki, Promtail, and renderer together |
| Metrics endpoint | `prom-client` | Exposes Prometheus-formatted app and process metrics at `/metrics` |
| Metrics backend | Prometheus | Scrapes and stores time-series metrics |
| Alerting | Prometheus + Alertmanager | Evaluates version-controlled alert rules and handles alert grouping/routing |
| Log collector | Promtail | Reads Docker container stdout logs, labels them, and ships them to Loki |
| Log backend | Loki | Stores queryable application logs |
| Dashboard | Grafana | Displays Prometheus metrics and Loki logs in one investigation view |
| Image export | Grafana image renderer | Exports dashboard/panel screenshots for evidence |

## Observability Data Flow

Metrics:

```text
Express app
-> /metrics endpoint
-> Prometheus scrape
-> Grafana dashboard panels
```

Logs:

```text
Express JSON logs
-> container stdout
-> Promtail Docker discovery
-> Loki
-> Grafana dashboard / Explore
```

Promtail is not shown as a dashboard panel because it is plumbing. Its job is proven when `auth-service` container logs appear in Loki with labels such as `service="auth-service"`.

## What Each Tool Shows

**Prometheus** stores numeric time-series metrics. In this project it answers questions like: is the service up, how much traffic is flowing, are `5xx` errors increasing, are failed logins increasing, and is p95 latency degrading.

**Alertmanager** receives firing alerts from Prometheus. The local configuration uses a no-op receiver so alert state can be inspected without sending real notifications.

**Grafana** is the operational view. It displays Prometheus metrics and Loki logs in the same time range so a metric spike can be investigated with request-level logs.

**Loki** stores structured application logs. It lets the dashboard and Grafana Explore filter request logs by fields such as `authFlow`, `authOutcome`, `failureReason`, `route`, `status`, and `requestId`.

**Promtail** collects Docker logs and forwards them to Loki. The app only writes JSON logs to stdout, which keeps logging container-friendly and avoids coupling the service directly to Loki.

**Docker Compose** defines the local stack. It is the right level for this repo because the goal is to show how the observability services work together, not to provision remote infrastructure.

## Signals Implemented

| Signal | Source | Why It Matters |
|---|---|---|
| Service up/down | Prometheus `up` | Basic availability |
| Request rate | `http_requests_total` | Traffic volume and spikes |
| Error rate | `http_requests_total{status=~"5.."}` | Server-side failures |
| Request latency | `http_request_duration_seconds` | Performance degradation |
| Login outcomes | `auth_login_attempts_total` and JSON logs | Successful versus failed auth behavior |
| Token validation outcomes | `auth_token_validation_attempts_total` and JSON logs | Invalid or missing token patterns |
| Authorization failures | `auth_authorization_failures_total` and JSON logs | Protected-route access failures |
| CPU and memory | default `prom-client` process metrics | Runtime resource behavior |

## Dashboard Evidence

Evidence screenshot:

```text
evidence/Auth Observability Dashboard.png
```

The screenshot shows Grafana displaying Prometheus metrics and Loki logs for the same traffic window. That is the main investigation workflow:

1. Prometheus panels show a behavior change, such as failed logins, invalid tokens, latency, or `5xx` errors.
2. Loki logs show the request-level JSON events from the same time range.
3. Grafana keeps both views together so the cause can be inspected without switching tools.

Example correlations:

- Failed-login activity lines up with logs where `authFlow="login"` and `authOutcome="failure"`.
- Invalid-token activity lines up with logs where `authFlow="token_validation"` and `failureReason="invalid_token"`.
- Error-rate activity lines up with logs where `status=500`.
- Slow-request latency lines up with logs where `route="/debug/slow"`.

## Key Queries

These are the core PromQL and LogQL queries behind the dashboard and investigation workflow.

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

Failed login logs:

```logql
{service="auth-service"} | json | authFlow="login" | authOutcome="failure"
```

Invalid token logs:

```logql
{service="auth-service"} | json | authFlow="token_validation" | failureReason="invalid_token"
```

Server error logs:

```logql
{service="auth-service"} | json | status >= 500
```

Application logs without routine health and metrics noise:

```logql
{service="auth-service"} | json | route!="/health" | route!="/metrics"
```

## Service Behavior

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Prometheus metrics |
| `POST` | `/login` | Fake local-only credential check |
| `GET` | `/validate` | Token-like validation |
| `GET` | `/profile` | Protected route requiring valid auth |
| `GET` | `/debug/slow` | Predictable latency for dashboard testing |
| `GET` | `/debug/error` | Predictable `500` for error-rate testing |

Fake local test data:

```text
username: walter.white
password: say-my-name
token: heisenberg-local-token
```

These values are intentionally fake. This project does not implement a production identity provider.

## Traffic Generator

`scripts/generate-traffic.js` creates dashboard activity with a realistic balance: mostly successful traffic, plus controlled failed logins, invalid tokens, protected-route failures, slow requests, `404`s, and `5xx`s.

The script exists so the dashboard and Loki panels can show operational behavior without requiring real users or real incidents.

```bash
npm run traffic
```

## Alerts

Prometheus owns alert evaluation by loading `alerts.yml`. Alertmanager handles alert grouping and routing. Grafana is kept as the dashboard/investigation layer, not the alert-rule owner.

Local alert state:

| Tool | URL | Purpose |
|---|---|---|
| Prometheus | `http://localhost:9090/alerts` | Source of truth for pending/firing alert evaluation |
| Alertmanager | `http://localhost:9093` | Alert grouping, routing, silence, and receiver state |
| Grafana | `http://localhost:3001` | Dashboard and Loki log investigation |

| Alert | Threshold | Operational concern | Test method | First response |
|---|---|---|---|---|
| `AuthServiceDown` | `up{job="auth-service"} == 0` for 1 minute | The service is unavailable or Prometheus cannot scrape it | Run `docker compose stop auth-service`, then check Prometheus alerts after 1 minute | Check `docker compose ps`, auth-service logs, and `/health`; restart or roll back if needed |
| `AuthServiceHigh5xxRate` | More than `0.5` `5xx` responses per second over 5 minutes for 2 minutes | Users are hitting sustained server-side failures | Run `npm run alert:5xx` | Query Loki for `status >= 500`, identify the route, and inspect recent code or dependency changes |
| `AuthServiceHighLoginLatency` | `/login` p95 latency above `500ms` for 2 minutes | Users cannot sign in quickly enough | Start the stack with `AUTH_LOGIN_DELAY_MS=750 docker compose up --build`, then run `npm run alert:login-latency` | Check app saturation and any auth dependency path before widening capacity or rolling back |
| `AuthServiceFailedLoginSpike` | Failed logins above `0.75` per second over 5 minutes for 2 minutes | Credential stuffing, bot traffic, or broken clients | Run `npm run alert:failed-login` | Inspect failed-login logs and compare traffic source patterns outside metric labels |
| `AuthServiceTokenValidationFailureSpike` | Failed token validations above `0.75` per second over 5 minutes for 2 minutes | Expired, malformed, or replayed tokens are spiking | Run `npm run alert:token-failure` | Inspect `token_validation` failure logs and confirm whether clients are sending expired or malformed tokens |

The spike thresholds are intentionally above single-request noise and above the default mixed traffic generator. They require sustained abnormal traffic before firing.

Alert trigger scripts default to `DURATION_SECONDS=180` and `DELAY_MS=100`, which is long enough for the current `for: 2m` alert rules to fire.



## Safety Decisions

- No real user data
- No production identity provider behavior
- No passwords, raw tokens, secrets, or authorization headers in logs
- No request IDs, usernames, tokens, or IP addresses in Prometheus labels
- Route metrics use bounded route labels instead of raw URLs
- Logs include safe investigation fields such as `requestId`, `route`, `status`, `authFlow`, `authOutcome`, and `failureReason`

## Local Reference

The repo can be run locally, but the main purpose is to show the instrumentation and observability workflow.

```bash
npm install
npm test
docker compose up --build
npm run traffic
```

Local services:

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

## Official Documentation

- [Express documentation](https://expressjs.com/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Docker Compose documentation](https://docs.docker.com/compose/)
- [Prometheus documentation](https://prometheus.io/docs/introduction/overview/)
- [PromQL querying basics](https://prometheus.io/docs/prometheus/latest/querying/basics/)
- [`prom-client` for Node.js](https://github.com/siimon/prom-client)
- [Grafana dashboards documentation](https://grafana.com/docs/grafana/latest/visualizations/dashboards/)
- [Grafana Loki documentation](https://grafana.com/docs/loki/latest/)
- [LogQL documentation](https://grafana.com/docs/loki/latest/logql/)
- [Promtail documentation](https://grafana.com/docs/loki/latest/send-data/promtail/)
