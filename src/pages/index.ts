import { routerHook } from "@decky/api";
import type { LifetimeScope } from "@steam/lifetimeScope";
import type { ComponentType } from "react";
import { ROUTES, type Route } from "./routes";
import { SignInPage } from "./sign-in";

const PAGES: Readonly<Record<Route, ComponentType>> = {
	[ROUTES.signIn]: SignInPage,
};

/** Registers every page route; each is removed when `scope` unmounts. */
export function registerPages(scope: LifetimeScope): void {
	for (const [path, page] of Object.entries(PAGES)) {
		routerHook.addRoute(path, page, { exact: true });

		scope.addDisposer(() => {
			routerHook.removeRoute(path);
		});
	}
}
