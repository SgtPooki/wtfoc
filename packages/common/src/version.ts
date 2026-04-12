/**
 * Current schema version for manifests and segments.
 *
 * This is the single source of truth for the storage format version.
 * Bump this when the Segment or CollectionHead type changes.
 *
 * Rules (from SPEC.md):
 * - Writers always use CURRENT_SCHEMA_VERSION
 * - Readers must support all versions from 1 to MAX_SUPPORTED_SCHEMA_VERSION
 * - Unknown versions (> MAX_SUPPORTED_SCHEMA_VERSION) are rejected with SchemaUnknownError
 * - Old segments remain valid forever (immutable, never rewritten)
 *
 * When to bump:
 * - Adding a required field to Segment or HeadManifest → bump
 * - Changing the meaning of an existing field → bump
 * - Adding an optional field → don't bump (backward compatible)
 * - Removing a field → bump
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Maximum schema version this build can read.
 * Should always be >= CURRENT_SCHEMA_VERSION.
 */
export const MAX_SUPPORTED_SCHEMA_VERSION = 1;
// e2e-final-test
