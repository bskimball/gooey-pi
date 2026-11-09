import { assign, fromPromise, setup } from 'xstate'
import type { PrimeWorkApi, TerminalDataEvent, TerminalExitEvent } from '@/types/api'

type CreatedTerminal = Awaited<ReturnType<PrimeWorkApi['terminal']['create']>>

interface Session {
  create(): Promise<CreatedTerminal>
  kill(terminalId: string): void
  attach(info: CreatedTerminal, initialOutput: string | undefined): void
  write(data: string): void
  announceExit(exitCode: number): void
  fail(error: unknown): void
}

interface Context {
  session: Session | null
  terminalId: string | null
  bufferedData: Map<string, string>
  bufferedExits: Map<string, number>
  earlyExit: number | undefined
}

type Event =
  | { type: 'START'; session: Session }
  | { type: 'DATA'; event: TerminalDataEvent }
  | { type: 'EXIT'; event: TerminalExitEvent }
  | { type: 'DISPOSE' }

export const terminalViewMachine = setup({
  types: { context: {} as Context, events: {} as Event },
  actors: {
    create: fromPromise<CreatedTerminal, Session>(async ({ input, signal }) => {
      const info = await input.create()
      if (signal.aborted) input.kill(info.terminalId)
      else signal.addEventListener('abort', () => input.kill(info.terminalId), { once: true })
      return info
    }),
  },
  guards: {
    matchingTerminal: ({ context, event }) => (event.type === 'DATA' || event.type === 'EXIT') && event.event.terminalId === context.terminalId,
    exitedEarly: ({ context }) => context.earlyExit !== undefined,
  },
  actions: {
    write: ({ context, event }) => { if (event.type === 'DATA') context.session?.write(event.event.data) },
    announceExit: ({ context, event }) => { if (event.type === 'EXIT') context.session?.announceExit(event.event.exitCode) },
    dispose: ({ context }) => { if (context.terminalId) context.session?.kill(context.terminalId) },
  },
}).createMachine({
  id: 'terminalView',
  context: { session: null, terminalId: null, bufferedData: new Map(), bufferedExits: new Map(), earlyExit: undefined },
  initial: 'uninitialized',
  on: {
    START: {
      target: '.active',
      reenter: true,
      actions: assign(({ event }) => ({ session: event.session, terminalId: null, bufferedData: new Map(), bufferedExits: new Map(), earlyExit: undefined })),
    },
    DISPOSE: { target: '.disposed' },
  },
  states: {
    uninitialized: {},
    active: {
      initial: 'creating',
      exit: 'dispose',
      states: {
        creating: {
          invoke: {
            src: 'create',
            input: ({ context }) => context.session!,
            onDone: {
              target: 'attached',
              actions: [
                ({ context, event }) => context.session?.attach(event.output, context.bufferedData.get(event.output.terminalId)),
                assign(({ context, event }) => ({ terminalId: event.output.terminalId, earlyExit: context.bufferedExits.get(event.output.terminalId), bufferedData: new Map(), bufferedExits: new Map() })),
              ],
            },
            onError: { target: 'error', actions: ({ context, event }) => context.session?.fail(event.error) },
          },
          on: {
            DATA: { actions: assign(({ context, event }) => ({ bufferedData: new Map(context.bufferedData).set(event.event.terminalId, `${context.bufferedData.get(event.event.terminalId) ?? ''}${event.event.data}`.slice(-256 * 1024)) })) },
            EXIT: { actions: assign(({ context, event }) => ({ bufferedExits: new Map(context.bufferedExits).set(event.event.terminalId, event.event.exitCode) })) },
          },
        },
        attached: {
          always: { guard: 'exitedEarly', target: 'exited', actions: ({ context }) => { if (context.earlyExit !== undefined) context.session?.announceExit(context.earlyExit) } },
          on: {
            DATA: { guard: 'matchingTerminal', actions: 'write' },
            EXIT: { guard: 'matchingTerminal', target: 'exited', actions: 'announceExit' },
          },
        },
        exited: { on: { DATA: { guard: 'matchingTerminal', actions: 'write' } } },
        error: {},
      },
    },
    disposed: {},
  },
})
