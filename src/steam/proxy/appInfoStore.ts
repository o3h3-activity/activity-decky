import { findModuleExport } from "@decky/ui";
import { isObjectLike } from "@utils/isObjectLike";

type AppInfoStoreLike = {
	FlushPendingAppInfo(): Promise<void>;
	GetAppInfo(appId: number): unknown;
	LoadAppInfoBatch(appIds: number[]): Promise<void>;
	QueueAppInfoRequest(appId: number): Promise<void>;
};

export class AppInfoStore {
	public static getAppInfoStore(): Nullable<AppInfoStoreLike> {
		const store: unknown = findModuleExport((exported: unknown) => {
			if (!isObjectLike(exported)) {
				return false;
			}

			const candidate = exported as Partial<AppInfoStoreLike>;

			return (
				typeof candidate.GetAppInfo === "function" &&
				typeof candidate.QueueAppInfoRequest === "function" &&
				typeof candidate.FlushPendingAppInfo === "function" &&
				typeof candidate.LoadAppInfoBatch === "function"
			);
		});

		return store as Nullable<AppInfoStoreLike>;
	}
}
