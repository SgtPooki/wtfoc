# [feat] Migrate collection to a different FOC account/wallet

**Increment**: 0027G-migrate-collection-to-a-different-foc-account-wall
**Type**: feature | **Priority**: P3 | **Labels**: P3
**Source**: GitHub #93

## Description

## Summary

Add the ability to re-publish a collection under a different wallet/private key, effectively migrating ownership on FOC.

## Motivation

As wtfoc moves toward multi-user hosting at `wtfoc.xyz`, collections may need to:

- Move from a personal dev wallet to a production/project wallet
- Be re-published by a different team member
- Transfer from one FOC account to another

The underlying data (chunks, segments, embeddings) doesn't change — only the publish identity does.

## Proposed Approach

```
wtfoc migrate <collection> --to-key <new-private-key>
```

Or more likely integrated with the promote flow:

```
wtfoc promote <collection> --key <different-key>
```

Since FOC storage is content-addressed, the same data published by a different key produces the same CIDs but under a different account's storage deals. The manifest may need to be re-signed or re-published depending on the FOC account model.

## Open Questions

- Does FOC account migration require re-uploading data, or just re-registering existing CIDs?
- Should the old publication be revoked/superseded?
- How does this interact with future access control (#79)?

## Related

- #75 — Wallet connectivity for hosted UI
- #79 — Encryption and access policy
- #67 — UI platform (account management UX)

## User Stories

- **US-001**: As a user, I want migrate collection to a different foc account wall so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #93 on 2026-04-12.
