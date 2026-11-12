import { assign, createActor, setup, type ActorRefFrom } from 'xstate'

export interface DesktopLinkAttachmentHandle {
  runtimeId: string
  release(): void
}

export interface DesktopLinkPeerInput<T extends DesktopLinkAttachmentHandle = DesktopLinkAttachmentHandle> {
  authTimeoutMs?: number
  onTimeout: () => void
  onRelease: (attachment: T) => void
}

export type DesktopLinkPeerEvent<T extends DesktopLinkAttachmentHandle = DesktopLinkAttachmentHandle> =
  | { type: 'ATTACH_START' }
  | { type: 'ATTACH_SUCCEEDED'; attachment: T }
  | { type: 'ATTACH_FAILED' }
  | { type: 'DETACH' }
  | { type: 'DISCONNECT' }
  | { type: 'STOP' }

interface DesktopLinkPeerContext<T extends DesktopLinkAttachmentHandle = DesktopLinkAttachmentHandle> {
  authTimeoutMs: number
  attachment: T | undefined
  onTimeout: () => void
  onRelease: (attachment: T) => void
}

export const desktopLinkPeerMachine = setup({
  types: {
    context: {} as DesktopLinkPeerContext,
    input: {} as DesktopLinkPeerInput,
    events: {} as DesktopLinkPeerEvent,
  },
  delays: {
    authTimeout: ({ context }) => context.authTimeoutMs,
  },
  actions: {
    notifyTimeout: ({ context }) => context.onTimeout(),
    releaseCurrent: assign({
      attachment: ({ context }) => {
        if (context.attachment) context.onRelease(context.attachment)
        return undefined
      },
    }),
    releaseLateAttachment: ({ context, event }) => {
      if (event.type === 'ATTACH_SUCCEEDED') context.onRelease(event.attachment)
    },
  },
}).createMachine({
  id: 'desktopLinkPeer',
  initial: 'awaitingAuth',
  context: ({ input }) => ({
    authTimeoutMs: input.authTimeoutMs ?? 10_000,
    attachment: undefined,
    onTimeout: input.onTimeout,
    onRelease: input.onRelease,
  }),
  states: {
    awaitingAuth: {
      after: {
        authTimeout: { target: 'detached', actions: 'notifyTimeout' },
      },
      on: {
        ATTACH_START: 'attaching',
        DISCONNECT: 'detached',
        STOP: 'detached',
      },
    },
    attaching: {
      after: {
        authTimeout: { target: 'detached', actions: 'notifyTimeout' },
      },
      on: {
        ATTACH_SUCCEEDED: {
          target: 'attached',
          actions: assign({ attachment: ({ event }) => event.attachment }),
        },
        ATTACH_FAILED: 'awaitingAuth',
        DISCONNECT: 'detached',
        STOP: 'detached',
      },
    },
    attached: {
      on: {
        DETACH: { target: 'awaitingAuth', actions: 'releaseCurrent' },
        DISCONNECT: { target: 'detached', actions: 'releaseCurrent' },
        STOP: { target: 'detached', actions: 'releaseCurrent' },
      },
    },
    detached: {
      on: {
        ATTACH_SUCCEEDED: { actions: 'releaseLateAttachment' },
      },
    },
  },
})

export type DesktopLinkPeerLifecycle = ActorRefFrom<typeof desktopLinkPeerMachine>

export function createDesktopLinkPeerLifecycle<T extends DesktopLinkAttachmentHandle>(
  input: DesktopLinkPeerInput<T>,
): DesktopLinkPeerLifecycle {
  return createActor(desktopLinkPeerMachine, {
    input: input as DesktopLinkPeerInput,
    clock: {
      setTimeout: (callback, delayMs) => {
        const timer = setTimeout(callback, delayMs)
        timer.unref()
        return timer
      },
      clearTimeout: (timer) => clearTimeout(timer),
    },
  }).start()
}
