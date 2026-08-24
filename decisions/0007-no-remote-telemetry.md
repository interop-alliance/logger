# 0007: No remote telemetry

- Status: accepted
- Date: 2026-08-23
- Driving work: the logging-seam design (scope boundary)
- Affects: `@interop/logger`; every wallet and app built on it

## Context

These are wallets: log context sits near passphrases, seeds, unlock
records, and account pointers. Shipping logs off-device is a trust
problem regardless of redaction quality, and redaction here is
review-enforced, not mechanism-enforced.

## Decision

No production sink has a network half. Production diagnostics are
the console and the in-memory ring buffer; anything that leaves the
device is user-initiated (a future "copy diagnostics" surface where
the user sees and sends the payload themselves). The dev NDJSON sink
does not violate this: its endpoint exists only on the local dev
server.

## Rejected Alternatives

- **Sentry-class remote telemetry**: automatic exfiltration of
  exactly the context that must not leave the client.

## Consequences

Field failures are diagnosed from what the user chooses to share,
not from automatic reports. This is a deliberate trade of
observability for custody.

## Revisit Criteria

Do not reopen. The only admissible evolution is user-initiated
export surfaces, which are additions beside this rule, not
revisions of it.
