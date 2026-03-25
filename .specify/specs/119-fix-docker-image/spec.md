# Feature Specification: Fix Docker Image for Hosted MCP Web Server

**Feature Branch**: `119-fix-docker-image`
**Created**: 2026-03-25
**Status**: Draft
**Input**: User description: "Fix Docker image for hosted MCP web server (#103). The production Dockerfile stage does not COPY packages/config and packages/ingest into the final image, causing CrashLoopBackOff."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hosted MCP web server starts successfully (Priority: P1)

An operator deploys the wtfoc Docker image to their cluster. The container starts without errors and the MCP web server becomes ready to accept connections. Currently, the container enters CrashLoopBackOff because required workspace packages are missing from the production image.

**Why this priority**: Without a working container, no hosted functionality is available at all. This is a total blocker for any hosted deployment.

**Independent Test**: Build the Docker image and run it. The container should start, log readiness, and respond to health checks.

**Acceptance Scenarios**:

1. **Given** the Docker image is built from the current Dockerfile, **When** a container is started with required environment variables, **Then** the web server process starts without module-not-found errors and begins listening on the configured port.
2. **Given** a running container, **When** a client connects to the MCP endpoint, **Then** read-only MCP tools (query, trace, status, list_collections, list_sources) respond correctly.

---

### User Story 2 - Image remains lean despite added packages (Priority: P2)

The production image should include only the runtime files needed for the hosted web server. Heavy dependencies used only by write-mode tools (crawlers, Discord adapter) should remain excluded to keep the image small and the attack surface minimal.

**Why this priority**: Image size and security matter for production deployments, but are secondary to the container actually starting.

**Independent Test**: Build the image and inspect its size. Verify that pruned dependencies (crawlee, discord.js, sharp) are not present in the final image.

**Acceptance Scenarios**:

1. **Given** the updated Dockerfile, **When** the production image is built, **Then** the image does not contain crawlee, @crawlee, discord.js, or sharp libraries.
2. **Given** the updated Dockerfile, **When** the production image is built, **Then** the image size does not increase by more than 10 MB compared to the previous build.

---

### Edge Cases

- What happens if a future workspace package is added as a dependency of mcp-server but not included in the Dockerfile? The same crash pattern would recur. The Dockerfile should have clear documentation of which packages are included and why.
- What happens if the ingest package's dynamic import is called in read-only mode? The web server runs in read-only mode, so ingest tools are never registered and the import is never reached.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The production Docker image MUST include all workspace packages required by the web server entry point and its transitive imports.
- **FR-002**: The production Docker image MUST include the `packages/config` workspace package (package.json, dist, node_modules).
- **FR-003**: The production Docker image MUST include the `packages/ingest` workspace package (package.json, dist, node_modules).
- **FR-004**: The production Docker image MUST NOT include heavy native dependencies that were pruned in the build stage (crawlee, discord.js, sharp, babel, vitest).
- **FR-005**: The container MUST start successfully and the web server MUST begin listening on its configured port without module resolution errors.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Container starts and reaches ready state within 30 seconds of launch (no CrashLoopBackOff).
- **SC-002**: All read-only MCP tools respond correctly when invoked through the hosted endpoint.
- **SC-003**: Production image size increase is less than 10 MB compared to the pre-fix baseline.
- **SC-004**: No module-not-found errors appear in container logs during startup or tool invocation.

## Assumptions

- The web server always runs in read-only mode (`readOnly: true`), so write-mode tools (wtfoc_ingest, wtfoc_list_sources) are never registered and their heavy dependencies (crawlee, discord.js) are not needed at runtime.
- The `packages/config` and `packages/ingest` packages have no heavy native dependencies of their own beyond what is already pruned.
- The existing COPY pattern for other workspace packages (common, store, search, mcp-server) is the correct pattern to follow for the missing packages.
