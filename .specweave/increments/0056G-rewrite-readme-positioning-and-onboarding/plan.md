# Plan: Rewrite README positioning and onboarding

**Increment**: 0056G-rewrite-readme-positioning-and-onboarding
**Status**: Planned

## Architecture

No product architecture changes. This increment changes only the information architecture and messaging hierarchy of the root `README.md`.

The authoritative sources for alignment are:

- `docs/why.md` for product problem framing and differentiation
- `docs/vision.md` for north-star direction and anti-goals
- `SPEC.md` for architectural invariants and seam terminology

## Approach

1. Reframe the opening copy around audience, problem, and outcome.
2. Move the search-vs-trace distinction near the top.
3. Keep a smaller set of top-level onboarding choices.
4. Compress the FOC/storage explanation so it supports the thesis instead of dominating it.
5. Add a concrete example section that demonstrates trace value in plain language.
6. Keep deeper detail in linked docs instead of duplicating long-form vision content.

## Dependencies

- Existing docs must remain the source of truth for deeper rationale and long-term direction.
- The README must not claim features that lack tracking or active delivery context.
