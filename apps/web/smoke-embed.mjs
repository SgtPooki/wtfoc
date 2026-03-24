/**
 * CI-only smoke: load TransformersEmbedder and assert a 384-dim embedding.
 * Run with cwd `/app/apps/web` (pnpm resolution for `@wtfoc/search`).
 * In GitHub Actions, bind-mount this file into the image so the production image stays small.
 */
import { TransformersEmbedder } from "@wtfoc/search";

const embedder = new TransformersEmbedder();
const vec = await embedder.embed("smoke test");
if (vec.length !== 384) {
	console.error(`expected 384 dimensions, got ${vec.length}`);
	process.exit(1);
}
console.log("Smoke test passed: 384-dim embedding OK");
