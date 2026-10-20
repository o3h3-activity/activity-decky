import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig } from "eslint/config";
import arrayFunc from "eslint-plugin-array-func";
import oxlint from "eslint-plugin-oxlint";
import perfectionist from "eslint-plugin-perfectionist";
import pluginReact from "eslint-plugin-react";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
	{
		ignores: ["*.config.ts", "steam-deck-api.d.ts"],
	},

	{
		files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
		plugins: { js },
		extends: ["js/recommended"],
		languageOptions: { globals: globals.browser },
	},

	tseslint.configs.strictTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/prefer-optional-chain": "error",
			"@typescript-eslint/no-unnecessary-condition": "off",
			"@typescript-eslint/explicit-module-boundary-types": "off",
			"@typescript-eslint/no-extraneous-class": "off",
		},
	},

	{
		files: ["src/utils/logger.ts"],
		rules: {
			"@typescript-eslint/no-confusing-void-expression": "off",
		},
	},

	{
		files: ["verify/**/*.ts"],
		rules: {
			"@typescript-eslint/no-unsafe-call": "off",
			"@typescript-eslint/no-unsafe-member-access": "off",
		},
	},

	pluginReact.configs.flat.recommended,
	{
		settings: { react: { version: "19.1.0" } },
		rules: {
			"react/prop-types": "off",
		},
	},

	{
		plugins: { unicorn },
		rules: {
			"unicorn/no-for-loop": "error",
			"unicorn/no-array-push-push": "error",
		},
	},

	sonarjs.configs.recommended,
	{
		rules: {
			"sonarjs/cognitive-complexity": ["error", 20],
			"sonarjs/no-duplicate-string": "off",
			"sonarjs/function-return-type": "off",
		},
	},

	{
		plugins: { perfectionist },
		rules: {
			"perfectionist/sort-interfaces": ["error", { type: "natural" }],
			"perfectionist/sort-object-types": ["error", { type: "natural" }],
			"perfectionist/sort-union-types": ["error", { type: "natural" }],
		},
	},

	{
		plugins: { "array-func": arrayFunc.default ?? arrayFunc },
		rules: {
			"array-func/from-map": "error",
			"array-func/no-unnecessary-this-arg": "error",
			"array-func/prefer-flat-map": "error",
			"array-func/prefer-flat": "error",
		},
	},

	{
		plugins: { "@stylistic": stylistic },
		rules: {
			"@stylistic/padding-line-between-statements": [
				"error",
				{ blankLine: "always", prev: "*", next: "return" },
				{ blankLine: "always", prev: "*", next: "throw" },
				{ blankLine: "always", prev: "*", next: "if" },
				{ blankLine: "always", prev: "*", next: "switch" },
				{ blankLine: "always", prev: "*", next: "for" },
				{ blankLine: "always", prev: "*", next: "while" },
				{ blankLine: "always", prev: "*", next: "do" },
				{ blankLine: "always", prev: "*", next: "try" },
				{ blankLine: "always", prev: "*", next: "function" },
				{ blankLine: "always", prev: "*", next: "class" },
				{ blankLine: "always", prev: "block-like", next: "*" },
				{ blankLine: "always", prev: "multiline-const", next: "*" },
				{ blankLine: "always", prev: "multiline-expression", next: "*" },
				{
					blankLine: "always",
					prev: ["const", "let", "var"],
					next: "expression",
				},
				{
					blankLine: "any",
					prev: ["const", "let", "var"],
					next: ["const", "let", "var"],
				},
			],
			"@stylistic/lines-between-class-members": [
				"error",
				"always",
				{ exceptAfterSingleLine: true },
			],
			"@stylistic/spaced-comment": ["error", "always"],
			"@stylistic/jsx-newline": ["error", { prevent: false }],
		},
	},

	...oxlint.configs["flat/all"],
]);
