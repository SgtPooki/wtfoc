# fix(store): RPC provider fallback for HTTP 429 rate limiting

**Increment**: 0015G-store-rpc-provider-fallback-for-http-429-rate-limi
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #150

## Description

## Problem

FOC uploads frequently hit HTTP 429 (rate limit) errors from the glif free RPC endpoint. This causes uploads to fail or retry slowly, degrading the promote/ingest experience.

## Proposed Fix

Configure viem's `http()` transport with multiple RPC URLs and a fallback strategy:

1. Use viem's `fallback()` transport with multiple calibration/mainnet RPC providers
2. Automatically retry on 429 with the next provider
3. Make the RPC URL list configurable via environment variable (e.g., `WTFOC_RPC_URLS`)

### Candidate RPC providers for calibration testnet
- glif (current default, rate-limited)
- Ankr
- ChainStack
- User-provided via env var

### Implementation

In `FocStorageBackend` constructor or `initializeSynapse()` call, replace:
```ts
const synapse = await fp.initializeSynapse({ privateKey, chain });
```
with a custom transport configuration that uses `fallback([http(url1), http(url2), ...])`.

## Context

Discovered during #139 fix testing. Multiple promote attempts hit 429s from glif.

## User Stories

- **US-001**: As a user, I want store rpc provider fallback for http 429 rate limi so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #150 on 2026-04-12.
