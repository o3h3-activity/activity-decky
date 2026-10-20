import { Navigation } from "@decky/ui";

export const ROUTES = {
	signIn: "/activity/sign-in",
} as const;

export type Route = (typeof ROUTES)[keyof typeof ROUTES];

export function navigateTo(route: Route): void {
	Navigation.CloseSideMenus();
	Navigation.Navigate(route);
}
