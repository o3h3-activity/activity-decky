/**
 * SteamID64 layout: `(universe << 56) | (type << 52) | (instance << 32) | account`.
 * A clan id uses universe=1, type=7 (`k_EAccountTypeClan`), instance=0, account=0:
 * `0x0170000000000000n` === `103582791429521408n`.
 * `CSteamID.InitFromClanID(account)` is this base plus the 32-bit clan account id.
 * Check: official clan `43808803` → `103582791473330211`.
 */
const CLAN_STEAM_ID_BASE = 103_582_791_429_521_408n;

/**
 * Plugin-chosen offset for deterministic synthetic accounts, not a
 * Steam-reserved namespace. Together with the modulus it keeps the result
 * within a positive 32-bit `GetAccountID()` value.
 */
const CLAN_ACCOUNT_ID_OFFSET = 1_000_000;

/**
 * Clan account ids are packed in the low 32 bits of a SteamID64. Shortcut
 * app ids can exceed that; wrap so `InitFromClanID` / `GetAccountID` stay in
 * range. `2_000_000_000` is the mapping the old server used (under `2^31`).
 */
const CLAN_ACCOUNT_ID_MODULUS = 2_000_000_000;

/**
 * Deterministic fake official-game-group account for a shortcut.
 * `>>> 0` forces a Uint32 so huge shortcut app ids do not go negative
 * before the modulus.
 */
export function clanAccountIdFromAppId(appId: number): number {
	return CLAN_ACCOUNT_ID_OFFSET + ((appId >>> 0) % CLAN_ACCOUNT_ID_MODULUS);
}

/**
 * Tracks the synthetic clan IDs used by shortcuts during this login.
 *
 * Later event and image requests may contain only a clan ID, with no appid
 * to check. User News registers the mapped ID here first so those requests
 * can be recognized. Unregistered clans are left to Steam.
 *
 * The appid-to-clan mapping is our convention, not a reserved Steam ID range,
 * and it can collide. Registration is required; a clan-shaped URL alone is
 * not enough to identify a shortcut.
 */
export class ShortcutClanRegistry {
	private readonly clanAccountIds = new Set<number>();

	registerApp(appId: number): void {
		this.clanAccountIds.add(clanAccountIdFromAppId(appId));
	}

	has(clanAccountId: number): boolean {
		return this.clanAccountIds.has(clanAccountId);
	}
}

/** 64-bit clan Steam id as a decimal string (`CSteamID.ConvertTo64BitString`). */
export function clanSteamId64(clanAccountId: number): string {
	return String(CLAN_STEAM_ID_BASE + BigInt(clanAccountId));
}

/** Inverse of `clanSteamId64`; invalid or unsafe results have no account id. */
export function clanAccountIdFromSteamId64(
	steamId64: string,
): number | undefined {
	try {
		const clanAccountId = Number(BigInt(steamId64) - CLAN_STEAM_ID_BASE);

		return Number.isSafeInteger(clanAccountId) ? clanAccountId : undefined;
	} catch {
		return undefined;
	}
}
