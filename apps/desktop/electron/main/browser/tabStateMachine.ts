import type { TabState } from "apex-core/browser/service-support";
import { assign, setup, transition, type SnapshotFrom } from "xstate";

/**
 * Per-tab lifecycle. TabState stays the storage because the core type and the
 * extension tab driver mutate backend/chromeTabId/url directly. The lifecycle
 * is therefore read back from those fields by lifecycleOf() and written back by
 * applyTabLifecycle(), so the machine never holds a stale copy.
 */
export interface TabLifecycleContext {
	webContentsId: number | null;
	chromeTabId: number | undefined;
}

export type TabLifecycleEvent =
	| { type: "ATTACH_GUEST"; webContentsId: number }
	| { type: "DETACH_GUEST" }
	| { type: "POP_OUT_COMPLETED"; chromeTabId: number }
	| { type: "CHROME_TAB_BOUND"; chromeTabId: number }
	| { type: "REVOKE" };

export const tabLifecycleMachine = setup({
	types: {
		context: {} as TabLifecycleContext,
		events: {} as TabLifecycleEvent,
	},
}).createMachine({
	id: "browserTabLifecycle",
	initial: "local",
	context: { webContentsId: null, chromeTabId: undefined },
	states: {
		// Webview guest owned by the Apex pane; webContentsId null means unattached.
		local: {
			on: {
				ATTACH_GUEST: { actions: assign({ webContentsId: ({ event }) => event.webContentsId }) },
				DETACH_GUEST: { actions: assign({ webContentsId: null }) },
				POP_OUT_COMPLETED: {
					target: "chrome",
					actions: assign({ webContentsId: null, chromeTabId: ({ event }) => event.chromeTabId }),
				},
				REVOKE: "revoked",
			},
		},
		// Extension tab whose Chrome tab is still being created or navigated.
		chromePending: {
			on: {
				CHROME_TAB_BOUND: { target: "chrome", actions: assign({ chromeTabId: ({ event }) => event.chromeTabId }) },
				REVOKE: "revoked",
			},
		},
		// Extension tab backed by a Chrome tab; never has a webview guest.
		chrome: {
			on: { REVOKE: "revoked" },
		},
		// Terminal: a revoked tab never regains authority, so no event leaves it.
		revoked: { type: "final" },
	},
});

export type TabLifecycleSnapshot = SnapshotFrom<typeof tabLifecycleMachine>;

/** Reads the lifecycle state from the mutable TabState fields. */
export function lifecycleOf(tab: TabState): TabLifecycleSnapshot {
	const value = tab.revoked
		? "revoked"
		: tab.backend !== "extension"
			? "local"
			: tab.chromeTabId === undefined
				? "chromePending"
				: "chrome";
	return tabLifecycleMachine.resolveState({
		value,
		context: { webContentsId: tab.webContentsId, chromeTabId: tab.chromeTabId },
	});
}

export function isChromeTab(lifecycle: TabLifecycleSnapshot): boolean {
	return lifecycle.value === "chrome" || lifecycle.value === "chromePending";
}

/** Parks until the tab's guest attaches. Rejects with timeoutMessage after timeoutMs. */
export function awaitGuestAttach(tab: TabState, timeoutMs: number, timeoutMessage: string): Promise<void> {
	return new Promise<void>((resolveAttach, reject) => {
		const waiter = {
			resolve: resolveAttach,
			reject,
			timer: setTimeout(() => {
				tab.attachWaiters = tab.attachWaiters.filter((candidate) => candidate !== waiter);
				reject(new Error(timeoutMessage));
			}, timeoutMs),
		};
		waiter.timer.unref?.();
		tab.attachWaiters.push(waiter);
	});
}

/** Wakes every parked attach waiter: resolves on attach, rejects with error on revoke. */
export function settleAttachWaiters(tab: TabState, error?: Error): void {
	for (const waiter of tab.attachWaiters.splice(0)) {
		clearTimeout(waiter.timer);
		if (error) waiter.reject(error);
		else waiter.resolve();
	}
}

/** Folds an event into the tab's lifecycle. Events the current state does not handle leave it unchanged. */
export function applyTabLifecycle(tab: TabState, event: TabLifecycleEvent): TabLifecycleSnapshot {
	const [next] = transition(tabLifecycleMachine, lifecycleOf(tab), event);
	const { webContentsId, chromeTabId } = next.context;
	tab.webContentsId = webContentsId;
	tab.chromeTabId = chromeTabId;
	if (next.value === "revoked") tab.revoked = true;
	else tab.backend = next.value === "local" ? "webview" : "extension";
	return next;
}
