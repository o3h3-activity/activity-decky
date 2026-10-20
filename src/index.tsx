import { definePlugin } from "@decky/api";
import { staticClasses } from "@decky/ui";
import { ActivitySettings } from "@pages/quick-access-menu";
import { createNanoEvents } from "nanoevents";
import { MdGamepad } from "react-icons/md";
import type { Events } from "./events";
import { Plugin } from "./plugin";

const emitter = createNanoEvents<Events>();

// oxlint-disable-next-line react/only-export-components
export default definePlugin(() => {
	const plugin = new Plugin(emitter);

	plugin.mount();

	return {
		name: "Activity",
		titleView: <div className={staticClasses.Title}>Activity</div>,
		content: <ActivitySettings />,
		icon: <MdGamepad />,
		onDismount() {
			plugin.unMount();
		},
	};
});
