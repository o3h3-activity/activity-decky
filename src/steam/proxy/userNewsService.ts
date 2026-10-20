import { findModuleExport } from "@decky/ui";
import type {
	SteamUserGameActivityService,
	SteamUserNewsProtoEventConstructor,
	SteamUserNewsService,
} from "@typings/userNewsService";
import { isObjectLike } from "@utils/isObjectLike";

export abstract class UserNewsService {
	public static getUserNewsService(): Nullable<SteamUserNewsService> {
		const service: unknown = findModuleExport((exported: unknown) => {
			if (!isObjectLike(exported)) {
				return false;
			}

			const candidate = exported as Partial<SteamUserNewsService>;

			return (
				typeof candidate.GetUserNews === "function" &&
				typeof candidate.GetAppDetailsSpotlight === "function"
			);
		});

		return service as Nullable<SteamUserNewsService>;
	}

	public static getUserGameActivityService(): Nullable<SteamUserGameActivityService> {
		return findModuleExport((exported: unknown) => {
			if (!isObjectLike(exported) || !("GetActivity" in exported)) {
				return false;
			}

			return (
				typeof exported.GetActivity === "function" &&
				exported.GetActivity.toString().includes(
					"UserGameActivity.GetActivity#1",
				)
			);
		}) as Nullable<SteamUserGameActivityService>;
	}

	public static getProtoEventConstructor(): Nullable<SteamUserNewsProtoEventConstructor> {
		const proto: unknown = findModuleExport((exported: unknown) => {
			if (typeof exported !== "function") {
				return false;
			}

			const candidate = exported as Partial<SteamUserNewsProtoEventConstructor>;

			return (
				typeof candidate.fromObject === "function" &&
				candidate.prototype?.getClassName?.() === "CUserNews_Event"
			);
		});

		return proto as Nullable<SteamUserNewsProtoEventConstructor>;
	}
}
