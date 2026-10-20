import { findModuleExport } from "@decky/ui";
import { isObjectLike } from "@utils/isObjectLike";

type ClanImageHelperLike = {
	GenerateURLFromHashAndExt: (...args: unknown[]) => unknown;
	GenerateURLFromHashAndExtAndLang: (...args: unknown[]) => unknown;
	GetBaseURL: () => string;
};

function isClanImageHelper(value: unknown): value is ClanImageHelperLike {
	if (!isObjectLike(value)) {
		return false;
	}

	const candidate = value as Partial<ClanImageHelperLike>;

	return (
		typeof candidate.GenerateURLFromHashAndExt === "function" &&
		typeof candidate.GenerateURLFromHashAndExtAndLang === "function" &&
		typeof candidate.GetBaseURL === "function"
	);
}

export class ClanImageHelper {
	public static getClanImageHelper(): Nullable<ClanImageHelperLike> {
		const helper: unknown = findModuleExport(isClanImageHelper);

		return isClanImageHelper(helper) ? helper : undefined;
	}
}
