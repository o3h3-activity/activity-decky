import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = (path: string): string =>
	fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
	resolve: {
		alias: {
			"@api": resolve("./src/api"),
			"@events": resolve("./src/events.ts"),
			"@components": resolve("./src/components"),
			"@stores": resolve("./src/stores"),
			"@pages/": `${resolve("./src/pages")}/`,
			"@pages": resolve("./src/pages/index.ts"),
			"@steam/": `${resolve("./src/steam")}/`,
			"@steam": resolve("./src/steam/index.ts"),
			"@typings": resolve("./src/types"),
			"@ui": resolve("./src/ui"),
			"@utils": resolve("./src/utils"),
		},
	},
});
