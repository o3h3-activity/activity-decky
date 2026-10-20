declare module "*.svg" {
	const content: string;
	export default content;
}

declare module "*.png" {
	const content: string;
	export default content;
}

declare module "*.jpg" {
	const content: string;
	export default content;
}

/** Compiled by the Tailwind plugin in vite.config.ts and imported as a stylesheet string. */
declare module "*.css?inline" {
	const content: string;
	export default content;
}

type Nullable<T> = null | T | undefined;

interface Unregisterable {
	/**
	 * Unregister the Steam API callback.
	 */
	unregister(): void;
}
