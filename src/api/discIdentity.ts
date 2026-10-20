import { rpc } from "./rpc/transport";

/** First-run hashing of a whole shortcut library. A retry after this deadline joins the backend's still-running hash of each ROM instead of hashing it again. */
const GAME_IDENTITIES_TIMEOUT_MS = 120_000;

export type GameIdentityRequest = { appId: number; path: string };

export type GameIdentityResult = {
	appId: number;
	game_identity_md5: string;
	platform: "ps1" | "ps2" | "psp";
	/** RetroAchievements console ID, not the game's ID. */
	rcheevos_id: number;
	serial: null | string;
};

export const gameAnatomyHandshake = rpc("game_anatomy_handshake");

export const getGameIdentities = rpc(
	"get_game_identities",
	GAME_IDENTITIES_TIMEOUT_MS,
);
