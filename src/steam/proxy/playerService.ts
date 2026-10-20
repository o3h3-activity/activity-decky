import { findModuleExport } from "@decky/ui";
import type { SteamPlayerService } from "@typings/playerService";
import { isObjectLike } from "@utils/isObjectLike";

export class PlayerService {
	public static getPlayerService(): Nullable<SteamPlayerService> {
		const service: unknown = findModuleExport((exported: unknown) => {
			if (!isObjectLike(exported)) {
				return false;
			}

			const candidate = exported as Partial<SteamPlayerService>;

			return (
				typeof candidate.DeletePostedStatus === "function" &&
				typeof candidate.GetFriendsGameplayInfo === "function" &&
				typeof candidate.GetPostedStatus === "function" &&
				typeof candidate.PostStatusToFriends === "function"
			);
		});

		return service as Nullable<SteamPlayerService>;
	}
}
