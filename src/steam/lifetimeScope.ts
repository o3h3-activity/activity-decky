import type { Patch } from "@decky/ui";
import logger from "@utils/logger";

type Disposer = () => void;

/**
 * One owner's lifetime: an abort signal plus LIFO cleanup.
 * `signal` aborts as soon as `unMount()` starts, before any disposer runs.
 */
export class LifetimeScope {
	private readonly disposers: Disposer[] = [];
	private readonly lifetime = new AbortController();

	constructor(private readonly owner: string) {}

	get signal(): AbortSignal {
		return this.lifetime.signal;
	}

	/** Starts installation; live failures log and unmount, ended lifetimes stay silent. */
	installGuarded(install: () => Promise<void>, failureMessage: string): void {
		void install().catch((error: unknown) => {
			if (this.signal.aborted) {
				return;
			}

			logger.error(failureMessage, error);
			this.unMount();
		});
	}

	/** Registers a @decky/ui patch handle; unpatched at once if already unmounted. */
	add(patch: Patch): void {
		this.addDisposer(() => {
			patch.unpatch();
		});
	}

	/** Adopts a resource, unmounting it together with this scope. */
	track<T extends { unMount(): void }>(resource: T): T {
		this.addDisposer(() => {
			resource.unMount();
		});

		return resource;
	}

	/** Registers a raw cleanup callback; run at once if already unmounted. */
	addDisposer(dispose: Disposer): void {
		if (this.signal.aborted) {
			this.run(dispose);

			return;
		}

		this.disposers.push(dispose);
	}

	unMount(): void {
		if (this.signal.aborted) {
			return;
		}

		this.lifetime.abort();

		for (let index = this.disposers.length - 1; index >= 0; index -= 1) {
			this.run(this.disposers[index]);
		}

		this.disposers.length = 0;
	}

	private run(dispose: Disposer): void {
		try {
			dispose();
		} catch (error: unknown) {
			logger.error(`[${this.owner}] Failed to run disposer`, error);
		}
	}
}
