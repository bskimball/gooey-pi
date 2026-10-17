// Status pill host; interactions inside it are pill controls, not a user takeover of the page.
let pillHost = null;
// This listener reports user takeover.
for (const [type, kind] of [
	["mousedown", "pointer"],
	["wheel", "wheel"],
	["keydown", "key"],
]) {
	window.addEventListener(
		type,
		(event) => {
			if (
				!event.isTrusted ||
				(pillHost && event.composedPath?.().includes(pillHost))
			)
				return;
			void chrome.runtime
				.sendMessage({
					type: "USER_INTERACTION_DETECTED",
					kind,
					x: event.clientX,
					y: event.clientY,
				})
				.catch(() => undefined);
		},
		{ capture: true, passive: true },
	);
}

const PILL_STYLE = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; }
.pill { display: flex; align-items: center; gap: 8px; padding: 5px 5px 5px 12px; border-radius: 999px;
  color: #e9ebf1; background: #1b1d23; box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 8px 24px rgba(8,10,16,.32), 0 2px 6px rgba(8,10,16,.24);
  font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  animation: enter 220ms cubic-bezier(.16,1,.3,1); }
.dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: #4fcf8a; box-shadow: 0 0 0 3px rgba(79,207,138,.18); }
.pill.paused .dot { background: #e8b04a; box-shadow: 0 0 0 3px rgba(232,176,74,.18); }
.label { white-space: nowrap; }
.mark { display: inline-block; width: 14px; height: 14px; margin-right: 5px; vertical-align: -3px; }
.label b { font-weight: 650; }
button { all: unset; box-sizing: border-box; height: 26px; padding: 0 10px; border-radius: 999px; color: #e9ebf1;
  font-family: inherit; font-size: 11.5px; font-weight: 550; line-height: 26px;
  background: rgba(255,255,255,.08); cursor: pointer; white-space: nowrap; transition: background 130ms ease-out, transform 100ms ease-out; }
button:hover { background: rgba(255,255,255,.14); }
button:active { transform: scale(.96); }
button:focus-visible { outline: 2px solid #8ab4ff; outline-offset: 1px; }
button.quiet { color: #a9adb9; background: transparent; }
button.quiet:hover { color: #e9ebf1; background: rgba(255,255,255,.08); }
button:disabled { opacity: .5; cursor: default; }
@keyframes enter { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { .pill { animation: none; } button { transition: none; } }
`;

// "The Apex Fang" mark, mirrored from PiMark in src/components/ui.tsx.
const MARK_PATHS = [
	[
		"currentColor",
		"M50 8 C60 24 74 51 86 81 C87.6 85 84 88.8 80 86.8 L67 80 C61 68 55.5 64 50 64 C44.5 64 39 68 33 80 L20 86.8 C16 88.8 12.4 85 14 81 C26 51 40 24 50 8 Z M50 27 C45 37 40.5 46 37.5 54.5 C45 49.5 55 49.5 62.5 54.5 C59.5 46 55 37 50 27 Z",
	],
	[
		"#38bdf8",
		"M27 89 C37 78 46 76 54 81.5 C60.5 85.8 66.5 84.5 73 79.5 C66.5 90 56.5 92.5 47 87.8 C39.5 84 33.5 85.2 27 89 Z",
	],
];

function createMark() {
	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("class", "mark");
	svg.setAttribute("viewBox", "0 0 100 100");
	svg.setAttribute("aria-hidden", "true");
	for (const [fill, d] of MARK_PATHS) {
		const path = document.createElementNS(ns, "path");
		path.setAttribute("fill", fill);
		path.setAttribute("fill-rule", "evenodd");
		path.setAttribute("d", d);
		svg.append(path);
	}
	return svg;
}

// Pill state is owned by the background worker; this content script only mirrors it.
window.addEventListener(
	"DOMContentLoaded",
	() => {
		let tabState = null;
		let pollTimer = null;
		let refreshTimer = null;
		let parts = null;

		const send = async (message) => {
			const response = await chrome.runtime.sendMessage(message);
			if (response?.error) throw new Error(response.error);
			return response?.result;
		};

		const mount = () => {
			pillHost = document.createElement("apex-status");
			const root = pillHost.attachShadow({ mode: "closed" });
			const style = document.createElement("style");
			style.textContent = PILL_STYLE;
			const pill = document.createElement("div");
			pill.className = "pill";
			pill.setAttribute("role", "status");
			const dot = document.createElement("span");
			dot.className = "dot";
			const label = document.createElement("span");
			label.className = "label";
			const brand = document.createElement("b");
			brand.textContent = "Apex";
			const status = document.createTextNode("");
			label.append(createMark(), brand, status);
			const toggle = document.createElement("button");
			toggle.type = "button";
			const stop = document.createElement("button");
			stop.type = "button";
			stop.className = "quiet";
			stop.textContent = "Stop sharing";
			pill.append(dot, label, toggle, stop);
			root.append(style, pill);
			toggle.addEventListener("click", () =>
				act({ type: "SET_TAB_PAUSED", paused: !tabState.paused }),
			);
			stop.addEventListener("click", () => act({ type: "UNPAIR_TAB" }));
			parts = { pill, status, toggle, stop };
			document.documentElement.append(pillHost);
		};

		const render = () => {
			if (!tabState) {
				pillHost?.remove();
				pillHost = null;
				parts = null;
				return;
			}
			if (!pillHost) mount();
			const { pill, status, toggle } = parts;
			pill.classList.toggle("paused", tabState.paused);
			status.data = tabState.paused ? " · Paused" : " · Agent working";
			toggle.textContent = tabState.paused ? "Resume" : "Pause / Take over";
			toggle.setAttribute(
				"aria-label",
				tabState.paused
					? "Resume Apex agent"
					: "Pause Apex agent and take over",
			);
		};

		const refresh = async () => {
			try {
				const state = await send({ type: "GET_STATE" });
				const tab = state?.tabs?.find(
					(item) => item.chromeTabId === state.senderTabId,
				);
				tabState = tab ? { paused: tab.paused === true } : null;
			} catch {
				tabState = null;
			}
			render();
			// Desktop-side pause changes only reach the worker, so poll while this tab is shared and on screen.
			clearTimeout(pollTimer);
			if (tabState && document.visibilityState === "visible")
				pollTimer = setTimeout(refresh, 2000);
		};

		const scheduleRefresh = () => {
			clearTimeout(refreshTimer);
			refreshTimer = setTimeout(refresh, 250);
		};

		async function act(message) {
			for (const button of [parts.toggle, parts.stop]) button.disabled = true;
			try {
				await send(message);
			} catch {
				/* Worker or desktop is unavailable; the refresh shows the real state. */
			}
			await refresh();
			if (parts)
				for (const button of [parts.toggle, parts.stop])
					button.disabled = false;
		}

		// A page interaction pauses the agent; reflect that without waiting for the poll.
		for (const type of ["mousedown", "keydown"]) {
			window.addEventListener(
				type,
				(event) => {
					if (
						event.isTrusted &&
						tabState &&
						!tabState.paused &&
						!event.composedPath().includes(pillHost)
					)
						scheduleRefresh();
				},
				{ capture: true, passive: true },
			);
		}
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") void refresh();
		});
		chrome.runtime.onMessage.addListener((message) => {
			if (message?.type === "APEX_TAB_STATE_CHANGED") void refresh();
		});
		void refresh();
	},
	{ once: true },
);
