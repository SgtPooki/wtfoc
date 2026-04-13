/**
 * Normalize repository source strings to a canonical form for edge resolution.
 *
 * Strips GitHub URL prefixes (https://github.com/, github.com/) and trailing
 * .git suffixes, then lowercases. This ensures that the same repo referenced
 * in different formats resolves to the same index key.
 *
 * Examples:
 *   "https://github.com/SgtPooki/wtfoc"     → "sgtpooki/wtfoc"
 *   "github.com/SgtPooki/wtfoc"             → "sgtpooki/wtfoc"
 *   "https://github.com/SgtPooki/wtfoc.git" → "sgtpooki/wtfoc"
 *   "SgtPooki/wtfoc#42"                     → "sgtpooki/wtfoc#42"
 *   "src/index.ts"                          → "src/index.ts"
 */

const GITHUB_PREFIX = /^(?:https?:\/\/)?github\.com\//i;

export function normalizeRepoSource(source: string): string {
	const hadGitHubPrefix = GITHUB_PREFIX.test(source);
	let s = source.replace(GITHUB_PREFIX, "");

	// Strip trailing .git only when the source had a GitHub URL prefix
	// (clone URLs like https://github.com/owner/repo.git).
	// Without a prefix, "owner/repo.git" is ambiguous with "scripts/deploy.git"
	// so we leave it alone.
	if (hadGitHubPrefix && s.endsWith(".git")) {
		s = s.slice(0, -4);
	}

	return s.toLowerCase();
}
