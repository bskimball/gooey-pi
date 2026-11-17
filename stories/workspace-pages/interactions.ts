import { userEvent, within } from 'storybook/test'

export async function click(canvasElement: HTMLElement, name: string | RegExp) {
  await userEvent.click(await within(canvasElement).findByRole('button', { name }))
}
export async function type(canvasElement: HTMLElement, name: string | RegExp, value: string) {
  const field = await within(canvasElement).findByRole('textbox', { name })
  await userEvent.clear(field)
  await userEvent.type(field, value)
}
/** Production Modal uses a portal in the same dedicated story document. */
export function modalRoot(canvasElement: HTMLElement) {
  return canvasElement.ownerDocument.body
}
export async function openSchedule(canvasElement: HTMLElement) {
  await click(canvasElement, 'Open Morning issue triage')
  await click(canvasElement, 'Edit')
}
export async function submitReply(canvasElement: HTMLElement) {
  await type(canvasElement, 'Steer message', 'Please include the failing test output in your report.')
  await click(canvasElement, 'Send steer')
}
export async function editDraft(canvasElement: HTMLElement, value: string) {
  await type(canvasElement, /^Browser home(?: Browser home)?$/, value)
  await click(canvasElement, 'Save')
}
