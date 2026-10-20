import { EResult } from "@decky/ui/dist/globals/steam-client/shared";
import type { SteamUserNewsProtoEvent } from "@typings/userNewsService";
import { describe, expect, it } from "vitest";
import { UserNewsRpcResponse } from "./userNewsRpcResponse";

const protoEvent = (id: string): SteamUserNewsProtoEvent & { id: string } => ({
	id,
	serializeBinary: () => new Uint8Array(),
});

describe("UserNewsRpcResponse", () => {
	it("filters to the inclusive window, sorts newest-first, and caps the result", () => {
		const x = protoEvent("x");
		const a = protoEvent("a");
		const b = protoEvent("b");
		const c = protoEvent("c");
		const y = protoEvent("y");
		const response = UserNewsRpcResponse.fromEventResults(
			[
				{ event: x, eventTime: 50 },
				{ event: a, eventTime: 150 },
				{ event: b, eventTime: 250 },
				{ event: c, eventTime: 300 },
				{ event: y, eventTime: 350 },
			],
			{ appId: 1, count: 2, startTime: 100, endTime: 300 },
		);

		expect(response.Body().news()).toEqual([c, b]);
		expect(response.GetEResult()).toBe(EResult.OK);
		expect(response.Body().achievement_display_data()).toEqual([]);
	});

	it("preserves input order for equal event times", () => {
		const first = protoEvent("first");
		const second = protoEvent("second");
		const response = UserNewsRpcResponse.fromEventResults(
			[
				{ event: first, eventTime: 100 },
				{ event: second, eventTime: 100 },
			],
			{ appId: 1, count: 10, startTime: 0, endTime: 0 },
		);

		expect(response.Body().news()).toEqual([first, second]);
	});

	it("creates an empty successful spotlight response", () => {
		const response = UserNewsRpcResponse.emptySpotlight();

		expect(response.Body().events()).toEqual([]);
		expect(response.Body().toObject()).toEqual({ events: [] });
		expect(response.GetEResult()).toBe(EResult.OK);
	});
});
