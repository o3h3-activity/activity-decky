/**
 * Store capsule used when Steam builds
 * `https://clan.steamstatic.com/images/{clanAccountId}/{hash}.jpg`.
 * That CDN has no objects for minted clans. `GetImageURL` only skips the
 * clan-CDN builder when `jsondata` already holds an `http…` URL; this is
 * also the rewrite target for `GenerateURLFromHashAndExt`.
 */
export const SAMPLE_EVENT_CAPSULE =
	"https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/730/162664aa5da85f418105350c5d67ca565f6c3713/header.jpg";
