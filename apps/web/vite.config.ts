import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:3577";

export default defineConfig({
	plugins: [preact()],
	server: {
		proxy: {
			"/api": {
				target: apiTarget,
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: "dist",
	},
});
