#!/usr/bin/env node

import { Command } from "commander";
import { registerCollectionsCommand } from "./commands/collections.js";
import { registerExtractEdgesCommand } from "./commands/extract-edges.js";
import { registerIngestCommand } from "./commands/ingest.js";
import { registerInitCommand } from "./commands/init.js";
import { registerPromoteCommand } from "./commands/promote.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerReindexCommand } from "./commands/reindex.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerSuggestSourcesCommand } from "./commands/suggest-sources.js";
import { registerThemesCommand } from "./commands/themes.js";
import { registerTraceCommand } from "./commands/trace.js";
import { registerUnresolvedEdgesCommand } from "./commands/unresolved-edges.js";
import { registerVerifyCommand } from "./commands/verify.js";

const program = new Command();

program
	.name("wtfoc")
	.description("What the FOC happened? Trace it.")
	.version("0.0.1")
	.option("--json", "Output as JSON")
	.option("--quiet", "Suppress output (errors only)")
	.option("--storage <type>", "Storage: local (default) or foc", "local");

registerInitCommand(program);
registerIngestCommand(program);
registerExtractEdgesCommand(program);
registerTraceCommand(program);
registerQueryCommand(program);
registerStatusCommand(program);
registerCollectionsCommand(program);
registerVerifyCommand(program);
registerUnresolvedEdgesCommand(program);
registerSuggestSourcesCommand(program);
registerReindexCommand(program);
registerPromoteCommand(program);
registerServeCommand(program);
registerThemesCommand(program);

program.parse();
