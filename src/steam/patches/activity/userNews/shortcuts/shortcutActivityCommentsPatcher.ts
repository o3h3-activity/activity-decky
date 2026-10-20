import { callOriginal, replacePatch } from "@decky/ui";
import { LifetimeScope } from "@steam/lifetimeScope";
import type { SteamAppActivity } from "@typings/appActivityStore";

/** Clears comment threads on every activity event after AddNewsEvents on shortcut activities. */
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
