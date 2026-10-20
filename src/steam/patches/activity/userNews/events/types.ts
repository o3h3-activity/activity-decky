import type { SteamAppActivity } from "@typings/appActivityStore";
import type {
	SteamUserNewsProtoEvent,
	SteamUserNewsProtoEventConstructor,
} from "@typings/userNewsService";

export type UserNewsRequest = Readonly<{
	appId: number;
	count: number;
	endTime: number;
	startTime: number;
}>;

export type UserNewsEventResult = Readonly<{
	event: SteamUserNewsProtoEvent;
	eventTime: number;
}>;

export type UserNewsEventContext = {
	activity: SteamAppActivity;
	appId: number;
	gameId: string;
	proto: SteamUserNewsProtoEventConstructor;
};
