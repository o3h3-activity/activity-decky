import { observable } from "@legendapp/state";
import { App } from "@steam/proxy/app";

interface UserStore {
	isLoggedIn: boolean;
}

export const userStory = observable<UserStore>({
	isLoggedIn: Boolean(App.getCurrentUserIdAsU64()),
});
