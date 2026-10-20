import type {
	AppAchievement,
	AppAchievements,
} from "@decky/ui/dist/globals/steam-client/App";
import { LifetimeScope } from "@steam/lifetimeScope";
import type { PlatformAchievement } from "@typings/achievements";
import logger from "@utils/logger";
import { isNil } from "es-toolkit";
import { toSteamAchievement } from "./toSteamAchievement";

export type MappedAchievements = {
	details: AppAchievements;
	platformAchievements: PlatformAchievement[];
	readonly platformAchievementsById: ReadonlyMap<string, PlatformAchievement>;
	rgAchievements: AppAchievement[];
};

/** Steam shows at most three highlighted achievements per app. */
const HIGHLIGHT_COUNT = 3;

export abstract class AchievementsProvider {
	abstract readonly name: string;

	protected readonly failureRetryMs: number = 60_000;

	protected readonly scope = new LifetimeScope("Achievements/Provider");
	private generation = 0;
	private readonly invalidationListeners = new Set<() => void>();

	private readonly cacheByAppId = new Map<number, MappedAchievements>();
	private readonly failedAtByAppId = new Map<number, number>();
	private readonly fetchByAppId = new Map<
		number,
		Promise<MappedAchievements | undefined>
	>();

	constructor() {
		this.scope.addDisposer(() => {
			this.invalidate();
			this.invalidationListeners.clear();
		});
	}

	protected get disposed(): boolean {
		return this.scope.signal.aborted;
	}

	/** Shared epoch for provider data and consumers' pending work. */
	get invalidationVersion(): number {
		return this.generation;
	}

	/** Called synchronously after old data and requests have been invalidated. */
	onInvalidated(listener: () => void): () => void {
		this.invalidationListeners.add(listener);

		return () => {
			this.invalidationListeners.delete(listener);
		};
	}

	/** Do not reuse progress, failed lookups, or requests from the previous epoch. */
	protected invalidate(): void {
		this.generation += 1;
		this.cacheByAppId.clear();
		this.failedAtByAppId.clear();
		this.fetchByAppId.clear();

		for (const listener of this.invalidationListeners) {
			listener();
		}
	}

	getCached(appId: number): MappedAchievements | undefined {
		return this.cacheByAppId.get(appId);
	}

	shouldFetch(appId: number): boolean {
		if (
			this.disposed ||
			this.cacheByAppId.has(appId) ||
			this.fetchByAppId.has(appId)
		) {
			return false;
		}

		return !this.isInFailureBackoff(appId);
	}

	async getAchievements(
		appId: number,
	): Promise<MappedAchievements | undefined> {
		if (this.disposed) {
			return undefined;
		}

		const generation = this.generation;
		const cached = this.cacheByAppId.get(appId);

		if (cached) {
			return cached;
		}

		let fetchPromise = this.fetchByAppId.get(appId);

		if (isNil(fetchPromise)) {
			if (this.isInFailureBackoff(appId)) {
				return undefined;
			}

			fetchPromise = this.load(appId, generation).finally(() => {
				if (this.fetchByAppId.get(appId) === fetchPromise) {
					this.fetchByAppId.delete(appId);
				}
			});

			this.fetchByAppId.set(appId, fetchPromise);
		}

		const achievements = await fetchPromise;

		return this.disposed || generation !== this.generation
			? undefined
			: achievements;
	}

	/** Ends this provider's lifetime; the next session needs a fresh instance. */
	unMount(): void {
		this.scope.unMount();
	}

	private isInFailureBackoff(appId: number): boolean {
		const failedAt = this.failedAtByAppId.get(appId);

		if (failedAt === undefined) {
			return false;
		}

		if (Date.now() - failedAt < this.failureRetryMs) {
			return true;
		}

		this.failedAtByAppId.delete(appId);

		return false;
	}

	protected abstract fetchPlatformAchievements(
		appId: number,
	): Promise<PlatformAchievement[] | undefined>;

	private async load(
		appId: number,
		generation: number,
	): Promise<MappedAchievements | undefined> {
		try {
			const list = await this.fetchPlatformAchievements(appId);

			if (this.disposed || generation !== this.generation) {
				return undefined;
			}

			if (isNil(list)) {
				this.failedAtByAppId.set(appId, Date.now());

				return undefined;
			}

			const mapped = this.mapToSteam(list);

			this.cacheByAppId.set(appId, mapped);
			this.failedAtByAppId.delete(appId);

			return mapped;
		} catch (error) {
			if (this.disposed || generation !== this.generation) {
				return undefined;
			}

			this.failedAtByAppId.set(appId, Date.now());

			logger.error(
				`[Achievements][${this.name}] Failed to load appId=${appId}`,
				{ error },
			);

			return undefined;
		}
	}

	private mapToSteam(achievements: PlatformAchievement[]): MappedAchievements {
		const platformAchievementsById = new Map<string, PlatformAchievement>();

		for (const achievement of achievements) {
			platformAchievementsById.set(achievement.id, achievement);
		}

		const all = achievements.map(toSteamAchievement);
		const achievedItems = all.filter((item) => item.bAchieved);
		const unachievedItems = all.filter((item) => !item.bAchieved);
		const vecHighlight = [...achievedItems]
			.sort((a, b) => b.rtUnlocked - a.rtUnlocked)
			.slice(0, HIGHLIGHT_COUNT);
		const vecAchievedHidden = achievedItems.filter((item) => item.bHidden);

		logger.debug(
			`[Achievements][${this.name}] Mapped: nTotal=${all.length}, nAchieved=${achievedItems.length}, vecHighlight=${vecHighlight.map((a) => a.strName).join(", ")}`,
		);

		return {
			details: {
				nAchieved: achievedItems.length,
				nTotal: all.length,
				vecAchievedHidden,
				vecHighlight,
				vecUnachieved: unachievedItems,
			},
			platformAchievements: achievements,
			platformAchievementsById,
			rgAchievements: [...achievedItems, ...unachievedItems],
		};
	}
}
