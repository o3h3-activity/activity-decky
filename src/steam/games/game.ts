import type { GameRecognitionResult } from "@api/catalog";
import type {
	GameIdentityRequest,
	GameIdentityResult,
} from "@api/discIdentity";
import { isNil } from "es-toolkit";

export class DiscIdentity {
	private constructor(
		private readonly result: Readonly<Omit<GameIdentityResult, "appId">>,
	) {}

	static fromResult({ appId: _, ...result }: GameIdentityResult): DiscIdentity {
		return new DiscIdentity(result);
	}

	/** Disc fingerprint; also the hash RetroAchievements resolves its game id from. */
	get md5(): string {
		return this.result.game_identity_md5;
	}

	get platform(): GameIdentityResult["platform"] {
		return this.result.platform;
	}

	/** RetroAchievements console id, not the game's id. */
	get raConsoleId(): number {
		return this.result.rcheevos_id;
	}

	get serial(): string | undefined {
		return this.result.serial ?? undefined;
	}

	toResult(appId: number): GameIdentityResult {
		return { appId, ...this.result };
	}
}

export class GameRelease {
	private constructor(
		readonly revisionId: string,
		/** Comments and friends gameplay need it. */
		readonly gameId: string | undefined,
		/** Comments and friends gameplay need it; older cache entries may lack it until they expire. */
		readonly releaseId: string | undefined,
	) {}

	/** `undefined` when the catalog definitively does not know the disc. */
	static fromAnswer({
		gameId,
		releaseId,
		releaseRevisionId,
	}: GameRecognitionResult): GameRelease | undefined {
		return isNil(releaseRevisionId)
			? undefined
			: new GameRelease(
					releaseRevisionId,
					gameId ?? undefined,
					releaseId ?? undefined,
				);
	}
}

/** Activity feeds, gameplay, and comments require both non-empty catalog identifiers. */
export function hasActivityIdentifiers(
	release: GameRelease | undefined,
): release is GameRelease & { gameId: string; releaseId: string } {
	return Boolean(release?.gameId && release.releaseId);
}

type CatalogState = "unasked" | "unlisted" | GameRelease;

export class Game {
	private constructor(
		readonly appId: number,
		readonly romPath: string,
		/** Absent when the backend cannot identify the ROM. */
		readonly disc: DiscIdentity | undefined,
		private readonly catalog: CatalogState,
	) {}

	static launching(appId: number, romPath: string): Game {
		return new Game(appId, romPath, undefined, "unasked");
	}

	get release(): GameRelease | undefined {
		return this.catalog instanceof GameRelease ? this.catalog : undefined;
	}

	get awaitsRecognition(): boolean {
		return !isNil(this.disc) && this.catalog === "unasked";
	}

	identifiedAs(disc: DiscIdentity): Game {
		return new Game(this.appId, this.romPath, disc, "unasked");
	}

	/** Applies the catalog's answer for this disc; without one the game still awaits recognition. */
	answeredBy(answers: readonly GameRecognitionResult[]): Game {
		const answer = answers.find(
			({ gameIdentityMd5 }) => gameIdentityMd5 === this.disc?.md5,
		);

		if (isNil(answer)) {
			return this;
		}

		const catalog = GameRelease.fromAnswer(answer) ?? "unlisted";

		return new Game(this.appId, this.romPath, this.disc, catalog);
	}

	toIdentityRequest(): GameIdentityRequest {
		return { appId: this.appId, path: this.romPath };
	}
}
