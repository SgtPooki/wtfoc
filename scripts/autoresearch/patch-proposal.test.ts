import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, validatePatch } from "./patch-proposal.js";

const SAMPLE_DIFF = `diff --git a/packages/search/src/clustering/greedy-clusterer.ts b/packages/search/src/clustering/greedy-clusterer.ts
index 1234567..89abcde 100644
--- a/packages/search/src/clustering/greedy-clusterer.ts
+++ b/packages/search/src/clustering/greedy-clusterer.ts
@@ -10,7 +10,7 @@ export function greedyCluster(items: Item[]): Cluster[] {
   const clusters: Cluster[] = [];
   for (const item of items) {
-    const threshold = 0.5;
+    const threshold = 0.6;
     // existing logic
   }
   return clusters;
 }
`;

const OUT_OF_ALLOWLIST_DIFF = `diff --git a/scripts/dogfood.ts b/scripts/dogfood.ts
--- a/scripts/dogfood.ts
+++ b/scripts/dogfood.ts
@@ -1,1 +1,1 @@
-old
+new
`;

const HUGE_DIFF = `diff --git a/packages/search/src/big.ts b/packages/search/src/big.ts
--- a/packages/search/src/big.ts
+++ b/packages/search/src/big.ts
@@ -1,500 +1,500 @@
${Array.from({ length: 500 }, (_, i) => `-old line ${i}\n+new line ${i}`).join("\n")}
`;

describe("parseUnifiedDiff", () => {
	it("extracts touched paths from --- and +++ headers", () => {
		const r = parseUnifiedDiff(SAMPLE_DIFF);
		expect(r.touchedPaths).toContain("packages/search/src/clustering/greedy-clusterer.ts");
	});

	it("counts added and removed lines", () => {
		const r = parseUnifiedDiff(SAMPLE_DIFF);
		expect(r.addedLines).toBe(1);
		expect(r.removedLines).toBe(1);
	});

	it("ignores diff metadata lines", () => {
		const r = parseUnifiedDiff(SAMPLE_DIFF);
		// "diff --git ...", "index ...", "@@ ..." should not count as added/removed.
		expect(r.addedLines + r.removedLines).toBeLessThan(10);
	});

	it("handles /dev/null for new files", () => {
		const newFileDiff = `diff --git a/foo b/packages/search/src/x.ts
new file mode 100644
--- /dev/null
+++ b/packages/search/src/x.ts
@@ -0,0 +1,2 @@
+line1
+line2
`;
		const r = parseUnifiedDiff(newFileDiff);
		expect(r.touchedPaths).toContain("packages/search/src/x.ts");
		expect(r.touchedPaths).not.toContain("/dev/null");
	});
});

describe("validatePatch", () => {
	function patch(diff: string, sha = "abc1234") {
		return {
			kind: "patch" as const,
			baseSha: sha,
			unifiedDiff: diff,
			rationale: "test",
		};
	}

	it("accepts a patch within allowlist + size cap", () => {
		const r = validatePatch(patch(SAMPLE_DIFF));
		expect(r.ok).toBe(true);
		expect(r.errors).toHaveLength(0);
	});

	it("rejects a patch touching files outside allowlist", () => {
		const r = validatePatch(patch(OUT_OF_ALLOWLIST_DIFF));
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("outside allowlist"))).toBe(true);
	});

	it("rejects an empty diff", () => {
		const r = validatePatch(patch(""));
		expect(r.ok).toBe(false);
		expect(r.errors).toContain("empty unifiedDiff");
	});

	it("rejects missing/short baseSha", () => {
		const r = validatePatch(patch(SAMPLE_DIFF, "x"));
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("baseSha"))).toBe(true);
	});

	it("rejects diffs over the maxDiffLines cap", () => {
		const r = validatePatch(patch(HUGE_DIFF), { maxDiffLines: 200 });
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("exceeds maxDiffLines"))).toBe(true);
	});

	it("respects custom allowedPaths override", () => {
		const r = validatePatch(patch(SAMPLE_DIFF), { allowedPaths: ["scripts/"] });
		expect(r.ok).toBe(false);
		expect(r.errors.some((e) => e.includes("outside allowlist"))).toBe(true);
	});
});
