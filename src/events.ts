export type Events = {
	UserLoggedIn: (userName: string) => void;
	UserLoggedOut: () => void;
};
