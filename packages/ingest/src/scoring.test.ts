import { describe, expect, it } from "vitest";
import { HeuristicChunkScorer } from "./scoring.js";

const scorer = new HeuristicChunkScorer();

describe("HeuristicChunkScorer", () => {
	describe("pain signals", () => {
		it("detects pain keywords", () => {
			const scores = scorer.score(
				"This feature doesn't work and keeps crashing with a timeout error",
				"slack-message",
			);
			expect(scores.pain).toBeGreaterThan(0);
			expect(scores.pain).toBeLessThanOrEqual(100);
		});

		it("scores higher for more pain matches", () => {
			const singleMatch = scorer.score("There is a bug here", "github-issue");
			const multiMatch = scorer.score(
				"This is broken, doesn't work, keeps crashing with errors and I'm frustrated",
				"github-issue",
			);
			expect(multiMatch.pain).toBeGreaterThan(singleMatch.pain ?? 0);
		});
	});

	describe("praise signals", () => {
		it("detects praise keywords", () => {
			const scores = scorer.score(
				"I love this tool, works great and is exactly what I needed!",
				"slack-message",
			);
			expect(scores.praise).toBeGreaterThan(0);
			expect(scores.praise).toBeLessThanOrEqual(100);
		});

		it("detects thank you", () => {
			const scores = scorer.score("Thank you, this is amazing!", "discord");
			expect(scores.praise).toBeGreaterThan(0);
		});
	});

	describe("feature request signals", () => {
		it("detects feature request patterns", () => {
			const scores = scorer.score(
				"I wish there was a way to filter by date. Any plans to add this? Please add dark mode.",
				"github-issue",
			);
			expect(scores.feature_request).toBeGreaterThan(0);
			expect(scores.feature_request).toBeLessThanOrEqual(100);
		});

		it("detects 'would be nice'", () => {
			const scores = scorer.score("It would be nice to have auto-save", "slack-message");
			expect(scores.feature_request).toBeGreaterThan(0);
		});
	});

	describe("workaround signals", () => {
		it("detects workaround patterns", () => {
			const scores = scorer.score(
				"As a workaround, I wrote a script to manually convert the files",
				"github-issue",
			);
			expect(scores.workaround).toBeGreaterThan(0);
			expect(scores.workaround).toBeLessThanOrEqual(100);
		});
	});

	describe("question signals", () => {
		it("detects question patterns", () => {
			const scores = scorer.score(
				"How do I configure the proxy? Is there a way to set environment variables?",
				"slack-message",
			);
			expect(scores.question).toBeGreaterThan(0);
			expect(scores.question).toBeLessThanOrEqual(100);
		});

		it("detects 'anyone know'", () => {
			const scores = scorer.score("Anyone know how to fix this?", "discord");
			expect(scores.question).toBeGreaterThan(0);
		});
	});

	describe("multi-label content", () => {
		it("detects both pain and question signals", () => {
			const scores = scorer.score(
				"This doesn't work. How do I fix this error? Can someone explain what's going on?",
				"slack-message",
			);
			expect(scores.pain).toBeGreaterThan(0);
			expect(scores.question).toBeGreaterThan(0);
		});

		it("detects pain and workaround together", () => {
			const scores = scorer.score(
				"Upload keeps failing. As a workaround I wrote a script to manually retry.",
				"github-issue",
			);
			expect(scores.pain).toBeGreaterThan(0);
			expect(scores.workaround).toBeGreaterThan(0);
		});
	});

	describe("neutral content", () => {
		it("returns empty scores for neutral content", () => {
			const scores = scorer.score(
				"The system processes incoming data and stores it in the database.",
				"markdown",
			);
			expect(Object.keys(scores)).toHaveLength(0);
		});

		it("returns empty scores for empty content", () => {
			const scores = scorer.score("", "code");
			expect(Object.keys(scores)).toHaveLength(0);
		});
	});

	describe("score range", () => {
		it("scores are between 0 and 100", () => {
			const scores = scorer.score(
				"This is broken, doesn't work, keeps crashing, errors everywhere, I'm frustrated, can't use it, it's unusable, bug after bug, fail after fail, timeout after timeout, unable to proceed",
				"github-issue",
			);
			for (const value of Object.values(scores)) {
				expect(value).toBeGreaterThanOrEqual(0);
				expect(value).toBeLessThanOrEqual(100);
			}
		});

		it("caps at 100 even with many matches", () => {
			const scores = scorer.score(
				"broken unusable frustrated bug error crash fail timeout can't unable doesn't work",
				"github-issue",
			);
			expect(scores.pain).toBeLessThanOrEqual(100);
		});
	});

	describe("scoreBatch", () => {
		it("scores multiple items", () => {
			const results = scorer.scoreBatch([
				{ content: "This is broken and crashes", sourceType: "github-issue" },
				{ content: "Love this, works great!", sourceType: "slack-message" },
				{ content: "Normal documentation text", sourceType: "markdown" },
			]);

			expect(results).toHaveLength(3);
			expect(results[0]?.pain).toBeGreaterThan(0);
			expect(results[1]?.praise).toBeGreaterThan(0);
			expect(Object.keys(results[2] ?? {})).toHaveLength(0);
		});
	});

	describe("case insensitivity", () => {
		it("matches regardless of case", () => {
			const lower = scorer.score("doesn't work", "slack-message");
			const upper = scorer.score("DOESN'T WORK", "slack-message");
			const mixed = scorer.score("Doesn't Work", "slack-message");

			expect(lower.pain).toBe(upper.pain);
			expect(lower.pain).toBe(mixed.pain);
		});
	});
});
