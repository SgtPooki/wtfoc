# [chore] Set up Dependabot for dependency updates

**Increment**: 0047G-set-up-dependabot-for-dependency-updates
**Type**: feature | **Priority**: P2 | **Labels**: implementation, P2
**Source**: GitHub #35

## Description

## Set up Dependabot

Add `.github/dependabot.yml` to automate dependency updates.

### Config needed

- npm ecosystem for all packages
- Weekly schedule
- Group minor/patch updates
- Auto-merge patch updates (optional)

### Example config

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      minor-and-patch:
        update-types: ["minor", "patch"]
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

Can be done at any time — no dependencies.

## User Stories

- **US-001**: As a user, I want set up dependabot for dependency updates so that the system improves
  - **AC-US1-01**: [ ] Implementation satisfies the issue requirements
  - **AC-US1-02**: [ ] Tests pass for the new behavior

## Notes

Imported from GitHub issue #35 on 2026-04-12.
