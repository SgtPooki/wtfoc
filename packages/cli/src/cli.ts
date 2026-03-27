#!/usr/bin/env node

import type { ResolvedConfig } from "@wtfoc/common";
import { ConfigParseError, ConfigValidationError } from "@wtfoc/common";
import { loadProjectConfig, resolveConfig } from "@wtfoc/config";
import { Command } from "commander";
import { registerCollectionsCommand } from "./commands/collections.js";
import { registerExtractEdgesCommand } from "./commands/extract-edges.js";
import { registerIngestCommand } from "./commands/ingest.js";
import { registerInitCommand } from "./commands/init.js";
import { registerMaterializeEdgesCommand } from "./commands/materialize-edges.js";
import { registerPromoteCommand } from "./commands/promote.js";
import { registerPullCommand } from "./commands/pull.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerReindexCommand } from "./commands/reindex.js";
import { registerReingestCommand } from "./commands/reingest.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerSuggestSourcesCommand } from "./commands/suggest-sources.js";
import { registerThemesCommand } from "./commands/themes.js";
import { registerTraceCommand } from "./commands/trace.js";
import { registerUnresolvedEdgesCommand } from "./commands/unresolved-edges.js";
import { registerVerifyCommand } from "./commands/verify.js";

/** Resolved project config, loaded once at startup. */
let projectConfig: ResolvedConfig | undefined;

export function getProjectConfig(): ResolvedConfig | undefined {
	return projectConfig;
}

const program = new Command();

program
	.name("wtfoc")
	.description("What the FOC happened? Trace it.")
	.version("0.0.1")
	.option("--json", "Output as JSON")
	.option("--quiet", "Suppress output (errors only)")
	.option("--storage <type>", "Storage: local (default) or foc", "local")
	.hook("preAction", (thisCommand) => {
		try {
			const fileConfig = loadProjectConfig();
			const opts = thisCommand.opts();
			projectConfig = resolveConfig({
				cli: {
					embedderUrl: opts.embedderUrl,
					embedderModel: opts.embedderModel,
					embedderKey: opts.embedderKey,
				},
				file: fileConfig,
			});
		} catch (err) {
			if (err instanceof ConfigParseError || err instanceof ConfigValidationError) {
				console.error(err.message);
				process.exit(2);
			}
			throw err;
		}
	});

registerInitCommand(program);
registerIngestCommand(program);
registerExtractEdgesCommand(program);
registerMaterializeEdgesCommand(program);
registerTraceCommand(program);
registerQueryCommand(program);
registerStatusCommand(program);
registerCollectionsCommand(program);
registerVerifyCommand(program);
registerUnresolvedEdgesCommand(program);
registerSuggestSourcesCommand(program);
registerReindexCommand(program);
registerReingestCommand(program);
registerPromoteCommand(program);
registerPullCommand(program);
registerServeCommand(program);
registerThemesCommand(program);

program.parse();
