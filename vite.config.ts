import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { compile, optimize, Polyfills } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { defineConfig, type Plugin } from "vite";
import pluginExternal from "vite-plugin-external";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const manifest = JSON.parse(
	readFileSync(path.join(import.meta.dirname, "plugin.json"), "utf8"),
);

/** Preserve scoped Tailwind utilities as an inline string for injection into Steam's window. */
const tailwindcss: Plugin = {
	name: "tailwindcss",
	enforce: "pre",
	async transform(code, id) {
		const file = id.split("?")[0];

		if (!file.endsWith(".css")) {
			return undefined;
		}

		const compiler = await compile(code, {
			base: path.dirname(file),
			from: file,
			polyfills: Polyfills.None,
			onDependency: (dependencyPath) => {
				this.addWatchFile(dependencyPath);
			},
			customCssResolver: (specifier, base) =>
				Promise.resolve(
					createRequire(path.resolve(base, "package.json")).resolve(specifier),
				),
		});
		const scanner = new Scanner({ sources: compiler.sources });
		const candidates = scanner.scan();

		for (const source of scanner.files) {
			this.addWatchFile(source);
		}

		const { code: css } = optimize(compiler.build(candidates), {
			file,
			minify: true,
		});

		return { code: css, map: { mappings: "" } };
	},
};

export default defineConfig({
	plugins: [
		tailwindcss,
		nodePolyfills(),
		pluginExternal({
			externals: {
				react: "SP_REACT",
				"react-dom": "SP_REACTDOM",
				"react/jsx-runtime": "SP_JSX",
				"@decky/ui": "DFL",
				"@decky/manifest": JSON.stringify(manifest),
			},
		}),
	],
	build: {
		lib: {
			entry: path.resolve(import.meta.dirname, "src/index.tsx"),
			name: "Activity",
			formats: ["es"],
			fileName: "index",
		},
		sourcemap: true,
		rolldownOptions: {
			context: "window",
			external: ["react", "react-dom", "@decky/ui"],
			output: {
				dir: "dist",
				format: "esm",
				sourcemapPathTransform: (relativeSourcePath) =>
					relativeSourcePath.replace(
						/^\.\.\//u,
						`decky://decky/plugin/${encodeURIComponent(manifest.name)}/`,
					),
				exports: "default",
			},
		},
	},
	resolve: {
		alias: {
			"@api": path.resolve(import.meta.dirname, "src/api"),
			"@events": path.resolve(import.meta.dirname, "src/events.ts"),
			"@components": path.resolve(import.meta.dirname, "src/components"),
			"@stores": path.resolve(import.meta.dirname, "src/stores"),
			"@pages": path.resolve(import.meta.dirname, "src/pages"),
			"@steam": path.resolve(import.meta.dirname, "src/steam"),
			"@typings": path.resolve(import.meta.dirname, "src/types"),
			"@ui": path.resolve(import.meta.dirname, "src/ui"),
			"@utils": path.resolve(import.meta.dirname, "src/utils"),
		},
	},
});
