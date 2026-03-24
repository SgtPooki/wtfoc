/**
 * Stub for `sharp` in the production image. @huggingface/transformers pulls this in via a
 * static ESM import for image paths; text embeddings never call it. The real sharp binary
 * requires CPU features our KVM workers lack.
 */
export default function sharp() {
	throw new Error("sharp is stubbed in this image; image pipelines are unsupported");
}
