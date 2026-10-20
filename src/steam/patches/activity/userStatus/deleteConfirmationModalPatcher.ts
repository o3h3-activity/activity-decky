import { afterPatch, findModuleExport } from "@decky/ui";
import { LifetimeScope } from "@steam/lifetimeScope";
import logger from "@utils/logger";
import type { UserStatusRegistry } from "./statusRegistry";

type DeleteConfirmationModal = Readonly<{
	close: () => void;
	closed?: PromiseLike<unknown>;
}>;

type DeleteConfirmationModalElement = {
	props?: {
		event?: {
			GetUserStatus?: () => {
				time?: bigint | number | string;
			};
		};
	};
};

type DeleteConfirmationModalResult = {
	Close?: unknown;
	ClosedPromise?: unknown;
};

type ModalManagerPrototype = {
	ShowLegacyPopupModal: (...args: unknown[]) => unknown;
	ShowModalInternal: (...args: unknown[]) => unknown;
};

type ModalManagerConstructor = {
	prototype: ModalManagerPrototype;
};

type MaybeModalManagerConstructor = {
	prototype?: Partial<ModalManagerPrototype>;
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (
		(typeof value === "object" || typeof value === "function") &&
		value !== null &&
		"then" in value &&
		typeof value.then === "function"
	);
}

function isModalManagerConstructor(
	value: unknown,
): value is ModalManagerConstructor {
	if (typeof value !== "function") {
		return false;
	}

	const candidate = value as MaybeModalManagerConstructor;

	return (
		typeof candidate.prototype?.ShowLegacyPopupModal === "function" &&
		typeof candidate.prototype.ShowModalInternal === "function"
	);
}

function readDeleteConfirmationPostId(element: unknown): string | undefined {
	// Steam's dynamically discovered React component has no exported props type.
	const candidate = element as DeleteConfirmationModalElement | undefined;
	const postTime = candidate?.props?.event?.GetUserStatus?.()?.time;

	if (
		typeof postTime !== "bigint" &&
		typeof postTime !== "number" &&
		typeof postTime !== "string"
	) {
		return undefined;
	}

	return postTime.toString();
}

function isCloseModal(value: unknown): value is () => void {
	return typeof value === "function";
}

function readDeleteConfirmationModal(
	value: unknown,
): DeleteConfirmationModal | undefined {
	// Steam's modal manager result type is internal and unavailable to the plugin.
	const candidate = value as DeleteConfirmationModalResult | undefined;

	if (!isCloseModal(candidate?.Close)) {
		return undefined;
	}

	return {
		close: candidate.Close,
		closed: isPromiseLike(candidate.ClosedPromise)
			? candidate.ClosedPromise
			: undefined,
	};
}

/**
 * Tracks Steam delete-confirmation modals so successful custom deletions can close them.
 */
export class UserStatusDeleteConfirmationModalPatcher {
	private readonly deleteModalClosers = new Map<string, () => void>();
	private readonly scope = new LifetimeScope("UserStatus/DeleteModal");

	constructor(private readonly registry: UserStatusRegistry) {
		this.scope.addDisposer(() => {
			this.deleteModalClosers.clear();
		});
	}

	/**
	 * Hooks both modal-manager entry points; unavailable Steam internals leave no modal patches.
	 * Preserves Steam's modal handles so unrelated dialogs retain their native close/cancel behavior.
	 */
	install(): void {
		const discoveredConstructor: unknown = findModuleExport(
			isModalManagerConstructor,
		);
		const modalManagerConstructor = isModalManagerConstructor(
			discoveredConstructor,
		)
			? discoveredConstructor
			: undefined;

		if (!modalManagerConstructor) {
			logger.error(
				"[UserStatus] Steam modal manager not found; successful deletions may leave their confirmation modal open.",
			);

			return;
		}

		const { prototype } = modalManagerConstructor;

		this.scope.add(
			afterPatch(
				prototype,
				"ShowModalInternal",
				(args: unknown[], result: unknown) => {
					this.captureDeleteConfirmationModal(args[0], result);

					return result;
				},
			),
		);

		this.scope.add(
			afterPatch(
				prototype,
				"ShowLegacyPopupModal",
				(args: unknown[], result: unknown) => {
					this.captureDeleteConfirmationModal(args[1], result);

					return result;
				},
			),
		);
	}

	/**
	 * Closes a captured modal after its backend deletion succeeds.
	 */
	close(postId: string): void {
		const closeModal = this.deleteModalClosers.get(postId);

		if (!closeModal) {
			return;
		}

		this.deleteModalClosers.delete(postId);

		try {
			closeModal();
		} catch (error: unknown) {
			logger.error(
				"[UserStatus] Failed to close the delete confirmation modal.",
				{ error, postId },
			);
		}
	}

	/**
	 * Stops tracking callbacks without closing user-visible modals during teardown.
	 */
	unMount(): void {
		this.scope.unMount();
	}

	private captureDeleteConfirmationModal(
		element: unknown,
		result: unknown,
	): void {
		if (this.scope.signal.aborted) {
			return;
		}

		const postId = readDeleteConfirmationPostId(element);

		if (!postId || !this.registry.getOwnedByPostId(postId)) {
			return;
		}

		const modal = readDeleteConfirmationModal(result);

		if (!modal) {
			return;
		}

		const closeModal = modal.close;

		this.deleteModalClosers.set(postId, closeModal);
		const forgetModal = (): void => {
			if (this.deleteModalClosers.get(postId) === closeModal) {
				this.deleteModalClosers.delete(postId);
			}
		};

		void modal.closed?.then(forgetModal, forgetModal);
	}
}
