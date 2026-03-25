import type { Command } from "commander";
import { getFormat, getStore } from "../helpers.js";

export function registerVerifyCommand(program: Command): void {
	program
		.command("verify <id>")
		.description("Verify an artifact exists in storage")
		.action(async (id: string) => {
			const store = getStore(program);
			const format = getFormat(program.opts());

			if (!store.storage.verify) {
				console.error("Verify not supported by current storage backend");
				process.exit(1);
			}

			const result = await store.storage.verify(id);
			if (format === "json") {
				console.log(JSON.stringify(result));
			} else {
				if (result.exists) {
					console.log(`✅ Artifact exists (${result.size} bytes)`);
				} else {
					console.log("❌ Artifact not found");
					process.exit(1);
				}
			}
		});
}
