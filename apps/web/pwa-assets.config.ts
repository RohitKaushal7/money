import { defineConfig } from "@vite-pwa/assets-generator/config";

// The source (public/logo.png) is a full-bleed forest-green tile with a cream
// Fraunces "m". We override the minimal-2023 defaults so the app/maskable icons
// keep the green tile (the defaults pad onto a WHITE background, which would ring
// the tile in white) and the transparent favicons fill edge-to-edge.
export default defineConfig({
	headLinkOptions: {
		preset: "2023",
	},
	images: ["public/logo.png"],
	preset: {
		transparent: {
			sizes: [64, 192, 512],
			favicons: [[48, "favicon.ico"]],
			padding: 0,
		},
		maskable: {
			sizes: [512],
			padding: 0.16,
			resizeOptions: { background: "#2d5e44" },
		},
		apple: {
			sizes: [180],
			padding: 0.1,
			resizeOptions: { background: "#2d5e44" },
		},
	},
});
