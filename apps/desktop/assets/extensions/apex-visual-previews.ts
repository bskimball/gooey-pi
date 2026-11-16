export const VISUAL_PREVIEW_GUIDELINE = 'When the user asks to see options, mockups, visual directions, or interactive explanations, include a self-contained HTML document in a ```html fence. Apex renders HTML, inline CSS, and inline JavaScript in an isolated interactive preview. Use working controls to compare variations within one preview and keep each tradeoff to a short line. Do not depend on network requests, remote libraries, imports, local files, storage, desktop APIs, or navigation; use inline data and ordinary DOM APIs. Keep the document under 100,000 characters, give it a descriptive title, and make controls keyboard accessible. To prepare a choice or answer, call parent.postMessage({type: "apex:feedback", text: "the chosen answer"}, "*"). Limit text to 4,000 characters. This fills the visible feedback draft only; the user reviews it and clicks Send feedback. It never sends automatically and does not replace text the user has edited.'

export interface VisualPreviewEvent {
  systemPromptOptions?: { promptGuidelines?: string[] }
}

export function applyVisualPreviewGuideline(event: VisualPreviewEvent): void {
  const guidelines = event.systemPromptOptions?.promptGuidelines
  if (!guidelines || guidelines.includes(VISUAL_PREVIEW_GUIDELINE)) return
  guidelines.push(VISUAL_PREVIEW_GUIDELINE)
}

export default function apexVisualPreviews(pi: { on(event: 'before_agent_start', handler: (event: VisualPreviewEvent) => void): void }): void {
  pi.on('before_agent_start', applyVisualPreviewGuideline)
}
