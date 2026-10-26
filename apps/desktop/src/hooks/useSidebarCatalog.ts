import { useCallback, useState, type SetStateAction } from 'react'
import { QueryClient, useQuery } from '@tanstack/react-query'
import type { HarnessId, ProjectRecord, SessionRecord } from '@/types/api'

export const projectCatalogKey = (harness: HarnessId) => ['projects', harness] as const
export const sessionCatalogKey = (harness: HarnessId) => ['sessions', harness, 'all'] as const

export function createCatalogQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: {
    networkMode: 'always',
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  } } })
}

export function useSidebarCatalog(harness: HarnessId, initialProjects: ProjectRecord[], initialSessions: SessionRecord[]) {
  const [queryClient] = useState(createCatalogQueryClient)
  // Bootstrap and filesystem events own refreshes. UI and agent events share
  // this same cache, including optimistic status/attention updates.
  const projects = useQuery({ queryKey: projectCatalogKey(harness), enabled: false, initialData: initialProjects }, queryClient).data
  const sessions = useQuery({ queryKey: sessionCatalogKey(harness), enabled: false, initialData: initialSessions }, queryClient).data
  const setProjects = useCallback((value: SetStateAction<ProjectRecord[]>) => {
    queryClient.setQueryData<ProjectRecord[]>(projectCatalogKey(harness), (current = []) => typeof value === 'function' ? value(current) : value)
  }, [harness, queryClient])
  const setSessions = useCallback((value: SetStateAction<SessionRecord[]>) => {
    queryClient.setQueryData<SessionRecord[]>(sessionCatalogKey(harness), (current = []) => typeof value === 'function' ? value(current) : value)
  }, [harness, queryClient])
  return { queryClient, projects, sessions, setProjects, setSessions }
}
