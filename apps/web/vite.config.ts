import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:3577";

export default defineConfig({
	plugins: [preact()],
	resolve: {
		alias: {
			react: "preact/compat",
			"react-dom": "preact/compat",
			"react/jsx-runtime": "preact/jsx-runtime",
		},
	},
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
