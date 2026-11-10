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
button[aria-pressed="true"] { color: #081018; background: #8ab4ff; }
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
			const pick = document.createElement("button");
			pick.type = "button";
			const stop = document.createElement("button");
			stop.type = "button";
			stop.className = "quiet";
			stop.textContent = "Stop sharing";
			pill.append(dot, label, pick, toggle, stop);
			root.append(style, pill);
			toggle.addEventListener("click", () =>
				act({ type: "SET_TAB_PAUSED", paused: !tabState.paused }),
			);
			pick.addEventListener("click", () =>
				act({ type: "SET_TAB_PICKING", picking: !tabState.picking }),
			);
			stop.addEventListener("click", () => act({ type: "UNPAIR_TAB" }));
			parts = { pill, status, toggle, pick, stop };
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
			const { pill, status, toggle, pick } = parts;
			pill.classList.toggle("paused", tabState.paused);
			status.data = tabState.selectedLabel
				? ` · Selected ${tabState.selectedLabel}`
				: tabState.picking
					? " · Select an element"
					: tabState.paused
						? " · Paused"
						: " · Agent working";
			pick.textContent = tabState.picking ? "Selecting" : "Select";
			pick.setAttribute("aria-pressed", tabState.picking ? "true" : "false");
			pick.setAttribute(
				"aria-label",
				tabState.picking
					? "Stop selecting an element"
					: "Select an element for Apex",
			);
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
				tabState = tab
					? {
							paused: tab.paused === true,
							picking: tab.picking === true,
							selectedLabel:
								typeof tab.selectedLabel === "string" ? tab.selectedLabel : undefined,
						}
					: null;
				syncPicking(tabState?.picking === true);
			} catch {
				tabState = null;
				syncPicking(false);
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

		let picking = false;
		let hover = null;
		let locked = null;
		let selected = null;
		let onPick = null;
		let onActivate = null;
		let onMove = null;
		let onTrack = null;

		function place(box, element) {
			const rect = element.getBoundingClientRect();
			if (rect.width < 1 && rect.height < 1) {
				box.style.display = "none";
				return;
			}
			box.style.display = "block";
			box.style.left = `${rect.left - 2}px`;
			box.style.top = `${rect.top - 2}px`;
			box.style.width = `${rect.width}px`;
			box.style.height = `${rect.height}px`;
		}

		function lockSelection(element) {
			selected = element;
			if (!locked) {
				locked = document.createElement("div");
				locked.style.cssText =
					"position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #c2410c;background:rgba(194,65,12,.18);border-radius:2px;";
				document.documentElement.append(locked);
			}
			place(locked, element);
		}

		function clearLocked() {
			selected = null;
			locked?.remove();
			locked = null;
		}

		function bound(value, max) {
			const clean = String(value || "")
				.replace(/\s+/g, " ")
				.trim();
			return clean.length > max ? clean.slice(0, max) : clean;
		}

		function selectorFor(element) {
			const parts = [];
			let node = element;
			while (node && node.nodeType === 1 && parts.length < 8) {
				const tag = node.tagName.toLowerCase();
				if (tag === "html") {
					parts.unshift("html");
					break;
				}
				const id = node.getAttribute("id");
				if (id && document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length === 1) {
					parts.unshift(`#${CSS.escape(id)}`);
					break;
				}
				let index = 1;
				let before = node.previousElementSibling;
				while (before) {
					if (before.tagName === node.tagName) index += 1;
					before = before.previousElementSibling;
				}
				parts.unshift(`${tag}:nth-of-type(${index})`);
				node = node.parentElement;
			}
			return parts.join(" > ").slice(0, 1024);
		}

		function capture(element) {
			const rect = element.getBoundingClientRect();
			const file = element.getAttribute("data-source-file");
			const line = element.getAttribute("data-source-line");
			const component = element.getAttribute("data-source-component");
			const sourceHint = file
				? {
						kind: "explicit",
						path: file.slice(0, 4096),
						...( /^\d+$/.test(line || "") ? { line: Number(line) } : {}),
					}
				: undefined;
			return {
				selector: selectorFor(element),
				tagName: element.tagName.toLowerCase(),
				id: bound(element.getAttribute("id"), 256),
				classes: [...(element.classList || [])].slice(0, 10),
				text: bound(element.innerText || element.textContent, 500),
				href: bound(element.href, 2048),
				src: bound(element.currentSrc || element.src, 2048),
				...(component ? { component: bound(component, 120) } : {}),
				...(sourceHint ? { sourceHint } : {}),
				rect: {
					x: Math.round(rect.left),
					y: Math.round(rect.top),
					width: Math.round(rect.width),
					height: Math.round(rect.height),
				},
			};
		}

		function syncPicking(next) {
			if (next === picking) return;
			picking = next;
			if (!picking) {
				if (onPick) {
					document.removeEventListener("pointerdown", onPick, true);
					onPick = null;
				}
				if (onActivate) {
					document.removeEventListener("click", onActivate, true);
					document.removeEventListener("auxclick", onActivate, true);
					document.removeEventListener("dblclick", onActivate, true);
					onActivate = null;
				}
				if (onMove) {
					document.removeEventListener("mousemove", onMove, true);
					onMove = null;
				}
				hover?.remove();
				hover = null;
				clearLocked();
				if (onTrack) {
					window.removeEventListener("scroll", onTrack, true);
					window.removeEventListener("resize", onTrack);
					onTrack = null;
				}
				return;
			}
			hover = document.createElement("div");
			hover.style.cssText =
				"position:fixed;z-index:2147483646;pointer-events:none;display:none;border:2px solid #2488ff;background:rgba(36,136,255,.14);border-radius:2px;";
			document.documentElement.append(hover);
			onPick = (event) => {
				// pointerdown, not click: a page that cancels mousedown never emits click.
				if (
					event.button !== 0 ||
					!event.isTrusted ||
					(pillHost && event.composedPath?.().includes(pillHost))
				)
					return;
				const target =
					event.target?.nodeType === 1
						? event.target
						: event.target?.parentElement;
				if (!target || target === hover || target === locked) return;
				event.preventDefault();
				event.stopPropagation();
				lockSelection(target);
				if (hover) hover.style.display = "none";
				const activation = new AbortController();
				document.addEventListener("click", (click) => { click.preventDefault(); click.stopImmediatePropagation(); activation.abort(); }, { capture: true, signal: activation.signal });
				document.addEventListener("pointerup", () => setTimeout(() => activation.abort(), 0), { once: true, capture: true, signal: activation.signal });
				document.addEventListener("pointercancel", () => activation.abort(), { once: true, capture: true, signal: activation.signal });
				void send({
					type: "ELEMENT_SELECTED",
					capturedUrl: location.href,
					element: capture(target),
				}).finally(clearLocked).then(refresh, refresh);
			};
			onMove = (event) => {
				if (!hover) return;
				const target = event.target;
				if (
					!target ||
					target.nodeType !== 1 ||
					target === hover ||
					(pillHost && event.composedPath?.().includes(pillHost))
				) {
					hover.style.display = "none";
					return;
				}
				const rect = target.getBoundingClientRect();
				hover.style.display = "block";
				hover.style.left = `${rect.left - 2}px`;
				hover.style.top = `${rect.top - 2}px`;
				hover.style.width = `${rect.width}px`;
				hover.style.height = `${rect.height}px`;
			};
			onActivate = (event) => {
				if (!event.isTrusted || event.composedPath?.().includes(pillHost)) return;
				event.preventDefault();
				event.stopImmediatePropagation();
			};
			document.addEventListener("click", onActivate, true);
			document.addEventListener("auxclick", onActivate, true);
			document.addEventListener("dblclick", onActivate, true);
			document.addEventListener("mousemove", onMove, true);
			document.addEventListener("pointerdown", onPick, true);
			onTrack = () => {
				if (!selected?.isConnected) {
					clearLocked();
					return;
				}
				place(locked, selected);
			};
			window.addEventListener("scroll", onTrack, true);
			window.addEventListener("resize", onTrack);
		}

		async function act(message) {
			for (const button of [parts.toggle, parts.pick, parts.stop])
				button.disabled = true;
			try {
				await send(message);
			} catch {
				/* Worker or desktop is unavailable; the refresh shows the real state. */
			}
			await refresh();
			if (parts)
				for (const button of [parts.toggle, parts.pick, parts.stop])
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
		document.addEventListener("keydown", (event) => {
			if (!picking || event.key !== "Escape") return;
			event.preventDefault();
			event.stopImmediatePropagation();
			syncPicking(false);
			void send({ type: "SET_TAB_PICKING", picking: false }).then(refresh, refresh);
		}, true);
		document.addEventListener("visibilitychange", () => {
			if (document.visibilityState === "visible") void refresh();
		});
		chrome.runtime.onMessage.addListener((message) => {
			if (message?.type === "APEX_TAB_STATE_CHANGED") {
				if (message.picking === false) syncPicking(false);
				void refresh();
			}
		});
		void refresh();
	},
	{ once: true },
);
