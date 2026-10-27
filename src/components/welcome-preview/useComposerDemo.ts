import { useEffect, useState } from "react";

/** Placeholder time before each comment starts typing. */
const PLACEHOLDER_MS = 3000;
/** A typed comment stays readable this long before it is sent. */
const READ_MS = 2000;
const KEYSTROKE_MS = 50;
/** Typing slows between words, so it doesn't tick like a metronome. */
const WORD_PAUSE_MS = 70;

const PUNCTUATION_PAUSE_MS = 220;
const PUNCTUATION: Partial<Readonly<Record<string, true>>> = {
	",": true,
	".": true,
	"!": true,
	"?": true,
};

type ComposerDemo = Readonly<{
	/** Increments whenever a comment is sent. */
	sentCount: number;
	/** The comment typed so far; empty shows the placeholder. */
	text: string;
}>;

export function useComposerDemo(messages: readonly string[]): ComposerDemo {
	const [text, setText] = useState("");
	const [sentCount, setSentCount] = useState(0);

	useEffect(() => {
		if (
			messages.length === 0 ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			return;
		}

		let timer = 0;

		function type(index: number, length: number): void {
			const message = messages[index];

			if (length > message.length) {
				timer = window.setTimeout(() => {
					setText("");
					setSentCount((count) => count + 1);
					timer = window.setTimeout(
						() => type((index + 1) % messages.length, 1),
						PLACEHOLDER_MS,
					);
				}, READ_MS);

				return;
			}

			setText(message.slice(0, length));

			const typed = message[length - 1];
			let pause = 0;

			if (PUNCTUATION[typed] === true) {
				pause = PUNCTUATION_PAUSE_MS;
			} else if (typed === " ") {
				pause = WORD_PAUSE_MS;
			}

			timer = window.setTimeout(
				() => type(index, length + 1),
				KEYSTROKE_MS + pause,
			);
		}

		timer = window.setTimeout(() => type(0, 1), PLACEHOLDER_MS);

		return () => window.clearTimeout(timer);
	}, [messages]);

	return { sentCount, text };
}
