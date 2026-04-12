# investigate: MCP batch request support on /mcp endpoint

**Increment**: 0024G-mcp-batch-request-support-on-mcp-endpoint
**Type**: feature | **Priority**: P2 | **Labels**: P2
**Source**: GitHub #115

## Description

## Summary

The `/mcp` endpoint does not support JSON-RPC batch requests. Sending an array of messages (e.g., initialize + notifications/initialized + tools/list) returns an error:

```
{"jsonrpc":"2.0","error":{"code":-32600,"message":"Invalid Request: Only one initialization request is allowed"},"id":null}
```

## Problem

MCP clients may want to send batch requests to reduce round-trips, especially over HTTP where each request has latency overhead. The current `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` rejects batches containing an `initialize` method.

This appears to be an upstream limitation in the MCP SDK rather than a wtfoc-specific bug.

## Investigation needed

- [ ] Check if other MCP server implementations support batch requests over Streamable HTTP
- [ ] Check if the MCP spec defines batch support requirements for the Streamable HTTP transport
- [ ] Determine if this should be filed as an issue/PR against `@modelcontextprotocol/sdk`
- [ ] If upstream won't fix, evaluate whether wtfoc should work around it (e.g., splitting batches server-side)

## Context

Discovered during manual e2e testing of the `/mcp` endpoint in #112. Non-batch sequential requests work correctly — this only affects batch payloads.

## References

- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
- JSON-RPC 2.0 batch spec: https://www.jsonrpc.org/specification#batch


## User Stories

- **US-001**: As a user, I want mcp batch request support on mcp endpoint so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #115 on 2026-04-12.
