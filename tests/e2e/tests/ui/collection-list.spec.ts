/**
 * UI test: SPA loads and renders the collection list.
 */
import { expect, test } from "@playwright/test";

test.describe("collection list", () => {
	test("app loads and shows collection cards", async ({ page }) => {
		await page.goto("/");

		// Header renders
		await expect(page.locator("header h1")).toBeVisible();

		// Collection grid appears with at least one card
		const grid = page.locator(".collection-grid");
		await expect(grid).toBeVisible({ timeout: 10_000 });

		const cards = grid.locator(".collection-card");
		await expect(cards.first()).toBeVisible();

		// Each card shows a name and metadata
		const firstCard = cards.first();
		await expect(firstCard.locator("h3")).not.toBeEmpty();
		await expect(firstCard.locator(".collection-meta")).toBeVisible();
	});

	test("clicking a collection card selects it", async ({ page }) => {
		await page.goto("/");

		const grid = page.locator(".collection-grid");
		await expect(grid).toBeVisible({ timeout: 10_000 });

		const firstCard = grid.locator(".collection-card").first();
		const collectionName = await firstCard.locator("h3").textContent();
		await firstCard.click();

		// After selection, search container should be visible
		await expect(page.locator(".search-container")).toBeVisible();

		// URL should include collection param
		expect(page.url()).toContain(`collection=`);
	});
});
