import { describe, expect, it } from "vitest";
import { isPlaceholderRepo } from "./suggest-sources.js";

describe("isPlaceholderRepo", () => {
	it("filters exact placeholder names", () => {
		expect(isPlaceholderRepo("owner/repo")).toBe(true);
		expect(isPlaceholderRepo("org/repo")).toBe(true);
		expect(isPlaceholderRepo("user/repo")).toBe(true);
		expect(isPlaceholderRepo("your-org/your-repo")).toBe(true);
		expect(isPlaceholderRepo("example/repo")).toBe(true);
	});

	it("filters placeholder names case-insensitively", () => {
		expect(isPlaceholderRepo("Owner/Repo")).toBe(true);
		expect(isPlaceholderRepo("OWNER/REPO")).toBe(true);
	});

	it("filters file-path false positives where repo part has an extension", () => {
		expect(isPlaceholderRepo("docs/user-stories.md")).toBe(true);
		expect(isPlaceholderRepo("packages/some-file.ts")).toBe(true);
		expect(isPlaceholderRepo("src/index.js")).toBe(true);
	});

	it("passes through real repo names", () => {
		expect(isPlaceholderRepo("FilOzone/pdp")).toBe(false);
		expect(isPlaceholderRepo("SgtPooki/wtfoc")).toBe(false);
		expect(isPlaceholderRepo("protocol/go-libp2p")).toBe(false);
		expect(isPlaceholderRepo("microsoft/typescript")).toBe(false);
	});

	it("passes through repos with dots in the owner but no extension in repo", () => {
		// GitHub org names can technically have dots; repo part has no extension
		expect(isPlaceholderRepo("my.org/my-repo")).toBe(false);
	});
});
