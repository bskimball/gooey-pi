import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { appendTaskContext, EXCERPT_LIMIT, useTaskWorkflowContext, type TaskExcerpt } from '@/lib/task-context';
import { cleanRequestErrorDetail } from "@/app/workspace";
import type { ExtensionTabControls } from "@/hooks/useAgentBrowserTabs";
import { useComposerImages } from "@/hooks/useComposerImages";
import { useSharedBrowserSelection } from "@/hooks/useSharedBrowserSelection";
import { useDictation } from "@/hooks/useDictation";
import { appendAnnotationsToPrompt, type BrowserReference } from "@/lib/browser-annotations";
import { BrowserSelectionTray } from "./BrowserSelectionTray";
import { useComposerMenu } from "@/hooks/useComposerMenu";
import {
	appendCapabilityRouting,
	capabilityTrigger,
} from "@/lib/capability-mentions";
import {
	type ComposerCommand,
	type ComposerCommandAction,
	isLocalCommand,
	parseCompactCommand,
	parseSlashCommand,
	resolveLocalCommand,
	selectableModels,
} from "@/lib/composer-commands";
import { parsePiModeCommand } from "@/lib/harness";
import { formatFileMention, mentionPathForFile } from "@/lib/file-mentions";
import {
	clearComposerDraft,
	readComposerDraft,
	restoreComposerDraft,
	saveComposerDraft,
	takeComposerDraft,
} from "@/lib/composer-draft";
import { messageActionForKey } from "@/lib/message-shortcuts";
import {
	appendSessionRouting,
	findSessionMentions,
} from "@/lib/session-mentions";
import { appendTerminalContextToPrompt } from "@/lib/terminal-context";
import type {
	AgentBrowserTabRecord,
	BrowserAnnotation,
	CheckoutAction,
	CheckoutCatalog,
	HarnessId,
	MessageEnterAction,
	ApexContextUsage,
	ApexModelDescriptor,
	ApexProviderDescriptor,
	ApexThinkingLevel,
	 ApexApi,
	PromptDeliveryIntent,
	PromptImage,
	QueuedPrompt,
	RuntimeInfo,
	SessionRecord,
	SessionUsage,
	SkillRecord,
	TerminalPromptContext,
	VoiceTranscriptionProvider,
} from "@/types/api";
import { CheckoutPicker } from "./CheckoutPicker";
import { ComposerQueue } from "./ComposerQueue";
import { ContextUsageRing } from "./ContextUsageRing";
import { ExecutingModelChip } from "./ExecutingModelChip";
import { ExtensionTabPill } from "./ExtensionTabControls";
import {
	ArrowUp,
	CaretDown,
	CircleNotch,
	Gauge,
	Image as ImageIcon,
	Lightning,
	Microphone,
	Paperclip,
	Plus,
	Square,
	TerminalWindow,
	X,
} from "./icons";
import { ModelPicker } from "./ModelPicker";
import { PiModeControl } from "./PiModeControl";
import { Banner } from "@astryxdesign/core/Banner";
import { ApexButton, IconButton, SelectControl } from "./ui";

interface ComposerProps {
	busy: boolean;
	admitting?: boolean; // agent-turn isSubmissionAdmitting
	loading?: boolean;
	disabled?: boolean;
	model: string;
	effort: ApexThinkingLevel;
	modelsByProvider: ReadonlyMap<string, ApexModelDescriptor[]>;
	providers: ApexProviderDescriptor[];
	reasoningLevels: ApexThinkingLevel[];
	fast: boolean;
	fastSupported: boolean;
	fastAvailable: boolean;
	/** Agent name for tooltips. */
	agentName?: string;
	/** Agent short name for inline copy. */
	shortName?: string;
	harness?: HarnessId;
	imageInputSupported: boolean;
	contextUsage?: ApexContextUsage | null;
	sessionUsage?: SessionUsage | null;
	executingModel?: RuntimeInfo["executingModel"] | null;
	/** Primary action for Enter; Ctrl/Cmd+Enter selects the opposite action. */
	messageEnterAction?: MessageEnterAction;
	voice?: ApexApi["voice"] | null;
	transcriptionProvider?: VoiceTranscriptionProvider;
	skills: SkillRecord[];
	/** Other sidebar sessions in the active project, available as @title references. */
	sessions?: SessionRecord[];
	/** Sessions `/resume` offers when they differ from the @-referenceable ones; defaults to `sessions`. */
	resumeSessions?: readonly SessionRecord[];
	/** Browser annotations auto-attach as a composer attachment while any exist. */
	annotations?: BrowserAnnotation[];
	/** The active thread's tab driven through the browser extension, with its pause and focus controls. */
	extensionTab?: AgentBrowserTabRecord;
	browserExtension?: ExtensionTabControls;
	focusSignal?: number;
	onRevealBrowserReference?(reference: BrowserReference): void;
	/** The active terminal's selection, updated on selection changes only; the chip shows and submit sends exactly this. */
	terminalSelection?: TerminalPromptContext;
	taskExcerpts?: TaskExcerpt[];
	onRemoveTaskExcerpts?(ids: string[]): void;
	/** Messages waiting for a turn boundary. */
	queuedMessages?: QueuedPrompt[];
	onSendQueuedMessage?(message: QueuedPrompt): void;
	onDeleteQueuedMessage?(message: QueuedPrompt): void;
	onEditQueuedMessage?(message: QueuedPrompt): void;
	/** Each bump submits the current draft immediately (Ctrl/Cmd+Enter from the annotation popover). */
	sendSignal?: number;
	onModelChange(value: string): void;
	onEffortChange(value: ApexThinkingLevel): void;
	onFastChange(value: boolean): void;
	checkoutCatalog?: CheckoutCatalog;
	/** Branch/worktree name shown before or without the linked-worktree catalog. */
	checkoutLabel?: string;
	checkoutsLoading?: boolean;
	onExecuteCheckout?(action: CheckoutAction): Promise<void> | void;
	onSend(
		prompt: string,
		images: PromptImage[],
		intent: PromptDeliveryIntent,
	): Promise<void> | void;
	onStop(): Promise<void> | void;
	onRemoveAnnotation?(id: string): void;
	/** Called after a send that included the annotations, and by the attachment's remove control. */
	onClearAnnotations?(): void;
	onClearTerminalSelection?(): void;
	/** Stable per-workspace key; without it the composer keeps no draft of its own. */
	draftKey?: string;
	/** Working directory searched by `@` file completion and used to relativize dropped files. */
	fileRoot?: string;
	/** Commands the runtime reported via `get_commands`; undefined until known. */
	runtimeCommands?: readonly ComposerCommand[];
	/** Runs app-level slash commands such as `/new` or `/name`. */
	onCommand?(action: ComposerCommandAction): void;
	/** A new `id` appends `text` to the draft without sending it. */
	insertDraft?: { id: number; text: string };
	onDraftInserted?(id: number): void;
}

const reasoningLabels: Record<ApexThinkingLevel, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Standard",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
};

const MAX_IMAGE_PROMPT_BYTES = 2 * 1024 * 1024;

const EMPTY_ANNOTATIONS: BrowserAnnotation[] = [];
const noop = () => undefined;

function resolveDroppedFilePath(file: File): string {
	return typeof window === "undefined"
		? ""
		: (window.apex?.app.pathForFile?.(file) ?? "");
}

export const Composer = memo(function Composer({
	busy,
	admitting = false,
	loading = false,
	disabled,
	model,
	effort,
	modelsByProvider,
	providers,
	reasoningLevels,
	fast,
	fastSupported,
	fastAvailable,
	agentName = "Pi",
	shortName = "Pi",
	harness = "pi",
	imageInputSupported,
	messageEnterAction = "queue",
	voice,
	transcriptionProvider = "openai-live",
	skills,
	sessions = [],
	resumeSessions = sessions,
	annotations = EMPTY_ANNOTATIONS,
	extensionTab,
	browserExtension,
	focusSignal = 0,
	onRevealBrowserReference,
	terminalSelection,
	taskExcerpts,
	onRemoveTaskExcerpts,
	queuedMessages = [],
	onSendQueuedMessage,
	onDeleteQueuedMessage,
	onEditQueuedMessage,
	sendSignal = 0,
	onModelChange,
	onEffortChange,
	onFastChange,
	contextUsage,
	sessionUsage,
	executingModel,
	checkoutCatalog,
	checkoutLabel,
	checkoutsLoading = false,
	onExecuteCheckout,
	onSend,
	onStop,
	onRemoveAnnotation = noop,
	onClearAnnotations = noop,
	onClearTerminalSelection = noop,
	draftKey,
	fileRoot,
	runtimeCommands,
	onCommand,
	insertDraft,
	onDraftInserted,
}: ComposerProps) {
	const taskWorkflow = useTaskWorkflowContext();
	const excerpts = taskExcerpts ?? taskWorkflow?.excerpts ?? [];
	const removeExcerpts = onRemoveTaskExcerpts ?? taskWorkflow?.remove;
	const modelControls = (
		<>
			<ModelPicker
				value={model}
				modelsByProvider={modelsByProvider}
				providers={providers}
				onChange={onModelChange}
			/>
			<SelectControl
				label="Reasoning effort"
				compact
				icon={<Gauge size={12} />}
				value={effort}
				onChange={(event) =>
					onEffortChange(event.target.value as ApexThinkingLevel)
				}
			>
				{reasoningLevels.map((level) => (
					<option key={level} value={level}>
						{reasoningLabels[level]}
					</option>
				))}
			</SelectControl>
		</>
	);
	const [value, setValue] = useState(
		() =>
			(draftKey ? readComposerDraft(draftKey)?.text : undefined) ??
			takeComposerDraft(),
	);
	const [caret, setCaret] = useState(() => value.length);
	const [sessionReferenceIds, setSessionReferenceIds] = useState<
		ReadonlyMap<string, string>
	>(() => new Map());
	const [terminalSelectionOpen, setTerminalSelectionOpen] = useState(false);
	const referenceFilesRef = useRef<(paths: string[]) => void>(noop);
	const [forwardFileReferences] = useState(
		() => (paths: string[]) => referenceFilesRef.current(paths),
	);
	const imageAttachments = useComposerImages({
		shortName,
		resolveFilePath: resolveDroppedFilePath,
		onFileReferences: forwardFileReferences,
	});
	const {
		images,
		imagesRef,
		unsupportedFiles,
		unsupportedFilesRef,
		error: attachmentError,
		setError: setAttachmentError,
		processing: processingImages,
	} = imageAttachments;
	const dictation = useDictation(
		voice,
		transcriptionProvider,
		setAttachmentError,
	);
	const menuId = useId();
	const menuRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const submittingRef = useRef(false); // single-flight guard until the admitting prop re-renders
	const fileInputRef = useRef<HTMLInputElement>(null);
	const imageStatusId = useId();
	const { annotation: sharedSelection, consume: consumeSharedSelection, processing: processingSelection, error: selectionError } = useSharedBrowserSelection(extensionTab, fileRoot);
	useEffect(() => {
		if (focusSignal || sharedSelection) textareaRef.current?.focus();
	}, [focusSignal, sharedSelection?.id, sharedSelection?.element.captureId]);
	const annotationsRef = useRef(annotations);
	annotationsRef.current = sharedSelection ? [...annotations, sharedSelection] : annotations;
	const mountedRef = useRef(true);
	const draftKeyRef = useRef(draftKey);
	const restoredDraftRef = useRef(false);
	const enabledSkills = useMemo(
		() => skills.filter((skill) => skill.enabled),
		[skills],
	);

	const insertedDraftId = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (!insertDraft || insertDraft.id === insertedDraftId.current) return;
		insertedDraftId.current = insertDraft.id;
		const current = textareaRef.current?.value ?? "";
		const next = current ? `${current}\n\n${insertDraft.text}` : insertDraft.text;
		setValue(next);
		setCaret(next.length);
		onDraftInserted?.(insertDraft.id);
		requestAnimationFrame(() => textareaRef.current?.focus());
	}, [insertDraft, onDraftInserted]);

	useEffect(() => {
		if (!draftKey || restoredDraftRef.current) return;
		restoredDraftRef.current = true;
		const draft = readComposerDraft(draftKey);
		if (!draft) return;
		if (draft.model && draft.model !== model) onModelChange(draft.model);
		if (draft.effort && draft.effort !== effort)
			onEffortChange(draft.effort as ApexThinkingLevel);
		if (draft.fast !== undefined && draft.fast !== fast)
			onFastChange(draft.fast);
	}, [
		draftKey,
		effort,
		fast,
		model,
		onEffortChange,
		onFastChange,
		onModelChange,
	]);

	useEffect(() => {
		if (draftKeyRef.current && draftKeyRef.current !== draftKey)
			clearComposerDraft(draftKeyRef.current);
		draftKeyRef.current = draftKey;
		if (draftKey)
			saveComposerDraft(draftKey, { text: value, model, effort, fast });
	}, [draftKey, effort, fast, model, value]);

	useEffect(() => {
		setSessionReferenceIds((current) => {
			if (!current.size) return current;
			const mentionedTitles = new Set(
				findSessionMentions(value, sessions, current).map(({ session }) =>
					session.title.trim().toLocaleLowerCase(),
				),
			);
			const next = new Map(
				[...current].filter(([title]) => mentionedTitles.has(title)),
			);
			return next.size === current.size ? current : next;
		});
	}, [sessions, value]);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);
	useEffect(() => {
		if (!terminalSelection?.text) setTerminalSelectionOpen(false);
	}, [terminalSelection?.text]);

	const replaceRange = (start: number, end: number, text: string) => {
		const textarea = textareaRef.current;
		if (textarea) {
			textarea.setRangeText(text, start, end, "end");
			setValue(textarea.value);
			setCaret(textarea.selectionStart);
			textarea.focus();
			return;
		}
		setValue((current) => `${current.slice(0, start)}${text}${current.slice(end)}`);
		setCaret(start + text.length);
	};
	const insert = (text: string) => {
		const textarea = textareaRef.current;
		const start = textarea?.selectionStart ?? value.length;
		replaceRange(start, textarea?.selectionEnd ?? start, text);
	};
	const setDraft = (text: string) => {
		setValue(text);
		setCaret(text.length);
		requestAnimationFrame(() => textareaRef.current?.focus());
	};
	referenceFilesRef.current = (paths) => {
		const mentions = paths.map((path) =>
			formatFileMention(mentionPathForFile(path, fileRoot)),
		);
		const textarea = textareaRef.current;
		const start = textarea?.selectionStart ?? value.length;
		const before = (textarea?.value ?? value).slice(0, start);
		const separator = before && !/\s$/.test(before) ? " " : "";
		replaceRange(
			start,
			textarea?.selectionEnd ?? start,
			`${separator}${mentions.join(" ")} `,
		);
	};
	const {
		menu,
		setMenu,
		suggestions,
		activeSuggestion,
		setActiveSuggestion,
		mentionsSkills,
		forgetAcceptedMention,
	} = useComposerMenu({
		value,
		caret,
		harness,
		fileRoot,
		sessions,
		resumeSessions,
		enabledSkills,
		skills,
		runtimeCommands,
		modelsByProvider,
		providers,
		reasoningLevels,
		reasoningLabels,
		replaceBeforeCaret: (start, text) =>
			replaceRange(start, Math.min(caret, value.length), text),
		insert,
		setDraft,
		openFilePicker: () => {
			setMenu(null);
			fileInputRef.current?.click();
		},
		rememberSession: (session) =>
			setSessionReferenceIds((current) =>
				new Map(current).set(session.title.trim().toLocaleLowerCase(), session.id),
			),
		onModelChange,
		onEffortChange,
		runCommand: (action) => onCommand?.(action),
	});
	const chooseSuggestion = (index: number) => suggestions[index]?.choose();
	useEffect(() => {
		menuRef.current
			?.querySelector('[aria-selected="true"]')
			?.scrollIntoView?.({ block: "nearest" });
	}, [activeSuggestion, menu]);

	useEffect(() => {
		if (!menu) return;
		const close = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Node) || menuRef.current?.contains(target))
				return;
			if (
				target instanceof Element &&
				target.closest("[data-composer-menu-trigger]")
			)
				return;
			setMenu(null);
		};
		const onEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setMenu(null);
		};
		document.addEventListener("mousedown", close);
		document.addEventListener("keydown", onEscape);
		return () => {
			document.removeEventListener("mousedown", close);
			document.removeEventListener("keydown", onEscape);
		};
	}, [menu]);

	// Ctrl/Cmd+Enter in the annotation popover bumps sendSignal to submit the
	// draft (with the just-saved annotation) without switching focus here.
	const lastSendSignalRef = useRef(sendSignal);
	useEffect(() => {
		if (sendSignal === lastSendSignalRef.current) return;
		lastSendSignalRef.current = sendSignal;
		void submit();
	}, [sendSignal]);

	const submit = async (
		intent: PromptDeliveryIntent = "queue",
		valueOverride?: string,
	) => {
		const currentExcerpts = excerpts;
		const currentImages = imagesRef.current;
		const currentUnsupportedFiles = unsupportedFilesRef.current;
		const currentAnnotations = annotationsRef.current;
		const currentTerminalContext = terminalSelection?.text ? terminalSelection : undefined;
		const hasTerminalSelection = Boolean(currentTerminalContext?.text);
		const draftValue = valueOverride ?? value;
		const prompt =
			draftValue.trim() ||
			(currentImages.length > 0
				? currentImages.length === 1
					? "[Attached image]"
					: "[Attached images]"
				: currentUnsupportedFiles.length > 0
					? currentUnsupportedFiles.length === 1
						? "[Attached file]"
						: "[Attached files]"
					: currentAnnotations.length > 0
						? "[Page annotations]"
						: currentExcerpts.length ? "[Selected context]" : "[Terminal selection]");
		if (
			(!draftValue.trim() &&
				currentImages.length === 0 &&
				currentUnsupportedFiles.length === 0 &&
				currentAnnotations.length === 0 &&
				!hasTerminalSelection && currentExcerpts.length === 0) ||
			loading ||
			disabled ||
			(intent !== "steer" && !busy && (admitting || submittingRef.current))
		)
			return;
		if (currentExcerpts.some((excerpt) => excerpt.text.length > EXCERPT_LIMIT)) {
			setAttachmentError('Select a shorter excerpt. Each context attachment is limited to 32,768 characters.');
			return;
		}
		const slash = parseSlashCommand(draftValue);
		if (slash && isLocalCommand(slash.name)) {
			const outcome = resolveLocalCommand(slash.name, slash.args, {
				models: selectableModels(modelsByProvider, providers),
				reasoningLevels,
				sessions: resumeSessions,
			});
			if (outcome.type === "error") return setAttachmentError(outcome.message);
			if (outcome.type === "complete") return setDraft(outcome.draft);
			if (outcome.type === "model") onModelChange(outcome.key);
			else if (outcome.type === "effort") onEffortChange(outcome.level);
			else if (onCommand) onCommand(outcome.action);
			else return setAttachmentError(`/${slash.name} is not available here.`);
			setAttachmentError("");
			setDraft("");
			return;
		}
		// Commands take their text verbatim: context blocks would become command arguments.
		const commandDraft = /^\s*[/!]/.test(draftValue);
		const bashDraft = /^\s*!/.test(draftValue);
		if (commandDraft && currentExcerpts.length) {
			setAttachmentError('Selected context cannot be sent with a command. Remove it or write a message.');
			return;
		}
		const annotationImages = commandDraft ? [] : currentAnnotations.flatMap((annotation) => annotation.preview ? [annotation.preview] : []);
		if (processingSelection) {
			setAttachmentError("Wait for the element preview to finish before sending.");
			return;
		}
		if (imageAttachments.hasPending()) {
			setAttachmentError(
				"Wait for the file to finish processing before sending.",
			);
			return;
		}
		if (currentUnsupportedFiles.length > 0) {
			const first = currentUnsupportedFiles[0];
			const remainder = currentUnsupportedFiles.length - 1;
			setAttachmentError(
				`${first.name}${remainder ? ` and ${remainder} more file${remainder === 1 ? "" : "s"}` : ""} cannot be sent to this model or agent. Remove ${remainder ? "them" : "it"} before sending.`,
			);
			return;
		}
		if ((currentImages.length > 0 || annotationImages.length > 0) && !imageInputSupported) {
			setAttachmentError(
				"This model does not accept images. Remove the attachment or choose a vision model.",
			);
			return;
		}
		if (
			currentImages.length > 0 &&
			(bashDraft ||
				parseCompactCommand(draftValue) !== undefined ||
				parsePiModeCommand(draftValue, harness) !== undefined)
		) {
			setAttachmentError(
				`${bashDraft ? "! commands do" : `${slash?.name ? `/${slash.name}` : "This command"} does`} not accept attachments. Remove the attachment and try again.`,
			);
			return;
		}
		const submittedImages = [...currentImages, ...annotationImages].map(({ type, data, mimeType }) => ({
			type,
			data,
			mimeType,
		}));
		// Recognized mentions carry explicit routing semantics; annotations then
		// ride along inside the prompt as their own delimited plain-text block.
		const referencedSessions = findSessionMentions(
			prompt,
			sessions,
			sessionReferenceIds,
		);
		const sessionTitles = new Set(
			referencedSessions.map(({ session }) =>
				session.title.trim().toLocaleLowerCase(),
			),
		);
		const promptWithSessions = appendSessionRouting(
			prompt,
			sessions,
			sessionReferenceIds,
		);
		// If a session and @capability share a display name, the session chosen
		// from the combined menu wins; $skills use their own trigger.
		const promptWithCapabilities = appendCapabilityRouting(
			promptWithSessions,
			enabledSkills.filter(
				(skill) =>
					capabilityTrigger(skill) === "$" ||
					!sessionTitles.has(skill.name.trim().toLocaleLowerCase()),
			),
		);
		const sentAnnotations = commandDraft ? [] : currentAnnotations;
		const promptWithExistingContext = bashDraft
			? prompt
			: appendTerminalContextToPrompt(
					appendAnnotationsToPrompt(promptWithCapabilities, sentAnnotations, currentImages.length),
					commandDraft ? undefined : currentTerminalContext,
				);
		const promptWithContext = appendTaskContext(promptWithExistingContext, currentExcerpts);
		const frame = `${JSON.stringify({ type: intent === "steer" ? "steer" : "follow_up", message: promptWithContext, ...(submittedImages.length ? { images: submittedImages } : {}), id: "00000000-0000-0000-0000-000000000000" })}\n`;
		if (new TextEncoder().encode(frame).byteLength > MAX_IMAGE_PROMPT_BYTES) {
			setAttachmentError(
				"This message and its attachments are too large to send. Shorten the message or remove an attachment.",
			);
			return;
		}
		submittingRef.current = true;
		const submittedValue = draftValue;
		const submittedComposerImages = currentImages;
		setValue("");
		imageAttachments.clear();
		setAttachmentError("");
		setMenu(null);
		try {
			await onSend(promptWithContext, submittedImages, intent);
			if (sharedSelection && !commandDraft) consumeSharedSelection();
			if (draftKeyRef.current && mountedRef.current) clearComposerDraft(draftKeyRef.current);
			// The annotations were delivered: clear the attachment and page markers.
			if (sentAnnotations.length > 0) onClearAnnotations();
			if (currentExcerpts.length) removeExcerpts?.(currentExcerpts.map((excerpt) => excerpt.id));
		} catch (error) {
			if (!mountedRef.current && draftKeyRef.current) {
				restoreComposerDraft(draftKeyRef.current, { text: submittedValue, model, effort, fast });
			}
			if (mountedRef.current) {
				setValue((current) => current.trim() ? `${submittedValue}\n\n${current}` : submittedValue);
				const restoration = imageAttachments.restoreWithinLimits(submittedComposerImages);
				const detail = cleanRequestErrorDetail(error);
				const prefix = detail ? `Message was not sent (${detail.replace(/[.]+$/, "")}).` : "Message was not sent.";
				if (restoration.omitted > 0) {
					const restoredImages = restoration.restored > 0
						? ` along with ${restoration.restored} submitted image${restoration.restored === 1 ? "" : "s"}`
						: "";
					setAttachmentError(`${prefix} Your draft was restored${restoredImages}, but ${restoration.omitted} submitted image${restoration.omitted === 1 ? "" : "s"} could not be restored because the attachment limits are full.`);
				} else if (submittedComposerImages.length > 0) {
					setAttachmentError(`${prefix} Your draft and images were restored.`);
				} else {
					setAttachmentError(`${prefix} Your draft was restored.`);
				}
			}
		} finally {
			submittingRef.current = false;
			if (mountedRef.current) textareaRef.current?.focus();
		}
	};

	const finishDictation = async (send: boolean) => {
		const transcript = await dictation.finish();
		if (!transcript) return;
		const next = value.trimEnd()
			? `${value.trimEnd()} ${transcript}`
			: transcript;
		setValue(next);
		if (send) await submit("queue", next);
		else requestAnimationFrame(() => textareaRef.current?.focus());
	};

	const sendQueuedMessageImmediately = async (queued: QueuedPrompt) => {
		if (onSendQueuedMessage) return onSendQueuedMessage(queued);
		onDeleteQueuedMessage?.(queued);
		try {
			await onSend(queued.text, [], "steer");
		} catch {
			// sendPrompt reports failures itself; there is no composer draft to restore.
		}
	};

	return (
		<div className="composer-wrap">
			{queuedMessages.length ? (
				<ComposerQueue
					queuedMessages={queuedMessages}
					onSendNow={(queued) => {
						void sendQueuedMessageImmediately(queued);
					}}
					onEdit={(queued) => {
						onEditQueuedMessage?.(queued);
						setDraft(queued.text);
					}}
					onDelete={onDeleteQueuedMessage}
				/>
			) : null}
			<div
				className={`composer ${busy || admitting ? "composer--busy" : ""} ${imageAttachments.dragging ? "composer--image-dragging" : ""}`}
				{...imageAttachments.dragHandlers}
			>
				{imageAttachments.dragging ? (
					<div className="composer-drop-feedback" aria-hidden="true">
						<Paperclip size={18} />
						Drop files to attach
					</div>
				) : null}
				{excerpts.length ? <div className="task-context-tray" aria-label="Selected context attachments">{excerpts.map((excerpt) => <div className="task-context-tray__item" key={excerpt.id}><details><summary>{excerpt.source}{excerpt.path ? ` · ${excerpt.path}` : ''}{excerpt.range ? ` · ${excerpt.range}` : ''}</summary>{excerpt.sessionFile ? <small>{excerpt.sessionFile}</small> : null}<pre>{excerpt.text}</pre></details><IconButton size="small" label={`Remove context ${excerpt.source}`} onClick={() => removeExcerpts?.([excerpt.id])}><X size={12} /></IconButton></div>)}</div> : null}
				<BrowserSelectionTray annotations={sharedSelection ? [...annotations, sharedSelection] : annotations} processing={processingSelection} error={selectionError} onClear={() => { onClearAnnotations(); if (sharedSelection) consumeSharedSelection(); }} onRemove={(id) => { if (id === sharedSelection?.id) consumeSharedSelection(); else onRemoveAnnotation(id); }} onReveal={onRevealBrowserReference} />
				{images.length ||
				unsupportedFiles.length ||
				terminalSelection?.text ||
				(extensionTab && browserExtension) ? (
					<div className="composer-attachments composer__context-chips" aria-label="Attachments">
						{extensionTab && browserExtension ? (
							<ExtensionTabPill tab={sharedSelection || processingSelection ? extensionTab : { ...extensionTab, selection: undefined }} extension={browserExtension} />
						) : null}
						{terminalSelection?.text ? (
							<div
								className="composer-attachment composer-attachment--terminal has-selection"
								title={`Selected text from ${terminalSelection.label}`}
							>
								<button
									type="button"
									className="composer-attachment__expand"
									aria-expanded={terminalSelectionOpen}
									aria-label={`Inspect selected text from ${terminalSelection.label}`}
									onClick={() => setTerminalSelectionOpen((open) => !open)}
								>
									<TerminalWindow size={13} />
									<span>{terminalSelection.label}</span>
									<small>selected</small>
									<CaretDown
										size={11}
										className={terminalSelectionOpen ? "is-open" : ""}
									/>
								</button>
								<IconButton
									size="small"
									className="composer-attachment__clear"
									label="Clear terminal selection"
									onClick={onClearTerminalSelection}
								>
									<X size={12} />
								</IconButton>
							</div>
						) : null}
						{images.map((image) => (
							<div className="composer-attachment" key={image.id}>
								<img
									src={`data:${image.mimeType};base64,${image.data}`}
									alt=""
								/>
								<span>
									<ImageIcon size={12} />
									{image.name}
								</span>
								<button
									type="button"
									aria-label={`Remove ${image.name}`}
									onClick={() => imageAttachments.remove(image.id)}
								>
									<X size={12} />
								</button>
							</div>
						))}
						{unsupportedFiles.map((file) => (
							<div className="composer-attachment" key={file.id}>
								<span>
									<Paperclip size={12} />
									{file.name}
								</span>
								<button
									type="button"
									aria-label={`Remove ${file.name}`}
									onClick={() => imageAttachments.remove(file.id)}
								>
									<X size={12} />
								</button>
							</div>
						))}
					</div>
				) : null}
				{terminalSelectionOpen && terminalSelection?.text ? (
					<div
						className="composer-terminal-selection"
						role="region"
						aria-label="Selected terminal text"
					>
						<div>
							<TerminalWindow size={14} aria-hidden="true" />
							<strong>{terminalSelection.label}</strong>
							{terminalSelection.truncated ? (
								<small>start truncated</small>
							) : null}
						</div>
						<pre>{terminalSelection.text}</pre>
					</div>
				) : null}
				<div className="composer-input">
					<textarea
						ref={textareaRef}
						value={value}
						disabled={disabled || loading}
						rows={2}
						placeholder={
							disabled
								? "Add a project to begin"
								: loading
									? "Loading session…"
									: busy
										? messageEnterAction === "steer"
											? "Steer this run… (Enter to steer, Ctrl+Enter to queue)"
											: "Steer this run… (Ctrl+Enter to steer, Enter to queue)"
										: admitting
											? `Starting ${shortName}…`
											: `Ask ${shortName} anything  ·  @ files  / commands  $ skills`
						}
						aria-label={`Message ${shortName}`}
						role="combobox"
						aria-autocomplete="list"
						aria-expanded={Boolean(menu && suggestions.length)}
						aria-controls={menu ? menuId : undefined}
						aria-activedescendant={
							menu && suggestions.length
								? `${menuId}-option-${activeSuggestion}`
								: undefined
						}
						onChange={(event) => {
							setValue(event.target.value);
							setCaret(event.target.selectionStart ?? event.target.value.length);
						}}
						onSelect={(event) =>
							setCaret(event.currentTarget.selectionStart)
						}
						onPaste={(event) => {
							const files = [...event.clipboardData.items]
								.filter((item) => item.kind === "file")
								.flatMap((item) => {
									const file = item.getAsFile();
									return file ? [file] : [];
								});
							if (!files.length) return;
							const pastedText = event.clipboardData.getData("text/plain");
							event.preventDefault();
							if (pastedText) insert(pastedText);
							void imageAttachments.ingest(files);
						}}
						onKeyDown={(event) => {
							if (event.key === "Backspace") forgetAcceptedMention();
							if (
								menu &&
								suggestions.length &&
								(event.key === "ArrowDown" || event.key === "ArrowUp")
							) {
								event.preventDefault();
								setActiveSuggestion((current) =>
									event.key === "ArrowDown"
										? (current + 1) % suggestions.length
										: (current - 1 + suggestions.length) % suggestions.length,
								);
								return;
							}
							// Tab completes like Enter, but leaves focus traversal alone in the Add context action menu.
							if (
								(event.key === "Enter" ||
									(event.key === "Tab" && menu !== "add")) &&
								!event.ctrlKey &&
								!event.metaKey &&
								!event.altKey &&
								!event.shiftKey &&
								!event.nativeEvent.isComposing &&
								menu &&
								suggestions.length
							) {
								event.preventDefault();
								chooseSuggestion(activeSuggestion);
								return;
							}
							const intent = messageActionForKey(
								{
									key: event.key,
									ctrlKey: event.ctrlKey,
									metaKey: event.metaKey,
									altKey: event.altKey,
									shiftKey: event.shiftKey,
									isComposing: event.nativeEvent.isComposing,
								},
								messageEnterAction,
							);
							if (intent) {
								event.preventDefault();
								void submit(intent);
							}
							if (event.key === "Escape") {
								event.preventDefault();
								setMenu(null);
							}
						}}
					/>
				</div>
				{menu && suggestions.length ? (
					<div
						ref={menuRef}
						id={menuId}
						className="composer-menu"
						role="listbox"
						aria-label={
							menu === "command"
								? "Commands"
								: menu === "argument"
									? "Command options"
									: menu === "mention"
										? mentionsSkills
											? "Skills"
											: "Files, sessions, and capabilities"
										: "Add context"
						}
					>
						{suggestions.map((suggestion, index) => (
							<button
								id={`${menuId}-option-${index}`}
								type="button"
								role="option"
								tabIndex={-1}
								aria-selected={activeSuggestion === index}
								className={activeSuggestion === index ? "is-active" : ""}
								key={suggestion.key}
								onMouseEnter={() => setActiveSuggestion(index)}
								onClick={suggestion.choose}
							>
								{suggestion.icon}
								<span>
									<strong>{suggestion.label}</strong>
									<small>{suggestion.detail}</small>
								</span>
							</button>
						))}
					</div>
				) : null}
				{attachmentError ? <Banner status="error" role="alert" className="composer-attachment-error" title={attachmentError} /> : null}
				<p
					id={imageStatusId}
					className="sr-only"
					role="status"
					aria-live="polite"
				>
					{imageAttachments.dragging
						? "Drop files to attach."
						: processingImages
							? "Adding files."
							: images.length + unsupportedFiles.length
								? `${images.length + unsupportedFiles.length} file${images.length + unsupportedFiles.length === 1 ? "" : "s"} attached.`
								: ""}
				</p>
				<div className="composer__footer">
					<div className="composer__controls">
						<IconButton
							label="Add context"
							data-composer-menu-trigger
							aria-expanded={menu === "add"}
							aria-controls={menu === "add" ? menuId : undefined}
							onClick={() => {
								setMenu((current) => (current === "add" ? null : "add"));
								requestAnimationFrame(() => textareaRef.current?.focus());
							}}
						>
							<Plus size={17} />
						</IconButton>
						<input
							ref={fileInputRef}
							className="sr-only"
							type="file"
							multiple
							tabIndex={-1}
							aria-label="Choose files to attach"
							aria-describedby={imageStatusId}
							disabled={disabled || loading || admitting}
							onChange={(event) => {
								const files = Array.from(event.currentTarget.files ?? []);
								event.currentTarget.value = "";
								void imageAttachments.ingest(files);
							}}
						/>
						{harness === "pi" ? (
							<PiModeControl
								disabled={Boolean(disabled || loading || busy || admitting)}
								modelsByProvider={modelsByProvider}
								providers={providers}
								onCommand={(command) => onSend(command, [], "queue")}
							>
								{modelControls}
							</PiModeControl>
						) : (
							modelControls
						)}
						<CheckoutPicker
							catalog={checkoutCatalog}
							fallbackLabel={checkoutLabel}
							loading={checkoutsLoading}
							disabled={busy || admitting}
							onExecute={onExecuteCheckout}
						/>
						<ExecutingModelChip executingModel={executingModel ?? undefined} />
						{fastSupported ? (
							<ApexButton
								variant="quiet"
								compact
								label="Fast"
								className={`fast-mode-toggle ${fast ? "is-active" : ""}`}
								aria-pressed={fast}
								disabled={!fastAvailable}
								title={
									fastAvailable
										? `Use ${agentName} priority service tier`
										: `The installed ${agentName} RPC runtime does not expose fast mode`
								}
								onClick={() => onFastChange(!fast)}
							>
								<Lightning size={12} />{" "}
								<span className="fast-mode-toggle__label">Fast</span>
							</ApexButton>
						) : null}
					</div>
					<div className="composer__actions">
						{dictation.state === "connecting" ||
						dictation.state === "recording" ? (
							<button
								type="button"
								className="context-usage-dial context-usage-dial--cancel"
								aria-label="Cancel dictation"
								title="Cancel dictation"
								onClick={dictation.cancel}
							>
								<X size={14} />
							</button>
						) : (
							<ContextUsageRing
								contextUsage={contextUsage}
								sessionUsage={sessionUsage}
							/>
						)}
						<button
							type="button"
							className={`dictation-button ${dictation.state === "recording" ? "is-recording" : ""}`}
							aria-label={
								dictation.state === "recording"
									? "Stop and transcribe dictation"
									: dictation.state === "connecting"
										? "Connecting microphone"
										: dictation.state === "transcribing"
											? "Transcribing dictation"
											: "Start dictation"
							}
							disabled={
								!voice ||
								loading ||
								disabled ||
								admitting ||
								dictation.state === "connecting" ||
								dictation.state === "transcribing"
							}
							onClick={() => {
								if (dictation.state === "recording")
									void finishDictation(false);
								else void dictation.start();
							}}
						>
							{dictation.state === "recording" ? (
								<Square size={10} fill="currentColor" />
							) : dictation.state === "connecting" ||
								dictation.state === "transcribing" ? (
								<CircleNotch className="is-spinning" size={15} />
							) : (
								<Microphone size={15} />
							)}
						</button>
						{dictation.state === "recording" ? (
							<button
								type="button"
								className="send-button"
								aria-label="Transcribe and send message"
								onClick={() => void finishDictation(true)}
							>
								<ArrowUp size={17} />
							</button>
						) : (
							<>
								<button
									type="button"
									className={`send-button ${busy ? "send-button--steer" : ""}`}
									aria-label={busy ? "Steer this run" : "Send message"}
									title={busy ? "Steer this run" : undefined}
									disabled={
										(!value.trim() &&
											images.length === 0 &&
											unsupportedFiles.length === 0 &&
											annotations.length === 0 && !sharedSelection &&
											!terminalSelection?.text && excerpts.length === 0) ||
										processingImages ||
										(!busy && admitting) ||
										loading ||
										disabled
									}
									onClick={() => void submit(busy ? "steer" : "queue")}
								>
									<ArrowUp size={17} />
								</button>
								{busy ? (
									<button
										type="button"
										className="send-button send-button--stop"
										aria-label="Stop Pi"
										title="Stop this run"
										onClick={() => void onStop()}
									>
										<Square size={10} fill="currentColor" aria-hidden="true" />
									</button>
								) : null}
							</>
						)}
					</div>
				</div>
			</div>
		</div>
	);
});
