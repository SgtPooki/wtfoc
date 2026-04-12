# bug: suggest-sources reports placeholder 'owner/repo' as top suggested repo (41 mentions)

**Increment**: 0007G-suggest-sources-reports-placeholder-owner-repo-as-
**Type**: feature | **Priority**: P2 | **Labels**: none
**Source**: GitHub #192

## Description

## Problem

`suggest-sources` parses placeholder text like \`owner/repo#123\` from docs and examples as actual repository references. This causes \`owner/repo\` to appear as the #1 suggested repo with 41 mentions.

## Evidence

```json
{
  "suggestedRepos": {
    "owner/repo": 41,
    "FilOzone/pdp": 10,
    ...
  }
}
```

Similarly, \`docs/user-stories.md\` appears as a suggested repo (1 mention) — likely a path being misinterpreted as an org/repo pattern.

The 41 \`owner/repo\` mentions come from example text in docs, SPEC.md, user stories, and demo READMEs that use placeholder GitHub references.

Additionally in \`unresolvedByRepo\`:
```json
{
  "owner/repo": 41,
  "github.com/SgtPooki/wtfoc": 10,
  "https://github.com/SgtPooki/wtfoc": 1
}
```

The same repo appears in 3 different formats — the edge extractor is creating refs with inconsistent normalization.

## Suggested fixes

1. **Filter common placeholders**: Skip \`owner/repo\`, \`org/repo\`, \`user/repo\`, \`example/repo\`, etc.
2. **Validate against GitHub**: Optionally check if suggested repos actually exist
3. **Normalize repo references**: Canonicalize \`github.com/X/Y\`, \`https://github.com/X/Y\`, and \`X/Y\` to a single form

---
Found during dogfooding: building wtfoc-source-v3 collection from the wtfoc repo itself.

## User Stories

- **US-001**: As a user, I want suggest sources reports placeholder owner repo as  so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #192 on 2026-04-12.
