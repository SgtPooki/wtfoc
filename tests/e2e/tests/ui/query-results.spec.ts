/**
 * UI test: Query displays results in the UI.
 */
import { expect, test } from "@playwright/test";

test.describe("query results", () => {
	test("search mode returns and renders results", async ({ page }) => {
		// Navigate directly with query params to skip collection picker
		await page.goto("/?collection=ui-test&mode=search&q=upload+file");

		// Wait for results to load
		const results = page.locator(".search-results");
		await expect(results).toBeVisible({ timeout: 15_000 });

		// Result items (hops) should appear
		const hops = results.locator(".hop");
		await expect(hops.first()).toBeVisible({ timeout: 10_000 });

		// Each hop has a score and content
		const firstHop = hops.first();
		await expect(firstHop.locator(".hop-score")).toBeVisible();
		await expect(firstHop.locator(".hop-content")).toBeVisible();
	});

	test("trace mode returns grouped results", async ({ page }) => {
		await page.goto("/?collection=ui-test&mode=trace&q=storage+architecture");

		// Wait for trace results
		const results = page.locator(".trace-results");
		await expect(results).toBeVisible({ timeout: 15_000 });

		// Groups should appear
		const groups = results.locator(".group");
		await expect(groups.first()).toBeVisible({ timeout: 10_000 });

		// Each group has a header and hops
		const firstGroup = groups.first();
		await expect(firstGroup.locator(".group-header")).toBeVisible();
	});

	test("search input is visible when collection is selected", async ({ page }) => {
		await page.goto("/?collection=ui-test");

		// Search container should be present
		const searchRow = page.locator(".search-row input");
		await expect(searchRow).toBeVisible({ timeout: 10_000 });
	});
});
