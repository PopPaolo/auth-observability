# Incident Writeup: Failed Login Spike

## Scenario

The auth service received a burst of bad login attempts. The requests used the right username format, but the wrong password, so the service returned `401` responses and counted them as failed logins.

This is a local test, not a real attack. It represents the kind of pattern that could happen if someone was trying many bad passwords or if a client was misconfigured and kept retrying with bad credentials.

## Runbook

Start the stack:

```bash
docker compose up --build
```

Generate the incident traffic:

```bash
npm run alert:failed-login
```

Watch alert state:

```text
http://localhost:9090/alerts
http://localhost:9093
```

Investigate in Grafana:

```text
http://localhost:3001
```

Prometheus queries used during the investigation:

```promql
sum(rate(auth_login_attempts_total{outcome="failure"}[5m]))
```

```promql
sum by (outcome) (
  rate(auth_login_attempts_total[5m])
)
```

Loki query used during the investigation:

```logql
{service="auth-service"} | json | authFlow="login" | authOutcome="failure"
```

## Symptom

The main symptom was a sustained increase in failed logins.

The service itself was still up. This was not a full outage. Valid login requests could still work, but the number of bad login attempts became high enough to be operationally interesting.

## Detection

Prometheus detected the problem with the `AuthServiceFailedLoginSpike` rule from `alerts.yml`:

```promql
sum(rate(auth_login_attempts_total{job="auth-service",outcome="failure"}[5m])) > 0.75
```

This means: if failed logins stay above `0.75` requests per second over a 5-minute window, the alert should fire.

The alert first went into a pending state. After the condition stayed true for 2 minutes, it changed to firing. Alertmanager then showed the active alert.

## Investigation

I first checked the login metrics in Prometheus/Grafana. The failed-login line increased, while the successful-login line did not show the same spike.

That told me the issue was specific to bad login attempts. It was not a general service outage, because `/health` was still working. It was also not a server-error incident, because the requests were returning `401` auth failures rather than `500` errors.

Then I checked Loki logs for failed login requests. The logs showed repeated entries with:

```text
authFlow="login"
authOutcome="failure"
failureReason="invalid_credentials"
route="/login"
status=401
```

The important part is that the logs showed the auth flow, result, failure reason, route, and status code. They did not include passwords, tokens, authorization headers, or other sensitive values.

That made the logs useful for debugging without exposing secrets.

## Cause

In this test, the cause was the local alert trigger script:

```bash
npm run alert:failed-login
```

The script repeatedly sent bad credentials to `/login`.

In a real system, the same pattern could come from:

- a user or integration retrying with the wrong password
- a bot trying many passwords
- a broken client sending repeated bad requests
- a suspicious login campaign

## Mitigation

Stop the incident traffic:

```text
Ctrl+C
```

For a real incident, the first responses would be:

- confirm valid-login success rate and `/health` remain normal
- inspect where the traffic is coming from using logs outside Prometheus metrics
- apply rate limiting or temporary blocking for abusive sources
- verify no increase in successful logins from suspicious traffic
- communicate risk if the pattern looks like account abuse

## Prevention

- Keep the failed-login alert threshold high enough that one wrong password does not trigger an alert.
- Add rate limiting for repeated failed logins.
- Track source information in logs or edge tooling, not in Prometheus metric labels.
- Consider account lockout, CAPTCHA, or other extra checks in a production auth system.
- Keep logs structured, but do not log passwords, raw tokens, or authorization headers.

