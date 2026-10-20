import { findModuleExport } from "@decky/ui";
import type { SteamQueryClient } from "@typings/queryClient";
import { isObjectLike } from "@utils/isObjectLike";

export class QueryClient {
	public static getQueryClient(): Nullable<SteamQueryClient> {
		const client: unknown = findModuleExport((exported: unknown) => {
			if (!isObjectLike(exported)) {
				return false;
			}

			const candidate = exported as Partial<SteamQueryClient>;

			return (
				typeof candidate.invalidateQueries === "function" &&
				typeof candidate.getQueryCache === "function" &&
				typeof candidate.getQueryData === "function" &&
				typeof candidate.setQueryData === "function" &&
				typeof candidate.cancelQueries === "function" &&
				typeof candidate.removeQueries === "function"
			);
		});

		return client as Nullable<SteamQueryClient>;
	}
}
