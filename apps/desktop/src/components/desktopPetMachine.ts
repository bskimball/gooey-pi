import { assign, setup } from 'xstate'

export type PetDirection = 'left' | 'right'

interface DesktopPetContext {
  direction: PetDirection
  pointerId: number | null
  dx: number
  dy: number
  lastX: number
  lastY: number
  moved: boolean
}

type DesktopPetEvent =
  | { type: 'POINTER_DOWN'; pointerId: number; dx: number; dy: number; clientX: number; clientY: number }
  | { type: 'POINTER_MOVE'; pointerId: number; clientX: number; clientY: number; overDismiss: boolean }
  | { type: 'POINTER_UP'; pointerId: number; overDismiss: boolean; canDismiss: boolean }
  | { type: 'POINTER_CANCEL'; pointerId: number }
  | { type: 'KEYBOARD_MOVE'; dx: number }
  | { type: 'JUMP' }
  | { type: 'JUMP_END' }

const clearedDrag = {
  pointerId: null,
  dx: 0,
  dy: 0,
  lastX: 0,
  lastY: 0,
  moved: false,
}

export const desktopPetMachine = setup({
  types: {
    context: {} as DesktopPetContext,
    events: {} as DesktopPetEvent,
  },
  guards: {
    matchesPointer: ({ context, event }) =>
      'pointerId' in event && context.pointerId === event.pointerId,
    overDismissZone: ({ context, event }) =>
      event.type === 'POINTER_MOVE' && context.pointerId === event.pointerId && event.overDismiss,
    shouldJumpOnRelease: ({ context, event }) =>
      event.type === 'POINTER_UP'
      && context.pointerId === event.pointerId
      && !context.moved
      && !(event.overDismiss && event.canDismiss),
  },
  actions: {
    startDrag: assign(({ event }) => {
      if (event.type !== 'POINTER_DOWN') return {}
      return {
        pointerId: event.pointerId,
        dx: event.dx,
        dy: event.dy,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
      }
    }),
    updateDrag: assign(({ context, event }) => {
      if (event.type !== 'POINTER_MOVE') return {}
      const deltaX = event.clientX - context.lastX
      const deltaY = event.clientY - context.lastY
      return {
        direction: Math.abs(deltaX) > 1 ? (deltaX < 0 ? 'left' : 'right') : context.direction,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: context.moved || Math.abs(deltaX) + Math.abs(deltaY) > 2,
      }
    }),
    clearDrag: assign(clearedDrag),
    updateKeyboardDirection: assign(({ context, event }) => {
      if (event.type !== 'KEYBOARD_MOVE' || event.dx === 0) return {}
      return { direction: event.dx < 0 ? 'left' : 'right' }
    }),
  },
}).createMachine({
  id: 'desktopPet',
  initial: 'idle',
  context: {
    direction: 'right',
    ...clearedDrag,
  },
  states: {
    idle: {
      on: {
        POINTER_DOWN: {
          target: 'dragging.normal',
          actions: 'startDrag',
        },
        JUMP: {
          target: 'jumping',
        },
        KEYBOARD_MOVE: {
          actions: 'updateKeyboardDirection',
        },
      },
    },
    jumping: {
      on: {
        JUMP_END: {
          target: 'idle',
        },
        POINTER_DOWN: {
          target: 'dragging.normal',
          actions: 'startDrag',
        },
        KEYBOARD_MOVE: {
          actions: 'updateKeyboardDirection',
        },
      },
    },
    dragging: {
      initial: 'normal',
      exit: 'clearDrag',
      on: {
        POINTER_UP: [
          {
            guard: 'shouldJumpOnRelease',
            target: 'jumping',
          },
          {
            guard: 'matchesPointer',
            target: 'idle',
          },
        ],
        POINTER_CANCEL: {
          guard: 'matchesPointer',
          target: 'idle',
        },
      },
      states: {
        normal: {
          on: {
            POINTER_MOVE: [
              {
                guard: 'overDismissZone',
                target: 'dismissArmed',
                actions: 'updateDrag',
              },
              {
                guard: 'matchesPointer',
                actions: 'updateDrag',
              },
            ],
          },
        },
        dismissArmed: {
          on: {
            POINTER_MOVE: [
              {
                guard: 'overDismissZone',
                actions: 'updateDrag',
              },
              {
                guard: 'matchesPointer',
                target: 'normal',
                actions: 'updateDrag',
              },
            ],
          },
        },
      },
    },
  },
})
