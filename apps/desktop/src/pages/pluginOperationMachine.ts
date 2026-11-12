import { useCallback, useRef, useState } from 'react'
import { assign, initialTransition, setup, transition } from 'xstate'
import type { SkillRecord } from '@/types/api'

// One capability mutation runs at a time: the Pi settings lock serializes them anyway,
// and a single busy id gives every toggle and remove control the same guard.
export interface PluginOperationContext {
  skillId: string | null
  pendingSkill: SkillRecord | null
  computerUseAlert: string
  mcpSupportAlert: string
  mcpSupportNotice: string
  capabilityAlert: string
}

export type PluginOperationEvent =
  | { type: 'START'; skillId: string }
  | { type: 'FINISH' }
  | { type: 'REQUEST_DISABLE'; skill: SkillRecord }
  | { type: 'REQUEST_REMOVE'; skill: SkillRecord }
  | { type: 'CANCEL_CONFIRM' }
  | { type: 'CONFIRM' }
  | { type: 'SET_COMPUTER_USE_ALERT'; alert: string }
  | { type: 'SET_CAPABILITY_ALERT'; alert: string }
  | { type: 'SET_MCP_SUPPORT_NOTICE'; notice: string }
  | { type: 'SET_MCP_SUPPORT_ALERT'; alert: string }

export const pluginOperationMachine = setup({
  types: { context: {} as PluginOperationContext, events: {} as PluginOperationEvent },
}).createMachine({
  id: 'pluginOperation',
  context: {
    skillId: null,
    pendingSkill: null,
    computerUseAlert: '',
    mcpSupportAlert: '',
    mcpSupportNotice: '',
    capabilityAlert: '',
  },
  initial: 'idle',
  states: {
    idle: {
      on: {
        START: {
          target: 'busy',
          actions: assign(({ event }) => ({
            skillId: event.skillId,
            pendingSkill: null,
            computerUseAlert: '',
            mcpSupportAlert: '',
            mcpSupportNotice: '',
            capabilityAlert: '',
          })),
        },
        REQUEST_DISABLE: {
          target: 'confirmingDisable',
          actions: assign(({ event }) => ({ pendingSkill: event.skill })),
        },
        REQUEST_REMOVE: {
          target: 'confirmingRemove',
          actions: assign(({ event }) => ({ pendingSkill: event.skill })),
        },
        SET_COMPUTER_USE_ALERT: {
          actions: assign(({ event }) => ({ computerUseAlert: event.alert })),
        },
        SET_CAPABILITY_ALERT: {
          actions: assign(({ event }) => ({ capabilityAlert: event.alert })),
        },
      },
    },
    confirmingDisable: {
      on: {
        CANCEL_CONFIRM: {
          target: 'idle',
          actions: assign({ pendingSkill: null }),
        },
        CONFIRM: {
          target: 'idle',
          actions: assign({ pendingSkill: null }),
        },
      },
    },
    confirmingRemove: {
      on: {
        CANCEL_CONFIRM: {
          target: 'idle',
          actions: assign({ pendingSkill: null }),
        },
        CONFIRM: {
          target: 'idle',
          actions: assign({ pendingSkill: null }),
        },
      },
    },
    busy: {
      on: {
        FINISH: {
          target: 'idle',
          actions: assign({ skillId: null }),
        },
        SET_CAPABILITY_ALERT: {
          actions: assign(({ event }) => ({ capabilityAlert: event.alert })),
        },
        SET_MCP_SUPPORT_NOTICE: {
          actions: assign(({ event }) => ({ mcpSupportNotice: event.notice, mcpSupportAlert: '' })),
        },
        SET_MCP_SUPPORT_ALERT: {
          actions: assign(({ event }) => ({ mcpSupportAlert: event.alert, mcpSupportNotice: '' })),
        },
      },
    },
  },
})

export function usePluginOperation() {
  const snapshotRef = useRef(initialTransition(pluginOperationMachine)[0])
  const [snapshot, setSnapshot] = useState(snapshotRef.current)
  const send = useCallback((event: PluginOperationEvent) => {
    const [next] = transition(pluginOperationMachine, snapshotRef.current, event)
    snapshotRef.current = next
    setSnapshot(next)
  }, [])
  // Guards read the ref, not render state, so two clicks in one tick cannot both start.
  const begin = useCallback((skillId: string) => {
    if (!snapshotRef.current.matches('idle')) return false
    send({ type: 'START', skillId })
    return true
  }, [send])
  const finish = useCallback(() => send({ type: 'FINISH' }), [send])
  const requestDisable = useCallback((skill: SkillRecord) => send({ type: 'REQUEST_DISABLE', skill }), [send])
  const requestRemove = useCallback((skill: SkillRecord) => send({ type: 'REQUEST_REMOVE', skill }), [send])
  const cancelConfirm = useCallback(() => send({ type: 'CANCEL_CONFIRM' }), [send])
  const confirm = useCallback(() => send({ type: 'CONFIRM' }), [send])
  const setComputerUseAlert = useCallback((alert: string) => send({ type: 'SET_COMPUTER_USE_ALERT', alert }), [send])
  const setCapabilityAlert = useCallback((alert: string) => send({ type: 'SET_CAPABILITY_ALERT', alert }), [send])
  const setMcpSupportNotice = useCallback((notice: string) => send({ type: 'SET_MCP_SUPPORT_NOTICE', notice }), [send])
  const setMcpSupportAlert = useCallback((alert: string) => send({ type: 'SET_MCP_SUPPORT_ALERT', alert }), [send])

  return {
    busyId: snapshot.context.skillId,
    confirmDisable: snapshot.matches('confirmingDisable') ? snapshot.context.pendingSkill : null,
    confirmRemove: snapshot.matches('confirmingRemove') ? snapshot.context.pendingSkill : null,
    computerUseAlert: snapshot.context.computerUseAlert,
    mcpSupportAlert: snapshot.context.mcpSupportAlert,
    mcpSupportNotice: snapshot.context.mcpSupportNotice,
    capabilityAlert: snapshot.context.capabilityAlert,
    begin,
    finish,
    requestDisable,
    requestRemove,
    cancelConfirm,
    confirm,
    setComputerUseAlert,
    setCapabilityAlert,
    setMcpSupportNotice,
    setMcpSupportAlert,
  }
}
