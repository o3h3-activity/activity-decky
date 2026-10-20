import type { ObservableListenerDispose } from "@legendapp/state";
import { userStory } from "@stores/user";
import logger from "@utils/logger";

/** A per-login resource; `unMount()` must also cancel a pending `mount()`. */
export interface SessionResource {
	/**
	 * Starts the resource; resolution is not an aggregate readiness guarantee.
	 * Children may install asynchronously and must handle their own failures.
	 */
	mount(): Promise<void>;
	unMount(): void;
}

/** Owns one fresh resource per login; the resource owns its cleanup. */
export class SessionLifecycle {
	private unsubscribe: ObservableListenerDispose | undefined;
	private active: SessionResource | undefined;

	constructor(private readonly create: () => SessionResource) {}

	mount(): void {
		if (this.unsubscribe) {
			return;
		}

		this.unsubscribe = userStory.isLoggedIn.onChange(({ value }) => {
			this.update(value);
		});

		this.update(userStory.isLoggedIn.get());
	}

	unMount(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.stop();
	}

	private update(isLoggedIn: boolean): void {
		if (!isLoggedIn) {
			this.stop();

			return;
		}

		if (this.active) {
			return;
		}

		const resource = this.create();

		this.active = resource;

		void resource.mount().catch((error: unknown) => {
			logger.error("[SessionLifecycle] Failed to start session", error);

			// A late failure from an old session must not stop the new one.
			if (this.active === resource) {
				this.stop();
			}
		});
	}

	private stop(): void {
		const { active } = this;

		this.active = undefined;

		try {
			active?.unMount();
		} catch (error: unknown) {
			logger.error("[SessionLifecycle] Failed to clean up session", error);
		}
	}
}
