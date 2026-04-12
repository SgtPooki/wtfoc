# [feat] UI platform for local `wtfoc serve` and deployable web app

**Increment**: 0035G-ui-platform-for-local-wtfoc-serve-and-deployable-w
**Type**: spec | **Priority**: P3 | **Labels**: question, spec, P3
**Source**: GitHub #67

## Description


`wtfoc` now has enough core functionality that the next product step should not be "just a graph viewer." We need an application surface that can grow into:

- visual graph exploration
- search and trace UX
- wallet-connected FOC write flows
- source authentication and connector management
- encrypted collections and controlled content access
- deployable hosting on a real domain such as `wtfoc.xyz`

The original `wtfoc serve` idea is still useful, but it should not carry the whole product. We should explicitly separate:

1. a lightweight local app host for developers and demos
2. a deployable web application/container for the real hosted UX

This issue is to define that split and ratify the MVP surface for the first UI work.

## Why This Matters

Right now the CLI is strong for local power users, but the likely product direction is broader:

- wallet connectivity for storing collections on FOC
- authenticated source ingestion for GitHub, Slack, Discord, and websites
- searchable evidence-backed knowledge across collections
- optional encryption and privacy boundaries
- a shareable app that can be deployed in a homelab or hosted environment

If we build `wtfoc serve` as a one-off CLI demo server, we will likely mix together:

- local developer ergonomics
- production auth concerns
- secret storage
- wallet session handling
- multi-user access control
- browser UI state

That will make the later web app harder to reason about and harder to secure.

## Proposed Boundary

### 1. Core packages stay focused on domain logic

`@wtfoc/common`, `store`, `ingest`, `search`, and CLI-facing orchestration should remain responsible for:

- collection and manifest operations
- ingest, search, trace, verify, and promotion logic
- graph/edge data shaping that is product-agnostic
- backend-neutral FOC/local behavior

### 2. Introduce an application/API layer

Add a reusable app-facing service layer that exposes:

- collection discovery
- graph query APIs
- search/query APIs
- trace APIs
- promotion APIs
- connector management hooks
- authn/authz hooks

This layer should be reusable by both local and deployed runtimes.

### 3. `wtfoc serve` becomes a thin local runtime

`wtfoc serve` should exist, but as a local single-user host for:

- local collection browsing
- graph/search/trace exploration
- dev/test of the UI against real collections
- local demos without full deployment setup

It should not own:

- production auth
- hosted secret storage
- multi-user policy
- full wallet session lifecycle

### 4. Deployable web app/container is the product runtime

A separate web app should provide the deployable experience for `wtfoc.xyz` or homelab hosting:

- browser UI
- app auth
- wallet connectivity
- connector setup
- source credential management
- encryption policy UX
- multi-user and hosted deployment concerns

## MVP Scope For The First UI Phase

The first UI phase should focus on a usable read path, not the entire platform:

- collection discovery
- graph visualization
- query/search UI
- trace UI
- source/chunk detail panel
- FOC verification links and metadata
- clear local-vs-FOC state in the UI

The first phase should avoid overreaching into:

- full OAuth flows for every source
- write-heavy ingestion orchestration in-browser
- multi-tenant RBAC
- end-to-end encrypted search across all content classes

## Product Questions This Issue Should Resolve

Before implementation, we need clear answers to:

1. Should the UI repo structure live under `apps/web` while `wtfoc serve` lives in `@wtfoc/cli`?
2. Should both local and hosted runtimes use the same API contract?
3. What actions require wallet auth versus app auth?
4. Where do source credentials live in the hosted deployment?
5. What data can be encrypted without breaking search, trace, and edge extraction?
6. Which features belong in the local runtime only versus the hosted app?

## Acceptance Criteria For This Issue

- [ ] We have a documented split between local `wtfoc serve` and deployable web app responsibilities
- [ ] We have a reusable API/service contract for graph, query, trace, and collections
- [ ] We have a scoped MVP for the first UI phase
- [ ] We have follow-on issues for wallet, auth, connectors, encryption, and deployment concerns
- [ ] We do not start product UI implementation until this architecture is ratified through the spec flow

## Recommended Follow-On Issues

These should be separate issues rather than stuffing everything into `#67`.

### 1. Local Runtime: `wtfoc serve`

Build a local single-user runtime in `@wtfoc/cli` that:

- hosts the SPA or static assets locally
- exposes local read-only APIs for collections, graph, query, and trace
- works with any local collection produced by the CLI

This is primarily for local UX, demos, and development.

### 2. Shared App/API Contract

Define the shared application-layer contract:

- `GET /api/collections`
- `GET /api/graph`
- `GET /api/query`
- `GET /api/trace`
- promotion/write endpoints if needed later

This is the boundary both runtimes should target.

### 3. Deployable Web App Container

Build a containerized web app runtime suitable for `wtfoc.xyz` or homelab deployment:

- app shell
- collection picker
- graph/search/trace UI
- deployment packaging

### 4. Wallet Connectivity And FOC Write Flows

Separate issue for:

- wallet connect
- user confirmation for FOC writes
- promote/publish flows
- verification UX for CIDs and PieceCID

### 5. Source Auth And Connector Management

Separate issue for:

- connector setup UX
- GitHub/Slack/Discord auth
- secret handling and backend storage model
- permissions for adding or refreshing sources

### 6. Encryption And Access Policy

Separate issue for:

- collection-level encryption model
- key ownership and sharing model
- what stays searchable versus encrypted-at-rest only
- how trace/query behave on protected content

### 7. Edge Review/Triage UI

Keep `#69` separate, but explicitly depend on the shared graph/app layer rather than only on the original narrow `wtfoc serve` issue.

## Suggested Repo Shape

One plausible direction:

- `packages/*` for core domain logic
- `packages/app-api` for reusable app-facing services or HTTP contract helpers
- `packages/cli` for CLI and local `wtfoc serve`
- `apps/web` for the deployable containerized UI

The exact names can change, but the split should stay clear.

## Next Step

After discussion, the next step should be a formal spec through the usual flow:

1. `/speckit.specify`
2. `/speckit.clarify`
3. `/peer-review`
4. `/speckit.plan`
5. `/speckit.tasks`

Then the implementation issues above can be created or linked.


## User Stories

- **US-001**: As a user, I want ui platform for local wtfoc serve and deployable w so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #67 on 2026-04-12.
