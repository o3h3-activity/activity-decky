import type { ProtoRequest } from "@steam/patches/activity/protoRequest";
import { describe, expect, it, vi } from "vitest";
import { UserNewsRequests } from "./userNewsRequests";

const START_TIME = 100;
const END_TIME = 200;
const BEFORE_WINDOW = 99;
const AFTER_WINDOW = 201;
const OPEN_ENDED_EVENT_TIME = 9_999_999_999;

const requestArgs = (body: {
	appId?: number;
	count?: number;
	endTime?: number;
	startTime?: number;
}): unknown[] => [
	undefined,
	{
		Body: () => ({
			count: () => body.count,
			endtime: () => body.endTime,
			filterappid: () => body.appId,
			starttime: () => body.startTime,
		}),
	},
];

describe("UserNewsRequests.read", () => {
	it("reads a complete valid request", () => {
		expect(
			UserNewsRequests.read(
				requestArgs({ appId: 123, count: 10, startTime: 100, endTime: 200 }),
			),
		).toEqual({ appId: 123, count: 10, endTime: 200, startTime: 100 });
	});

	it("reads all fields from a single request body", () => {
		const expected = {
			appId: 123,
			count: 10,
			endTime: END_TIME,
			startTime: START_TIME,
		};
		const otherAppId = 456;
		const body = vi
			.fn<NonNullable<ProtoRequest["Body"]>>()
			.mockReturnValueOnce({
				count: () => expected.count,
				endtime: () => expected.endTime,
				filterappid: () => expected.appId,
				starttime: () => expected.startTime,
			})
			.mockReturnValue({
				filterappid: () => otherAppId,
			});

		expect(UserNewsRequests.read([undefined, { Body: body }])).toEqual(
			expected,
		);

		expect(body).toHaveBeenCalledOnce();
	});

	it("accepts open-ended windows and rejects inverted closed windows", () => {
		expect(
			UserNewsRequests.read(
				requestArgs({ appId: 123, count: 10, startTime: 300, endTime: 0 }),
			),
		).toEqual({ appId: 123, count: 10, endTime: 0, startTime: 300 });

		expect(
			UserNewsRequests.read(
				requestArgs({ appId: 123, count: 10, startTime: 300, endTime: 200 }),
			),
		).toBeUndefined();
	});

	it.each([
		["zero count", { appId: 123, count: 0, startTime: 0, endTime: 0 }],
		["zero app id", { appId: 0, count: 10, startTime: 0, endTime: 0 }],
		[
			"negative start time",
			{ appId: 123, count: 10, startTime: -1, endTime: 0 },
		],
	] as const)("rejects %s", (_name, body) => {
		expect(UserNewsRequests.read(requestArgs(body))).toBeUndefined();
	});

	it("rejects missing RPC arguments", () => {
		expect(UserNewsRequests.read([])).toBeUndefined();
	});
});

describe("UserNewsRequests.isWithinWindow", () => {
	const request = {
		appId: 1,
		count: 10,
		startTime: START_TIME,
		endTime: END_TIME,
	};

	it("includes both bounds and rejects times outside the window", () => {
		expect([
			UserNewsRequests.isWithinWindow(request, START_TIME),
			UserNewsRequests.isWithinWindow(request, END_TIME),
			UserNewsRequests.isWithinWindow(request, BEFORE_WINDOW),
			UserNewsRequests.isWithinWindow(request, AFTER_WINDOW),
		]).toEqual([true, true, false, false]);
	});

	it("treats zero bounds as open-ended", () => {
		expect([
			UserNewsRequests.isWithinWindow(
				{ appId: 1, count: 10, startTime: 0, endTime: 0 },
				1,
			),
			UserNewsRequests.isWithinWindow(
				{ appId: 1, count: 10, startTime: 0, endTime: 0 },
				OPEN_ENDED_EVENT_TIME,
			),
		]).toEqual([true, true]);
	});
});
