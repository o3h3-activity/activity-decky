import type { Events } from "@events";
import type { Emitter } from "nanoevents";
import { RegisterForLoginStateChange } from "./registerForLoginStateChange";

export class MiddlewareManager {
	constructor(eventBus: Emitter<Events>) {
		RegisterForLoginStateChange.register(eventBus);
	}

	unMount(): void {
		RegisterForLoginStateChange.unregister();
	}
}
