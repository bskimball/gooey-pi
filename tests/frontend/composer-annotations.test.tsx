// @vitest-environment jsdom

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../../src/components/Composer";
import { groupModelsByProvider } from "../../src/hooks/useProviderCatalog";
import {
	appendCapabilityRouting,
	CAPABILITY_ROUTING_BEGIN,
	CAPABILITY_ROUTING_END,
	capabilitiesForMention,
	findCapabilityMentions,
	findMentionQuery,
	splitCapabilityRouting,
} from "../../src/lib/capability-mentions";
import {
	type PiFusionPair,
	publishActivePiBehaviorMode,
	publishActivePiFusionPair,
} from "../../src/lib/harness";
import type {
	BrowserAnnotation,
	PrimeModelDescriptor,
	PrimeProviderDescriptor,
	PromptDeliveryIntent,
	PromptImage,
	SessionRecord,
	SkillRecord,
	TerminalPromptContext,
	TerminalSelectionContext,
} from "../../src/types/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const models: PrimeModelDescriptor[] = [
	{
		key: "provider/vision",
		provider: "provider",
		id: "vision",
		name: "Vision",
		reasoning: true,
		input: ["text", "image"],
		contextWindow: 100_000,
		maxTokens: 8_000,
		availableThinkingLevels: ["medium"],
		fastModeSupported: false,
		available: true,
	},
];
const providers: PrimeProviderDescriptor[] = [
	{
		id: "provider",
		name: "Provider",
		authMethod: "api_key",
		configured: true,
		modelCount: 1,
		availableModelCount: 1,
		enabled: true,
	},
];
const modelsByProvider = groupModelsByProvider(models);

const annotation = (
	id: string,
	overrides: Partial<BrowserAnnotation> = {},
): BrowserAnnotation => ({
	id,
	comment: `Comment ${id}`,
	element: {
		selector: `#${id}`,
		tagName: "button",
		id,
		classes: ["btn"],
		text: "Sign up",
		rect: { x: 1, y: 2, width: 30, height: 20 },
	},
	pageUrl: "https://example.com/",
	pageTitle: "Example Page",
	stale: false,
	createdAt: 1,
	...overrides,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	publishActivePiBehaviorMode("apex");
	publishActivePiFusionPair(null);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

interface RenderOptions {
	composerProps?: Partial<ComponentProps<typeof Composer>>;
	annotations?: BrowserAnnotation[];
	sendSignal?: number;
	onSend?: Mock<
		(
			prompt: string,
			images: PromptImage[],
			intent: PromptDeliveryIntent,
		) => Promise<void>
	>;
	onRemoveAnnotation?: Mock<(id: string) => void>;
	onClearAnnotations?: Mock<() => void>;
	terminalSelection?: TerminalSelectionContext;
	getTerminalContext?: () => TerminalPromptContext | undefined;
	onClearTerminalSelection?: Mock<() => void>;
	sessions?: SessionRecord[];
	skills?: SkillRecord[];
}

function renderComposer({
	annotations = [],
	sendSignal = 0,
	onSend = vi.fn(async () => undefined),
	onRemoveAnnotation = vi.fn(),
	onClearAnnotations = vi.fn(),
	terminalSelection,
	getTerminalContext,
	onClearTerminalSelection = vi.fn(),
	sessions = [],
	skills = [],
	composerProps = {},
}: RenderOptions = {}) {
	act(() =>
		root.render(
			<Composer
				busy={false}
				model="provider/vision"
				effort="medium"
				modelsByProvider={modelsByProvider}
				providers={providers}
				reasoningLevels={["medium"]}
				fast={false}
				fastSupported={false}
				fastAvailable
				imageInputSupported
				messageEnterAction="queue"
				skills={skills}
				sessions={sessions}
				annotations={annotations}
				terminalSelection={terminalSelection}
				getTerminalContext={getTerminalContext}
				sendSignal={sendSignal}
				onModelChange={vi.fn()}
				onEffortChange={vi.fn()}
				onFastChange={vi.fn()}
				onSend={onSend}
				onStop={vi.fn()}
				onRemoveAnnotation={onRemoveAnnotation}
				onClearAnnotations={onClearAnnotations}
				onClearTerminalSelection={onClearTerminalSelection}
				{...composerProps}
			/>,
		),
	);
	return {
		onSend,
		onRemoveAnnotation,
		onClearAnnotations,
		onClearTerminalSelection,
	};
}

const setDraft = async (value: string) => {
	const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			HTMLTextAreaElement.prototype,
			"value",
		)?.set;
		setter?.call(textarea, value);
		textarea.dispatchEvent(new Event("input", { bubbles: true }));
	});
};

const clickSend = async () => {
	await act(async () => {
		(
			container.querySelector(
				'button[aria-label="Send message"]',
			) as HTMLButtonElement
		).click();
		await Promise.resolve();
	});
};

const skillRecord = (
	name: string,
	overrides: Partial<SkillRecord> = {},
): SkillRecord => ({
	id: `id-${name}`,
	name,
	description: `${name} description`,
	kind: "skill",
	location: "user",
	path: `/home/user/.pi/agent/skills/${name}/SKILL.md`,
	enabled: true,
	...overrides,
});
const sessionRecord = (
	title: string,
	id = "019f0000-0000-7000-8000-000000000009",
): SessionRecord => ({
	id,
	harness: "pi",
	filePath: `/sessions/${id}.jsonl`,
	projectPath: "/project",
	title,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	status: "idle",
	depth: 0,
});
const composerTextarea = () =>
	container.querySelector("textarea") as HTMLTextAreaElement;
const optionLabels = () =>
	[...container.querySelectorAll('[role="option"] strong')].map(
		(option) => option.textContent,
	);
/** Dispatches a cancelable keydown and reports whether the composer consumed it. */
const pressKey = async (key: string, init: KeyboardEventInit = {}) => {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		...init,
	});
	await act(async () => {
		composerTextarea().dispatchEvent(event);
	});
	return event.defaultPrevented;
};

describe("Composer skill mentions", () => {
	it("invokes the selected $skill file without requiring catalog-ID verification", async () => {
		const skill = skillRecord("improve-codebase-architecture", {
			id: "9acaa400e83a609a1d6be9bb61dc04da",
		});
		const { onSend } = renderComposer({
			skills: [
				skill,
				skillRecord("disabled-skill", {
					path: "/disabled/SKILL.md",
					enabled: false,
				}),
			],
		});
		await setDraft("Use $improve-codebase-architecture and $disabled-skill");
		await clickSend();

		const [prompt] = onSend.mock.calls[0];
		expect(
			prompt.startsWith(
				"Use $improve-codebase-architecture and $disabled-skill\n\n",
			),
		).toBe(true);
		expect(prompt).not.toContain(skill.id);
		expect(prompt).toContain(
			`- $improve-codebase-architecture: Read the skill file at ${JSON.stringify(skill.path)}`,
		);
		expect(prompt).toContain(
			"No catalog lookup or catalog-ID verification is required",
		);
		expect(prompt).toContain(
			"relative paths from the directory containing that skill file",
		);
		expect(prompt).not.toContain("/disabled/SKILL.md");
	});

	it("offers prompt templates as /commands and sends them verbatim for Pi to expand", async () => {
		const prompt = skillRecord("ship", {
			id: "f564f966285e35df629790ba8b753aab",
			kind: "prompt",
			path: "/home/user/.pi/agent/prompts/ship.md",
		});
		const { onSend } = renderComposer({
			skills: [prompt],
			annotations: [annotation("a1")],
		});
		await setDraft("/sh");
		expect(optionLabels()).toContain("/ship");
		expect(await pressKey("Tab")).toBe(true);
		expect(composerTextarea().value).toBe("/ship ");

		await setDraft("/ship release notes");
		await clickSend();
		// Annotations stay attached instead of becoming template arguments.
		expect(onSend.mock.calls[0][0]).toBe("/ship release notes");

		await setDraft("@sh");
		expect(optionLabels()).not.toContain("@ship");
	});

	it("lists only enabled skills for $ and accepts the arrow-highlighted one with Tab", async () => {
		const { onSend } = renderComposer({
			sessions: [sessionRecord("Unicorn session")],
			skills: [
				skillRecord("unslop"),
				skillRecord("unit test writer"),
				skillRecord("untracked", { enabled: false }),
				skillRecord("unity-bridge", { kind: "extension", path: undefined }),
			],
		});
		const textarea = composerTextarea();
		textarea.focus();
		await setDraft("Use $un");
		expect(
			container.querySelector('[role="listbox"]')?.getAttribute("aria-label"),
		).toBe("Skills");
		expect(optionLabels()).toEqual(["$unslop", "$unit test writer"]);

		expect(await pressKey("ArrowDown")).toBe(true);
		expect(await pressKey("Tab")).toBe(true);
		expect(textarea.value).toBe("Use $unit test writer ");
		expect(textarea.selectionStart).toBe(textarea.value.length);
		expect(document.activeElement).toBe(textarea);
		expect(textarea.getAttribute("aria-expanded")).toBe("false");
		expect(container.querySelector(".composer-menu")).toBeNull();
		expect(onSend).not.toHaveBeenCalled();

		await act(async () => {
			textarea.setRangeText(
				"now",
				textarea.selectionStart,
				textarea.selectionEnd,
				"end",
			);
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(textarea.getAttribute("aria-expanded")).toBe("false");
		await clickSend();
		const [prompt] = onSend.mock.calls[0];
		expect(prompt).toContain(
			`- $unit test writer: Read the skill file at ${JSON.stringify("/home/user/.pi/agent/skills/unit test writer/SKILL.md")}`,
		);
	});

	it("accepts $ completions with Enter or a click without sending, and Escape closes the menu", async () => {
		const { onSend } = renderComposer({ skills: [skillRecord("unslop")] });
		const textarea = composerTextarea();
		await setDraft("$uns");
		expect(await pressKey("Enter")).toBe(true);
		expect(textarea.value).toBe("$unslop ");
		expect(onSend).not.toHaveBeenCalled();

		await setDraft("then $un");
		await act(async () =>
			(container.querySelector('[role="option"]') as HTMLButtonElement).click(),
		);
		expect(textarea.value).toBe("then $unslop ");

		await setDraft("again $un");
		expect(textarea.getAttribute("aria-expanded")).toBe("true");
		await pressKey("Escape");
		expect(container.querySelector(".composer-menu")).toBeNull();
		expect(textarea.value).toBe("again $un");
		expect(onSend).not.toHaveBeenCalled();
	});

	it("keeps an accepted $skill closed until the user edits back into its query", async () => {
		renderComposer({ skills: [skillRecord("unslop")] });
		const textarea = composerTextarea();
		await setDraft("$uns");
		await pressKey("Tab");
		expect(textarea.value).toBe("$unslop ");
		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
			);
			textarea.setRangeText("", "$unslop".length, "$unslop ".length, "end");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(textarea.value).toBe("$unslop");
		expect(textarea.getAttribute("aria-expanded")).toBe("true");
	});

	it("keeps @ for sessions and non-skill capabilities only, with Tab acceptance and stable session ids", async () => {
		const { onSend } = renderComposer({
			sessions: [
				sessionRecord("Browser notes", "019f0000-0000-7000-8000-00000000000a"),
			],
			skills: [
				skillRecord("browser-skill"),
				skillRecord("Browser", {
					id: "prime-work-browser",
					kind: "extension",
					path: undefined,
				}),
			],
		});
		const textarea = composerTextarea();
		await setDraft("Ask @brow");
		expect(
			container.querySelector('[role="listbox"]')?.getAttribute("aria-label"),
		).toBe("Files, sessions, and capabilities");
		expect(optionLabels()).toEqual(["@Browser", "@Browser notes"]);
		expect(await pressKey("ArrowDown")).toBe(true);
		expect(await pressKey("Tab")).toBe(true);
		expect(textarea.value).toBe("Ask @Browser notes ");
		expect(onSend).not.toHaveBeenCalled();

		await setDraft("Ask @Browser notes with @browser-skill");
		await clickSend();
		const [prompt] = onSend.mock.calls[0];
		expect(prompt).toContain(
			"pi session UUID 019f0000-0000-7000-8000-00000000000a",
		);
		expect(prompt).not.toContain("browser-skill/SKILL.md");
	});

	it("puts the exact @capability first when sessions and other capabilities only start with the query", async () => {
		renderComposer({
			sessions: [
				sessionRecord(
					"poteto notes zeta",
					"019f0000-0000-7000-8000-000000000001",
				),
				sessionRecord(
					"poteto notes alpha",
					"019f0000-0000-7000-8000-000000000002",
				),
			],
			skills: [
				skillRecord("poteto-bug-fix", {
					id: "poteto-bug-fix",
					kind: "extension",
					path: undefined,
				}),
				skillRecord("poteto", {
					id: "poteto",
					kind: "extension",
					path: undefined,
				}),
			],
		});
		await setDraft("@poteto");
		expect(optionLabels()).toEqual([
			"@poteto",
			"@poteto-bug-fix",
			"@poteto notes zeta",
			"@poteto notes alpha",
		]);
	});

	it("routes an @session and a same-named $skill independently", async () => {
		const skill = skillRecord("Ownership");
		const { onSend } = renderComposer({
			sessions: [sessionRecord("Ownership")],
			skills: [
				skill,
				skillRecord("Ownership", {
					id: "ownership-mcp",
					kind: "mcp",
					path: undefined,
				}),
			],
		});
		await setDraft("Ask @Ownership to apply $Ownership");
		await clickSend();
		const [prompt] = onSend.mock.calls[0];
		expect(prompt).toContain(
			"pi session UUID 019f0000-0000-7000-8000-000000000009",
		);
		expect(prompt).toContain(
			`- $Ownership: Read the skill file at ${JSON.stringify(skill.path)}`,
		);
		// The session chosen from the @ menu wins over the same-named @ capability.
		expect(prompt).not.toContain('"ownership-mcp"');
	});

	it("completes slash commands with Tab", async () => {
		renderComposer();
		await setDraft("/comp");
		expect(await pressKey("Tab")).toBe(true);
		expect(composerTextarea().value).toBe("/compact ");
	});

	it("lists runtime commands with fuzzy matching and runs local commands without sending them", async () => {
		const onCommand = vi.fn();
		const onEffortChange = vi.fn();
		const { onSend } = renderComposer({
			sessions: [sessionRecord("Release prep")],
			composerProps: {
				onCommand,
				onEffortChange,
				reasoningLevels: ["low", "medium", "high"],
				runtimeCommands: [
					{ name: "graphify", source: "extension" },
					{ name: "skill:unslop", source: "skill" },
				],
			},
		});
		await setDraft("/unsl");
		expect(optionLabels()).toEqual(["/skill:unslop"]);
		await setDraft("/grfy");
		expect(optionLabels()).toEqual(["/graphify"]);

		await setDraft("/name Ship it");
		await clickSend();
		expect(onCommand).toHaveBeenLastCalledWith({ type: "name", title: "Ship it" });
		expect(composerTextarea().value).toBe("");

		await setDraft("/thinking ");
		expect(optionLabels()).toEqual(["low", "medium", "high"]);
		await setDraft("/thinking hi");
		expect(await pressKey("Enter")).toBe(true);
		expect(onEffortChange).toHaveBeenCalledWith("high");

		await setDraft("/resume release");
		await clickSend();
		expect(onCommand).toHaveBeenLastCalledWith({
			type: "resume",
			sessionId: "019f0000-0000-7000-8000-000000000009",
		});
		expect(onSend).not.toHaveBeenCalled();
	});

	it("completes @ file paths from the project like the TUI and keeps them out of capability routing", async () => {
		const listFiles = vi.fn(async () => ({
			entries: [
				{ path: "src", type: "directory" as const },
				{ path: "src/browser.ts", type: "file" as const },
				{ path: "docs", type: "directory" as const },
				{ path: "docs/my notes.md", type: "file" as const },
				{ path: "browser.md", type: "file" as const },
			],
			skipped: 0,
		}));
		const previous = window.prime;
		window.prime = { projects: { listFiles } } as unknown as typeof window.prime;
		try {
			const { onSend } = renderComposer({
				composerProps: { fileRoot: "/project-files-test" },
				skills: [
					skillRecord("browser", {
						id: "prime-work-browser",
						kind: "extension",
						path: undefined,
					}),
				],
			});
			const textarea = composerTextarea();
			await setDraft("Read @sr");
			await act(async () => undefined);
			expect(listFiles).toHaveBeenCalledWith("/project-files-test", "pi");
			expect(optionLabels()[0]).toBe("src/");
			expect(await pressKey("Enter")).toBe(true);
			expect(textarea.value).toBe("Read @src/");
			expect(optionLabels()).toContain("browser.ts");

			await setDraft("Read @my");
			await pressKey("Enter");
			expect(textarea.value).toBe('Read @"docs/my notes.md" ');
			expect(textarea.getAttribute("aria-expanded")).toBe("false");

			await setDraft("Compare @browser.md with @browser.");
			await clickSend();
			const [prompt] = onSend.mock.calls[0];
			expect(prompt.match(/- @browser:/g)).toHaveLength(1);
		} finally {
			window.prime = previous;
		}
	});

	it("leaves Tab alone without a completion, with modifiers, during IME composition, and in the Add context menu", async () => {
		renderComposer({ skills: [skillRecord("unslop")] });
		const textarea = composerTextarea();
		await setDraft("plain text");
		expect(await pressKey("Tab")).toBe(false);
		await setDraft("$zzz");
		expect(textarea.getAttribute("aria-expanded")).toBe("false");
		expect(await pressKey("Tab")).toBe(false);

		await setDraft("$uns");
		for (const modifier of [
			"shiftKey",
			"ctrlKey",
			"altKey",
			"metaKey",
		] as const) {
			expect(await pressKey("Tab", { [modifier]: true })).toBe(false);
		}
		expect(await pressKey("Tab", { isComposing: true })).toBe(false);
		expect(textarea.value).toBe("$uns");

		await setDraft("");
		act(() =>
			(
				container.querySelector(
					'button[aria-label="Add context"]',
				) as HTMLButtonElement
			).click(),
		);
		expect(
			container.querySelector('[role="listbox"]')?.getAttribute("aria-label"),
		).toBe("Add context");
		expect(await pressKey("Tab")).toBe(false);
		expect(textarea.value).toBe("");
	});
});

describe("capability mention parsing", () => {
	const skills = [
		skillRecord("unslop"),
		skillRecord("HOMEWORK"),
		skillRecord("Browser", {
			id: "prime-work-browser",
			kind: "extension",
			path: undefined,
		}),
	];

	it("finds the open trigger at the end of the draft, preferring the later one", () => {
		expect(findMentionQuery("Use $unit te")).toEqual({
			trigger: "$",
			start: 4,
			query: "unit te",
		});
		expect(findMentionQuery("@Fix $5")).toEqual({
			trigger: "$",
			start: 5,
			query: "5",
		});
		expect(findMentionQuery("$unslop then @Brow")).toEqual({
			trigger: "@",
			start: 13,
			query: "Brow",
		});
		expect(findMentionQuery("mail me@example")).toBeNull();
		expect(findMentionQuery("cost$5")).toBeNull();
	});

	it("routes only recognized triggers with word boundaries", () => {
		const texts = (value: string) =>
			findCapabilityMentions(value, skills).map((mention) => mention.text);
		expect(texts("Use $unslop, then @Browser.")).toEqual([
			"$unslop",
			"@Browser",
		]);
		expect(texts("mail me@unslop.com or me$unslop, @unslop, $Browser")).toEqual(
			[],
		);
		expect(texts("echo $HOME and pay $5 for $unslopped")).toEqual([]);
		expect(appendCapabilityRouting("echo $HOME costs $5", skills)).toBe(
			"echo $HOME costs $5",
		);
	});

	it("keeps same-named skills and capabilities under their own triggers", () => {
		const shared = [
			skillRecord("Browser"),
			skillRecord("Browser", {
				id: "prime-work-browser",
				kind: "extension",
				path: undefined,
			}),
		];
		expect(
			findCapabilityMentions("$Browser and @Browser", shared).map(
				(mention) => mention.skill.kind,
			),
		).toEqual(["skill", "extension"]);
		expect(
			capabilitiesForMention(shared, {
				trigger: "$",
				start: 0,
				query: "bro",
			}).map((skill) => skill.kind),
		).toEqual(["skill"]);
		expect(
			capabilitiesForMention(shared, {
				trigger: "@",
				start: 0,
				query: "bro",
			}).map((skill) => skill.kind),
		).toEqual(["extension"]);
	});

	it("still reads routing blocks persisted with the previous @-only header", () => {
		const legacy = `Use @unslop\n\n${CAPABILITY_ROUTING_BEGIN}\nThe user explicitly invoked the following @ capabilities. Follow this routing for the request:\n- @unslop: Read the skill file at "/x/SKILL.md"\n${CAPABILITY_ROUTING_END}`;
		expect(splitCapabilityRouting(legacy).text).toBe("Use @unslop");
		expect(
			splitCapabilityRouting(appendCapabilityRouting("Use $unslop", skills))
				.text,
		).toBe("Use $unslop");
	});
});

describe("Composer session mentions", () => {
	it("closes an accepted mention and only reopens it after editing back into the query", async () => {
		const sessions: SessionRecord[] = [
			{
				id: "019f0000-0000-7000-8000-000000000001",
				harness: "pi",
				filePath: "/sessions/browser.jsonl",
				projectPath: "/project",
				title: "Browser",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				status: "idle",
				depth: 0,
			},
		];
		renderComposer({ sessions });
		await setDraft("@brow");
		const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
		expect(textarea.getAttribute("aria-expanded")).toBe("true");

		await act(async () =>
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			),
		);
		expect(textarea.value).toBe("@Browser ");
		expect(textarea.getAttribute("aria-expanded")).toBe("false");
		expect(container.querySelector(".composer-menu")).toBeNull();

		await act(async () => {
			textarea.setRangeText(
				"keep typing",
				textarea.selectionStart,
				textarea.selectionEnd,
				"end",
			);
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(textarea.getAttribute("aria-expanded")).toBe("false");

		await setDraft("@brow");
		await act(async () =>
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			),
		);
		await act(async () => {
			textarea.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
			);
			textarea.setRangeText("", "@Browser".length, "@Browser ".length, "end");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(textarea.value).toBe("@Browser");
		expect(textarea.getAttribute("aria-expanded")).toBe("true");
	});

	it("suggests sidebar sessions by title and sends a stable UUID routing block", async () => {
		const sessions: SessionRecord[] = [
			{
				id: "019f0000-0000-7000-8000-000000000002",
				harness: "pi",
				filePath: "/sessions/api.jsonl",
				projectPath: "/project",
				title: "API owner",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				status: "running",
				depth: 0,
			},
		];
		const { onSend } = renderComposer({ sessions });
		await setDraft("Coordinate with @API");
		const option = [...container.querySelectorAll('[role="option"]')].find(
			(item) => item.textContent?.includes("@API owner"),
		) as HTMLButtonElement;
		expect(option).toBeDefined();
		await act(async () => option.click());
		const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
		expect(textarea.value).toBe("Coordinate with @API owner ");
		expect(textarea.selectionStart).toBe(textarea.value.length);
		expect(textarea.selectionEnd).toBe(textarea.value.length);
		await act(async () => {
			textarea.setRangeText(
				"continue",
				textarea.selectionStart,
				textarea.selectionEnd,
				"end",
			);
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(textarea.value).toBe("Coordinate with @API owner continue");
		await clickSend();

		const [prompt] = onSend.mock.calls[0];
		expect(prompt.startsWith("Coordinate with @API owner continue\n\n")).toBe(
			true,
		);
		expect(prompt).toContain(
			"pi session UUID 019f0000-0000-7000-8000-000000000002",
		);
		expect(prompt).toContain(
			"Use gooeypi_session_read, gooeypi_session_send, and gooeypi_session_wait",
		);
	});
});

describe("Composer annotation attachment", () => {
	it("auto-attaches a chip showing the annotation count while any exist", () => {
		renderComposer({ annotations: [annotation("a"), annotation("b")] });
		const chip = container.querySelector(".composer-attachment--annotations");
		expect(chip?.textContent).toContain("2");
		expect(chip?.getAttribute("title")).toBe("2 page annotations");
		expect(
			chip
				?.querySelector(".composer-attachment__expand")
				?.getAttribute("aria-label"),
		).toContain("2 page annotations");
		expect(container.querySelector(".composer-annotations")).toBeNull();
	});

	it("expands to inspect each annotation as plain text and deletes individually", async () => {
		const hostile = annotation("a", {
			comment: "<img src=x onerror=alert(1)> fix this",
		});
		const { onRemoveAnnotation } = renderComposer({
			annotations: [hostile, annotation("b", { stale: true })],
		});

		await act(async () => {
			(
				container.querySelector(
					".composer-attachment__expand",
				) as HTMLButtonElement
			).click();
		});
		const panel = container.querySelector(".composer-annotations");
		expect(panel).not.toBeNull();
		// Untrusted text renders as text, never as markup.
		expect(panel?.querySelector("img")).toBeNull();
		expect(panel?.textContent).toContain(
			"<img src=x onerror=alert(1)> fix this",
		);
		// Rows show only the comment (plus staleness); DOM labels are intentionally omitted.
		expect(panel?.textContent).not.toContain("button#a.btn");
		expect(panel?.textContent).toContain("page changed");

		await act(async () => {
			(
				container.querySelector(
					'button[aria-label="Remove annotation 2"]',
				) as HTMLButtonElement
			).click();
		});
		expect(onRemoveAnnotation).toHaveBeenCalledWith("b");
	});

	it("removes the whole attachment through the chip control", async () => {
		const { onClearAnnotations } = renderComposer({
			annotations: [annotation("a")],
		});
		await act(async () => {
			(
				container.querySelector(
					'button[aria-label="Remove page annotations"]',
				) as HTMLButtonElement
			).click();
		});
		expect(onClearAnnotations).toHaveBeenCalledTimes(1);
	});

	it("appends the serialized annotation block to the sent prompt and clears afterwards", async () => {
		const { onSend, onClearAnnotations } = renderComposer({
			annotations: [annotation("a")],
		});
		await setDraft("Please fix the signup flow");
		await clickSend();

		expect(onSend).toHaveBeenCalledTimes(1);
		const [prompt, images, intent] = onSend.mock.calls[0];
		expect(intent).toBe("queue");
		expect(images).toEqual([]);
		expect(
			prompt.startsWith(
				"Please fix the signup flow\n\n===== BEGIN BROWSER ANNOTATIONS =====",
			),
		).toBe(true);
		expect(prompt).toContain("Comment: Comment a");
		expect(prompt).toContain("Selector: #a");
		expect(prompt).toContain("Page URL: https://example.com/");
		expect(prompt.endsWith("===== END BROWSER ANNOTATIONS =====")).toBe(true);
		expect(onClearAnnotations).toHaveBeenCalledTimes(1);
	});

	it("allows sending with annotations alone using a placeholder prompt", async () => {
		const { onSend } = renderComposer({ annotations: [annotation("a")] });
		const send = container.querySelector(
			'button[aria-label="Send message"]',
		) as HTMLButtonElement;
		expect(send.disabled).toBe(false);
		await clickSend();
		const [prompt] = onSend.mock.calls[0];
		expect(
			prompt.startsWith(
				"[Page annotations]\n\n===== BEGIN BROWSER ANNOTATIONS =====",
			),
		).toBe(true);
	});

	it("keeps the annotations attached when the send fails", async () => {
		const onSend = vi.fn(async () => {
			throw new Error("rejected");
		});
		const { onClearAnnotations } = renderComposer({
			annotations: [annotation("a")],
			onSend,
		});
		await setDraft("Keep these");
		await clickSend();

		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onClearAnnotations).not.toHaveBeenCalled();
		expect(
			container.querySelector(".composer-attachment--annotations"),
		).not.toBeNull();
	});

	it("disables send and hides the chip without annotations", () => {
		renderComposer();
		expect(
			container.querySelector(".composer-attachment--annotations"),
		).toBeNull();
		expect(
			container.querySelector<HTMLButtonElement>(
				'button[aria-label="Send message"]',
			)?.disabled,
		).toBe(true);
	});
});

describe("Composer terminal context attachment", () => {
	const selection: TerminalSelectionContext = {
		tabId: "terminal-2",
		label: "zsh 2",
		text: "npm test\n1 failed",
		truncated: false,
	};
	const terminalContext: TerminalPromptContext = {
		...selection,
		cwd: "/workspace",
	};

	it("does not show an attachment or enable send without selected terminal text", () => {
		renderComposer({ terminalSelection: { ...selection, text: "" } });
		expect(
			container.querySelector(".composer-attachment--terminal"),
		).toBeNull();
		expect(
			container.querySelector<HTMLButtonElement>(
				'button[aria-label="Send message"]',
			)?.disabled,
		).toBe(true);
	});

	it("expands and clears highlighted terminal text through its live attachment", async () => {
		const { onClearTerminalSelection } = renderComposer({
			terminalSelection: selection,
		});
		expect(
			container.querySelector<HTMLButtonElement>(
				'button[aria-label="Send message"]',
			)?.disabled,
		).toBe(false);
		await act(async () => {
			(
				container.querySelector(
					'button[aria-label="Inspect selected text from zsh 2"]',
				) as HTMLButtonElement
			).click();
		});
		expect(
			container.querySelector(".composer-terminal-selection")?.textContent,
		).toContain("npm test");
		await act(async () => {
			(
				container.querySelector(
					'button[aria-label="Clear terminal selection"]',
				) as HTMLButtonElement
			).click();
		});
		expect(onClearTerminalSelection).toHaveBeenCalledTimes(1);
		await act(async () => {
			renderComposer({
				terminalSelection: { ...selection, text: "" },
				onClearTerminalSelection,
			});
		});
		expect(container.querySelector(".composer-terminal-selection")).toBeNull();
		expect(
			container.querySelector('button[aria-label="Clear terminal selection"]'),
		).toBeNull();
	});

	it("reads and appends only the current terminal selection when submitting", async () => {
		const getTerminalContext = vi.fn(() => terminalContext);
		const { onSend } = renderComposer({
			terminalSelection: selection,
			getTerminalContext,
		});
		expect(getTerminalContext).not.toHaveBeenCalled();
		await setDraft("Explain the failure");
		await clickSend();
		expect(getTerminalContext).toHaveBeenCalledTimes(1);
		expect(onSend.mock.calls[0][0]).toContain(
			"Explain the failure\n\n===== BEGIN TERMINAL SELECTION CONTEXT =====",
		);
		expect(onSend.mock.calls[0][0]).toContain(
			"--- Selected text ---\nnpm test\n1 failed",
		);
		expect(onSend.mock.calls[0][0]).not.toContain("Terminal buffer");
	});
});

describe("Composer sendSignal", () => {
	it("submits the attached annotations immediately when the signal bumps", async () => {
		const onSend = vi.fn<
			(
				prompt: string,
				images: PromptImage[],
				intent: PromptDeliveryIntent,
			) => Promise<void>
		>(async () => undefined);
		const onClearAnnotations = vi.fn();
		const options = {
			annotations: [annotation("a", { comment: "ship it" })],
			onSend,
			onClearAnnotations,
		};
		renderComposer({ ...options, sendSignal: 0 });
		expect(onSend).not.toHaveBeenCalled();

		await act(async () => {
			renderComposer({ ...options, sendSignal: 1 });
		});
		expect(onSend).toHaveBeenCalledTimes(1);
		const [prompt] = onSend.mock.calls[0];
		expect(prompt).toContain("[Page annotations]");
		expect(prompt).toContain("ship it");
		expect(onClearAnnotations).toHaveBeenCalledTimes(1);
	});

	it("ignores an unchanged signal on re-render", async () => {
		const onSend = vi.fn<
			(
				prompt: string,
				images: PromptImage[],
				intent: PromptDeliveryIntent,
			) => Promise<void>
		>(async () => undefined);
		const options = { annotations: [annotation("a")], onSend, sendSignal: 2 };
		renderComposer(options);
		await act(async () => {
			renderComposer(options);
		});
		expect(onSend).not.toHaveBeenCalled();
	});

	it("orders ordinary dropdowns before other controls and retains non-Pi callbacks", async () => {
		const onModelChange = vi.fn();
		const onEffortChange = vi.fn();
		const onFastChange = vi.fn();
		const composerProps = {
			harness: "pi",
			onModelChange,
			onEffortChange,
			onFastChange,
			fastSupported: true,
			reasoningLevels: ["low", "medium"],
		} satisfies Partial<ComponentProps<typeof Composer>>;
		renderComposer({ composerProps });
		const labels = () =>
			[...container.querySelectorAll(".composer__controls button")].map(
				(button) =>
					button.getAttribute("aria-label") ?? button.textContent?.trim(),
			);
		expect(labels()).toEqual([
			"Add context",
			"Behavior mode",
			"Model: Vision",
			"Reasoning effort",
			"Checkout: Checkout",
			"Fast",
		]);
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('[aria-label="Model: Vision"]')!
				.click();
		});
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('.model-picker [role="option"]')!
				.click();
		});
		expect(onModelChange).toHaveBeenCalledWith("provider/vision");
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>(
					'[aria-label="Reasoning effort"][role="combobox"]',
				)!
				.click();
		});
		await act(async () => {
			container
				.querySelector<HTMLButtonElement>('.select-control [role="option"]')!
				.click();
		});
		expect(onEffortChange).toHaveBeenCalledWith("low");
		await act(async () => {
			container.querySelector<HTMLButtonElement>(".fast-mode-toggle")!.click();
		});
		expect(onFastChange).toHaveBeenCalledWith(true);
	});

	it("edits both Fusion roles through queued commands and waits for reported values", async () => {
		const lead = {
			...models[0],
			key: "provider/Lead/Model",
			id: "Lead/Model",
			name: "Lead Model",
			availableThinkingLevels: ["high", "xhigh"],
		} satisfies PrimeModelDescriptor;
		const sidekick = {
			...models[0],
			key: "provider/Side/Model",
			id: "Side/Model",
			name: "Side Model",
			availableThinkingLevels: ["off", "low"],
		} satisfies PrimeModelDescriptor;
		const pair: PiFusionPair = {
			lead: { provider: "provider", modelId: lead.id, thinking: "high" },
			sidekick: { provider: "provider", modelId: sidekick.id, thinking: "off" },
		};
		publishActivePiBehaviorMode("fusion");
		publishActivePiFusionPair(pair);
		const onSend = vi.fn<
			(
				prompt: string,
				images: PromptImage[],
				intent: PromptDeliveryIntent,
			) => Promise<void>
		>(async () => undefined);
		const onModelChange = vi.fn();
		const onEffortChange = vi.fn();
		const composerProps = {
			harness: "pi" as const,
			modelsByProvider: groupModelsByProvider([lead, sidekick]),
			onModelChange,
			onEffortChange,
			fastSupported: true,
		};
		renderComposer({ onSend, composerProps });
		const trigger = (label: string) =>
			container.querySelector<HTMLButtonElement>(
				`button[aria-label="${label}"]`,
			)!;
		const choose = async (label: string, text: string) => {
			await act(async () => {
				trigger(label).click();
			});
			const option = [
				...container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
			].find((item) => item.querySelector("strong")?.textContent === text)!;
			await act(async () => {
				option.click();
			});
		};
		expect(
			[...container.querySelectorAll(".composer__controls button")].map(
				(button) =>
					button.getAttribute("aria-label") ?? button.textContent?.trim(),
			),
		).toEqual([
			"Add context",
			"Behavior mode",
			"Lead model: Lead Model",
			"Lead thinking",
			"Sidekick model: Side Model",
			"Sidekick thinking",
			"Checkout: Checkout",
			"Fast",
		]);
		expect(
			container.querySelector('[aria-label="Reasoning effort"]'),
		).toBeNull();
		await act(async () => {
			trigger("Sidekick thinking").click();
		});
		expect(
			[...container.querySelectorAll('[role="option"] strong')].map(
				(option) => option.textContent,
			),
		).toEqual(["Sidekick: Off", "Sidekick: Low"]);
		await act(async () => {
			container
				.querySelectorAll<HTMLButtonElement>('[role="option"]')[1]
				.click();
		});
		expect(onSend).toHaveBeenLastCalledWith(
			"/mode fusion-set sidekick thinking low",
			[],
			"queue",
		);
		expect(trigger("Sidekick thinking").textContent).toBe("Sidekick: Off");
		act(() => {
			publishActivePiFusionPair({
				...pair,
				sidekick: { ...pair.sidekick, thinking: "low" },
			});
		});
		expect(trigger("Sidekick thinking").textContent).toBe("Sidekick: Low");
		expect(trigger("Lead thinking").textContent).toBe("Lead: High");
		await choose("Lead thinking", "Lead: Extra high");
		expect(onSend).toHaveBeenLastCalledWith(
			"/mode fusion-set lead thinking xhigh",
			[],
			"queue",
		);
		expect(trigger("Lead thinking").textContent).toBe("Lead: High");

		let resolve!: () => void;
		onSend.mockImplementationOnce(
			() =>
				new Promise<void>((done) => {
					resolve = done;
				}),
		);
		await choose("Sidekick model: Side Model", "Lead Model");
		expect(onSend).toHaveBeenLastCalledWith(
			"/mode fusion-set sidekick model provider/Lead/Model",
			[],
			"queue",
		);
		expect(trigger("Sidekick model: Side Model").disabled).toBe(true);
		expect(trigger("Lead thinking").disabled).toBe(true);
		await act(async () => {
			resolve();
		});
		expect(trigger("Sidekick model: Side Model").disabled).toBe(false);
		act(() => {
			publishActivePiFusionPair({
				...pair,
				sidekick: { ...pair.lead, thinking: "xhigh" },
			});
		});
		expect(trigger("Sidekick model: Lead Model")).not.toBeNull();
		expect(trigger("Sidekick thinking").textContent).toBe(
			"Sidekick: Extra high",
		);
		await act(async () => {
			trigger("Sidekick thinking").click();
		});
		expect(
			[...container.querySelectorAll('[role="option"] strong')].map(
				(option) => option.textContent,
			),
		).toEqual(["Sidekick: High", "Sidekick: Extra high"]);
		await act(async () => {
			trigger("Sidekick thinking").click();
		});
		onSend.mockRejectedValueOnce(new Error("runtime rejected model"));
		await choose("Lead model: Lead Model", "Side Model");
		expect(onSend).toHaveBeenLastCalledWith(
			"/mode fusion-set lead model provider/Side/Model",
			[],
			"queue",
		);
		expect(trigger("Lead model: Lead Model").disabled).toBe(false);
		expect(onModelChange).not.toHaveBeenCalled();
		expect(onEffortChange).not.toHaveBeenCalled();

		renderComposer({ onSend, composerProps: { ...composerProps, busy: true } });
		expect(trigger("Lead model: Lead Model").disabled).toBe(true);
		expect(trigger("Sidekick thinking").disabled).toBe(true);
		renderComposer({ onSend, composerProps });
		act(() => {
			publishActivePiFusionPair({
				...pair,
				lead: { ...pair.lead, modelId: "Missing/Model" },
			});
		});
		expect(
			trigger("Lead model: provider/Missing/Model (unavailable)"),
		).not.toBeNull();
		expect(trigger("Lead thinking").disabled).toBe(true);
		expect(trigger("Sidekick thinking").disabled).toBe(false);
		act(() => {
			publishActivePiFusionPair(null);
		});
		expect(trigger("Lead model: Not reported").disabled).toBe(true);
		expect(trigger("Sidekick thinking").disabled).toBe(true);
		expect(trigger("Behavior mode").disabled).toBe(false);
		expect(container.querySelector('[aria-label="Model: Vision"]')).toBeNull();
		act(() => {
			publishActivePiBehaviorMode("apex");
		});
		expect(trigger("Model: No model available")).not.toBeNull();
		expect(container.querySelector('[aria-label="Lead thinking"]')).toBeNull();
	});

	it("opens the custom SelectControl popover from the chevron, supports keyboard navigation, and dispatches Pi mode changes", async () => {
		const onSend = vi.fn<
			(
				prompt: string,
				images: PromptImage[],
				intent: PromptDeliveryIntent,
			) => Promise<void>
		>(async () => undefined);
		const onEffortChange = vi.fn();
		act(() =>
			root.render(
				<Composer
					busy={false}
					harness="pi"
					model="provider/vision"
					effort="medium"
					modelsByProvider={modelsByProvider}
					providers={providers}
					reasoningLevels={["low", "medium", "high"]}
					fast={false}
					fastSupported={false}
					fastAvailable
					imageInputSupported
					messageEnterAction="queue"
					skills={[]}
					onModelChange={vi.fn()}
					onEffortChange={onEffortChange}
					onFastChange={vi.fn()}
					onSend={onSend}
					onStop={vi.fn()}
				/>,
			),
		);

		const modeControl = [
			...container.querySelectorAll<HTMLElement>(".select-control"),
		].find((el) => el.getAttribute("title") === "Behavior mode")!;
		const modeTrigger =
			modeControl.querySelector<HTMLButtonElement>('[role="combobox"]')!;
		const modeChevron = modeControl.querySelector<HTMLElement>(
			".select-control__chevron",
		)!;

		await act(async () => {
			const mousedown = new MouseEvent("mousedown", {
				bubbles: true,
				cancelable: true,
			});
			modeChevron.dispatchEvent(mousedown);
			modeChevron.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(modeControl.querySelector('[role="listbox"]')).not.toBeNull();
		expect(document.activeElement).toBe(modeTrigger);

		await act(async () => {
			const mousedown = new MouseEvent("mousedown", {
				bubbles: true,
				cancelable: true,
			});
			const prevented = !modeChevron.dispatchEvent(mousedown);
			if (!prevented) modeTrigger.blur();
			modeChevron.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(modeControl.querySelector('[role="listbox"]')).toBeNull();

		await act(async () => {
			modeChevron.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		expect(modeControl.querySelector('[role="listbox"]')).not.toBeNull();

		await act(async () => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		expect(modeControl.querySelector('[role="listbox"]')).toBeNull();
		expect(document.activeElement).toBe(modeTrigger);

		await setDraft("Unsent draft");

		await act(async () => {
			modeTrigger.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(modeControl.querySelector('[role="listbox"]')).not.toBeNull();
		expect(onSend).not.toHaveBeenCalled();

		await act(async () => {
			modeTrigger.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(modeControl.querySelector('[role="listbox"]')).toBeNull();
		expect(onSend).not.toHaveBeenCalled();

		const scrollSpy = vi.fn();
		Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollSpy,
		});
		const rectSpy = vi
			.spyOn(modeControl, "getBoundingClientRect")
			.mockReturnValue({
				x: 420,
				y: 505,
				top: 505,
				bottom: 531,
				left: 420,
				right: 448,
				width: 28,
				height: 26,
				toJSON: () => ({}),
			});

		try {
			await act(async () => {
				modeTrigger.dispatchEvent(
					new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
				);
			});
			const menu = modeControl.querySelector<HTMLElement>('[role="listbox"]')!;
			expect(menu.style.getPropertyValue("--select-menu-width")).toBe("320px");
			expect(menu.style.getPropertyValue("--select-menu-max-height")).toBe(
				"482px",
			);
			rectSpy.mockReturnValue({
				x: 420,
				y: 123,
				top: 123,
				bottom: 149,
				left: 420,
				right: 448,
				width: 28,
				height: 26,
				toJSON: () => ({}),
			});
			await act(async () => {
				window.dispatchEvent(new Event("resize"));
			});
			expect(menu.style.getPropertyValue("--select-menu-max-height")).toBe(
				"100px",
			);
			const options = [
				...modeControl.querySelectorAll<HTMLButtonElement>('[role="option"]'),
			];
			expect(document.activeElement).toBe(options[0]);
			expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest" });

			await act(async () => {
				options[0].dispatchEvent(
					new KeyboardEvent("keydown", { key: "End", bubbles: true }),
				);
			});
			expect(document.activeElement).toBe(options.at(-1));
			expect(options.at(-1)?.textContent).toContain("Configure Fusion…");

			await act(async () => {
				options.at(-1)!.dispatchEvent(
					new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
				);
			});
			expect(document.activeElement).toBe(options[0]);

			const fusionIndex = options.findIndex(
				(opt) =>
					opt.textContent?.includes("Fusion") &&
					!opt.textContent?.includes("Configure"),
			);
			for (let step = 0; step < fusionIndex; step += 1) {
				await act(async () => {
					(document.activeElement as HTMLElement).dispatchEvent(
						new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
					);
				});
			}
			expect(document.activeElement).toBe(options[fusionIndex]);

			await act(async () => {
				options[fusionIndex].dispatchEvent(
					new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
				);
			});
			expect(modeControl.querySelector('[role="listbox"]')).toBeNull();
			expect(document.activeElement).toBe(modeTrigger);
			expect(onSend).toHaveBeenCalledTimes(1);
			expect(onSend).toHaveBeenCalledWith("/mode fusion", [], "queue");
		} finally {
			rectSpy.mockRestore();
		}
	});
});

describe("Composer extension tab pill", () => {
	it("shows the paired browser tab and routes pause and focus through the extension controls", () => {
		const tab = {
			tabId: "ext-1",
			sessionFile: "/sessions/active.jsonl",
			url: "https://docs.example.com/guide",
			title: "Guide",
			attached: false,
			active: true,
			canGoBack: false,
			canGoForward: false,
			backend: "extension" as const,
			paused: false,
		};
		const extension = {
			status: null,
			setPaused: vi.fn(),
			popOut: vi.fn(),
			focus: vi.fn(),
		};
		renderComposer({
			composerProps: { extensionTab: tab, browserExtension: extension },
		});

		const pill = container.querySelector(
			'[data-testid="composer-extension-tab-pill"]',
		);
		expect(pill?.textContent).toContain("Guide");
		expect(pill?.textContent).toContain("docs.example.com");
		expect(pill?.textContent).toContain("Active");
		act(() =>
			(
				container.querySelector(
					'[aria-label="Pause agent in Guide"]',
				) as HTMLButtonElement
			).click(),
		);
		expect(extension.setPaused).toHaveBeenCalledWith(tab, true);
		act(() =>
			(
				container.querySelector(
					'[aria-label="Focus Guide in browser"]',
				) as HTMLButtonElement
			).click(),
		);
		expect(extension.focus).toHaveBeenCalledWith(tab);

		renderComposer({
			composerProps: {
				extensionTab: { ...tab, paused: true },
				browserExtension: extension,
			},
		});
		expect(
			container.querySelector('[data-testid="composer-extension-tab-pill"]')
				?.textContent,
		).toContain("Paused");
		act(() =>
			(
				container.querySelector(
					'[aria-label="Resume agent in Guide"]',
				) as HTMLButtonElement
			).click(),
		);
		expect(extension.setPaused).toHaveBeenLastCalledWith(
			{ ...tab, paused: true },
			false,
		);
	});

	it("renders no pill without an extension-backed tab", () => {
		renderComposer();
		expect(
			container.querySelector('[data-testid="composer-extension-tab-pill"]'),
		).toBeNull();
	});
});
