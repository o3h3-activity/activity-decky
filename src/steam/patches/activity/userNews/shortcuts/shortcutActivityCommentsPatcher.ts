import { callOriginal, replacePatch } from "@decky/ui";
import { LifetimeScope } from "@steam/lifetimeScope";
import type { SteamAppActivity } from "@typings/appActivityStore";

/**
 * Removes Steam Community comment threads from shortcut activity.
 *
 * Steam creates the thread descriptors while `AddNewsEvents` runs, so they
 * must be cleared after its promise resolves. `BSupportsCommentThreads`
 * checks whether the array has entries; emptying it stops the UI from
 * loading Community threads that do not exist for these events.
 *
 * This applies to every event already in the shortcut's activity, not just
 * the new batch. The original result is returned unchanged.
 */
export class ShortcutActivityCommentsPatcher {
	private readonly patchedActivities = new WeakSet<SteamAppActivity>();
	private readonly scope = new LifetimeScope("UserNews/ActivityComments");

	patch(activity: SteamAppActivity): void {
		if (this.patchedActivities.has(activity)) {
			return;
		}

		const patch = replacePatch(activity, "AddNewsEvents", (args: unknown[]) => {
			if (this.scope.signal.aborted) {
				return callOriginal;
			}

			const result = Reflect.apply(patch.original, activity, args) as unknown;

			return Promise.resolve(result).then((value) => {
				if (this.scope.signal.aborted) {
					return value;
				}

				ShortcutActivityCommentsPatcher.clearCommentThreads(activity);

				return value;
			});
		});

		this.patchedActivities.add(activity);
		this.scope.add(patch);
	}

	unMount(): void {
		this.scope.unMount();
	}

	private static clearCommentThreads(activity: SteamAppActivity): void {
		for (const day of activity.m_mapActivityByDay.values()) {
			for (const event of day.events) {
				event.commentThreads?.splice(0);
			}
		}
	}
}
