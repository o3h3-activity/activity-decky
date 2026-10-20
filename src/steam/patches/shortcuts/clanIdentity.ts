/**
 * SteamID64 layout: `(universe << 56) | (type << 52) | (instance << 32) | account`.
 * A clan id uses universe=1, type=7 (`k_EAccountTypeClan`), instance=0, account=0:
 * `0x0170000000000000n` === `103582791429521408n`.
 * `CSteamID.InitFromClanID(account)` is this base plus the 32-bit clan account id.
 * Check: official clan `43808803` → `103582791473330211`.
 */
const CLAN_STEAM_ID_BASE = 103_582_791_429_521_408n;

/**
 * Shift minted accounts out of the low official-clan range (Valve groups are
 * typically a few million). Combined with the modulus, the result stays a
 * positive 32-bit `GetAccountID()` value.
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
 * Clan account ids minted for shortcut Activity tabs during one session.
 * Axios/fetch vanity and partner-event URLs often omit `appid`; the intercept
 * redirects only known shortcut clans so official `steamcommunity.com/gid/…`
 * is not stolen.
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
