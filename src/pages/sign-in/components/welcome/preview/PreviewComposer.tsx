import type { ReactElement } from "react";
import { PreviewPost } from "./PreviewPost";
import { useComposerDemo } from "./useComposerDemo";

const COMPOSER_MESSAGES = [
	"GG EZ. (It was not EZ. I died 47 times.)",
	"Friends can see my hours now. Please don't judge.",
	"Backlog: 300 games. Playing: the same PS2 one.",
	"Your hours are public now. No more lying, Dave.",
	"Bought 12 games in the sale. Played the old one.",
	"6 minutes and you call that a session? lol",
	"Battery 3%. Final boss 3%. Pray for me.",
	"Played in bed. Dropped the Deck on my face. GG.",
	"Shader cache took longer than my whole session.",
	"Came back after 6 months. Forgot every button.",
	"Read the entire wiki. Still lost to the boss.",
	"Speedran the tutorial. Died in the first room.",
	"Grinded 4 hours for a hat. Zero regrets.",
	'"Just one more run." It is now 4 AM.',
	"Played for the story. Skipped every cutscene.",
	"100% complete. What do I do with my life now?",
	"Stealth mission. Got spotted. It's a combat mission now.",
	"Dodged the boss's attack. Rolled straight off a cliff.",
	"Still on disc 2 of Final Fantasy VII. No spoilers.",
	"Finished the PSP game I gave up on in 2007.",
	"Loading screen tips taught me more than school.",
	"3 hours configuring. 4 minutes playing.",
	'Steam says I played "Non-Steam Shortcut" for 90 hours.',
	"Finally tracking my PS2 hours. The number is not okay.",
	"Rewound 400 times. Technically never made a mistake.",
	"Beat it with save states. Basically a speedrunner now.",
	"Save-scummed every fight. Please call me a strategist.",
	"Fast-forwarded the grind. Respect my 4x-speed journey.",
	"200 games in the library. Played Katamari again.",
	"Scraped box art for 6 hours. Played zero games.",
	"Upscaled a PS1 game to 4K. Still 12 polygons.",
	"Turned on CRT shaders. Now I miss my childhood. Thanks.",
	"Swapping discs like it's 1999. Disc 3 of 4.",
	"My 1998 save file outlived three of my relationships.",
	"Spent the whole sale playing a 2001 PS2 game. Sorry, Gabe.",
	"Rewind button is cheaper than therapy.",
	"The game says press Triangle. My Deck has no triangles.",
	"Infinite memory cards. Still deleted my brother's save.",
	"Tried every renderer. Kept the glitch. It's lore now.",
	"Psycho Mantis wants port 2. Sir, this is a Steam Deck.",
	"Save-stated 1 frame before death. I live there now.",
	"Maxed every Persona social link. Ignored 40 real texts.",
	"Save-stated mid-boss just to post this. Priorities.",
	"Gran Turismo license tests. Harder than my real one.",
	"Patched it to 60 FPS. Everyone runs twice as fast now.",
	"Removed the fog in Silent Hill. Instantly regretted it.",
	"Got an achievement in a 1997 game. Fashionably late.",
	"Learned Japanese for this RPG. Then found the fan patch.",
	"First comment on this PS1 game. Ever. Hello? Anyone?",
	"Dave isn't real. Neither is my PS2. It's all emulated.",
] as const;

export function PreviewComposer(): ReactElement {
	const { sentCount, text } = useComposerDemo(COMPOSER_MESSAGES);

	return (
		<>
			<div className="relative flex min-h-8 items-center rounded-sm bg-white/10 px-2 motion-safe:animate-preview-in motion-safe:[animation-delay:80ms]">
				<span
					className={`font-sans text-[11px] leading-4 text-slate-400 italic transition-opacity duration-300 ${text === "" ? "opacity-100" : "opacity-0"}`}
				>
					Say something about this game to your friends...
				</span>

				{text !== "" && (
					<span className="absolute inset-x-2 top-1/2 -translate-y-1/2 overflow-hidden text-left font-sans text-[11px] leading-4 whitespace-pre text-slate-200 [direction:rtl]">
						<span className="[unicode-bidi:isolate] [direction:ltr]">
							{text}

							<span className="ml-px inline-block h-3 w-px bg-slate-200 align-middle motion-safe:animate-caret-blink" />
						</span>
					</span>
				)}
			</div>

			<div className="motion-safe:animate-preview-in motion-safe:[animation-delay:160ms]">
				<PreviewPost author="You" sentCount={sentCount} />
			</div>
		</>
	);
}
