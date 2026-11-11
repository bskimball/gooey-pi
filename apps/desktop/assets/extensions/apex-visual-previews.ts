export const VISUAL_PREVIEW_GUIDELINE = 'When the user asks to see options, mockups, or visual directions, include one self-contained HTML document per option in a ```html fence. Apex renders those fences as sandboxed previews. Keep each tradeoff to a short line; do not leave the look as Markdown only.'

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
