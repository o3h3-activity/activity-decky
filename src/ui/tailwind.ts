import { findSP } from "@decky/ui";
import type { LifetimeScope } from "@steam/lifetimeScope";
import logger from "@utils/logger";
import { isNil } from "es-toolkit";
import stylesheet from "./tailwind.css?inline";

const STYLE_ELEMENT_ID = "activity-tailwind";

/**
 * Injects the compiled Tailwind stylesheet into the Steam UI window's <head>,
 * replacing a copy left by a previous plugin load; removed when `scope` unmounts.
 */
export function injectTailwind(scope: LifetimeScope): void {
	// Typed `Window`, but yields `undefined` when the gamepad UI root is missing.
	const spWindow: Nullable<Window> = findSP();

	if (isNil(spWindow)) {
		logger.error(
			"[activity] Steam UI window not found; Tailwind styles not injected",
		);

		return;
	}

	const spDocument = spWindow.document;

	spDocument.querySelector(`#${STYLE_ELEMENT_ID}`)?.remove();

	const style = spDocument.createElement("style");

	style.id = STYLE_ELEMENT_ID;
	style.textContent = stylesheet;
	spDocument.head.append(style);

	scope.addDisposer(() => {
		style.remove();
	});
}
