import {
  ArrowsClockwise,
  CaretDown,
  CaretRight,
  Code,
  FileJs,
  FileText,
  Folder,
  FolderOpen,
  MagnifyingGlass,
} from '../icons'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useEffect, useMemo, useRef, useState } from 'react'
import { basename } from '@/lib/data'
import { errorMessage } from '@/lib/errors'
import type { ApexApi, GitStatus, HarnessId, ProjectFileEntry, ProjectRecord } from '@/types/api'
import { Banner } from '@astryxdesign/core/Banner'
import { ApexButton, EmptyState, IconButton, Modal } from '../ui'
import { ContextExcerpt } from '../ContextExcerpt'
import '../task-workflows.css'

function fileManagerName(platform?: NodeJS.Platform): string {
  if (platform === 'darwin') return 'Finder'
  if (platform === 'win32') return 'File Explorer'
  return 'file manager'
}

export interface FileTreeNode {
  id: string
  name: string
  path: string
  fullPath: string
  root: string
  type: 'directory' | 'file'
  children: FileTreeNode[]
  depth: number
}

export function getFileIcon(filename: string) {
  if (filename.endsWith('.json')) {
    return <FileJs size={13} />
  }
  if (
    /\.(tsx?|jsx?|vue|svelte|html|css|scss|py|rs|go|c|cpp|h|java|php|rb|sh|bash|zsh|sql|ya?ml|toml)$/i.test(
      filename,
    )
  ) {
    return <Code size={13} />
  }
  return <FileText size={13} />
}

export function buildTreeFromEntries(
  entries: ProjectFileEntry[],
  root: string,
  baseDepth = 0,
): FileTreeNode[] {
  const rootNodes: FileTreeNode[] = []
  const nodeMap = new Map<string, FileTreeNode>()

  const getOrCreateDir = (dirPath: string): FileTreeNode => {
    const normalized = dirPath.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
    let node = nodeMap.get(normalized)
    if (node) return node

    const lastSlash = normalized.lastIndexOf('/')
    const parentPath = lastSlash === -1 ? '' : normalized.slice(0, lastSlash)
    const name = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1)
    const depth = baseDepth + (normalized ? normalized.split('/').length - 1 : 0)

    node = {
      id: `${root}\0${normalized}`,
      name,
      path: normalized,
      fullPath: `${root}/${normalized}`,
      root,
      type: 'directory',
      children: [],
      depth,
    }
    nodeMap.set(normalized, node)

    if (parentPath) {
      getOrCreateDir(parentPath).children.push(node)
    } else {
      rootNodes.push(node)
    }
    return node
  }

  for (const entry of entries) {
    if (!entry.path) continue
    const normalized = entry.path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
    if (!normalized) continue
    const lastSlash = normalized.lastIndexOf('/')
    const parentPath = lastSlash === -1 ? '' : normalized.slice(0, lastSlash)
    const name = lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1)
    const depth = baseDepth + (lastSlash === -1 ? 0 : normalized.split('/').length - 1)

    let node = nodeMap.get(normalized)
    if (node) {
      node.type = entry.type
    } else {
      node = {
        id: `${root}\0${normalized}`,
        name,
        path: normalized,
        fullPath: `${root}/${normalized}`,
        root,
        type: entry.type,
        children: [],
        depth,
      }
      nodeMap.set(normalized, node)

      if (parentPath) {
        getOrCreateDir(parentPath).children.push(node)
      } else {
        rootNodes.push(node)
      }
    }
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
    })
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortNodes(node.children)
      }
    }
  }

  sortNodes(rootNodes)
  return rootNodes
}

export function buildProjectTree(
  groups: Array<{ root: string; listing: { entries: ProjectFileEntry[]; skipped: number } }>,
  _primaryFolder: string,
): FileTreeNode[] {
  if (groups.length === 0) return []
  if (groups.length === 1) {
    return buildTreeFromEntries(groups[0].listing.entries, groups[0].root, 0)
  }

  return groups.map(({ root, listing }) => ({
    id: root,
    name: basename(root),
    path: '',
    fullPath: root,
    root,
    type: 'directory' as const,
    children: buildTreeFromEntries(listing.entries, root, 1),
    depth: 0,
  }))
}

export function filterFileTree(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return nodes

  const filterNode = (node: FileTreeNode): FileTreeNode | null => {
    const isMatch =
      node.name.toLowerCase().includes(normalized) || node.path.toLowerCase().includes(normalized)
    if (node.type === 'file') {
      return isMatch ? node : null
    }

    const filteredChildren = node.children
      .map(filterNode)
      .filter((child): child is FileTreeNode => child !== null)

    if (isMatch || filteredChildren.length > 0) {
      return {
        ...node,
        children: filteredChildren,
      }
    }
    return null
  }

  return nodes.map(filterNode).filter((node): node is FileTreeNode => node !== null)
}

export function flattenVisibleTree(
  nodes: FileTreeNode[],
  expandedIds: ReadonlySet<string>,
  isSearching: boolean,
): FileTreeNode[] {
  const result: FileTreeNode[] = []
  const traverse = (list: FileTreeNode[]) => {
    for (const node of list) {
      result.push(node)
      if (node.type === 'directory' && node.children.length > 0) {
        const isExpanded = isSearching || expandedIds.has(node.id)
        if (isExpanded) {
          traverse(node.children)
        }
      }
    }
  }
  traverse(nodes)
  return result
}

export function collectDirectoryIds(nodes: FileTreeNode[]): Set<string> {
  const ids = new Set<string>()
  const collect = (list: FileTreeNode[]) => {
    for (const node of list) {
      if (node.type === 'directory') {
        ids.add(node.id)
        collect(node.children)
      }
    }
  }
  collect(nodes)
  return ids
}

// Apply the existing review modal and composer excerpt pattern to current files.
function CurrentFilePreview({ node, harness, onOpen, onClose }: { node: FileTreeNode; harness: HarnessId; onOpen?(path: string): void; onClose(): void }) {
  const [content, setContent] = useState<Awaited<ReturnType<ApexApi['projects']['readTextFile']>>>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let current = true
    setContent(undefined); setError('')
    void (async () => {
      try {
        if (!window.apex) throw new Error('File preview is available in the desktop app.')
        const next = await window.apex.projects.readTextFile(node.root, node.path, harness)
        if (current) setContent(next)
      } catch (reason) { if (current) setError(errorMessage(reason)) }
    })()
    return () => { current = false }
  }, [node.root, node.path, harness, revision])
  return <Modal title={`Current file: ${node.path}`} onClose={onClose} footer={<>
    {onOpen ? <ApexButton onClick={() => onOpen(node.fullPath)}>Open external</ApexButton> : null}
    <ApexButton onClick={onClose}>Close</ApexButton>
  </>}><div className="task-review">
    <p>Current checkout contents, not a saved run snapshot. Select text to attach it to the composer.</p>
    <p>Root: <code>{node.root}</code></p>
    {error ? <><Banner status="error" role="alert" title={`Unable to preview file: ${error}`} /><ApexButton onClick={() => setRevision((value) => value + 1)}>Try again</ApexButton></> : !content ? <p role="status">Loading file…</p> : <>
      {content.truncated ? <p role="note">Preview truncated at 256 KiB. Only the displayed text can be selected. Open external to inspect the complete file.</p> : null}
      {content.text.length ? <ContextExcerpt key={revision} source={`Current file in ${node.root}`} path={content.path} text={content.text} plainText><pre className="task-history-code">{content.text}</pre></ContextExcerpt> : <p>This file is empty.</p>}
    </>}
  </div></Modal>
}

export function FilesPanel({
  project,
  git,
  platform,
  onOpen,
  onReveal,
}: {
  project?: ProjectRecord
  git: GitStatus
  platform?: NodeJS.Platform
  onOpen?(path: string): void
  onReveal(path: string): void
}) {
  const [query, setQuery] = useState('')
  const [treeRoots, setTreeRoots] = useState<FileTreeNode[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [skipped, setSkipped] = useState(0)
  const [visibleLimit, setVisibleLimit] = useState(1_000)
  const loadToken = useRef(0)
  const [selectedFile, setSelectedFile] = useState<FileTreeNode | null>(null)

  const load = async () => {
    const token = ++loadToken.current
    setSelectedFile(null)
    setTreeRoots([])
    setExpandedIds(new Set())
    setError('')
    setSkipped(0)
    setVisibleLimit(1_000)
    if (!project || !window.apex) return
    setLoading(true)
    try {
      const roots = project.folders.length ? project.folders : [project.primaryFolder]
      const groups = await Promise.all(
        roots.map(async (root) => ({
          root,
          listing: await window.apex.projects.listFiles(root, project.harness),
        })),
      )
      if (loadToken.current !== token) return
      setSkipped(groups.reduce((sum, group) => sum + group.listing.skipped, 0))
      const builtTree = buildProjectTree(groups, project.primaryFolder)
      setTreeRoots(builtTree)
    } catch (reason) {
      if (loadToken.current === token) setError(errorMessage(reason))
    } finally {
      if (loadToken.current === token) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    return () => {
      loadToken.current += 1
    }
  }, [project?.id, project?.primaryFolder, project?.folders.join('\0'), project?.harness])

  const changed = useMemo(
    () => new Map(git.files.map((file) => [file.path, file.status])),
    [git.files],
  )

  const isSearching = Boolean(query.trim())
  const filteredTree = useMemo(() => filterFileTree(treeRoots, query), [treeRoots, query])
  const visibleNodes = useMemo(
    () => flattenVisibleTree(filteredTree, expandedIds, isSearching),
    [filteredTree, expandedIds, isSearching],
  )
  const displayedNodes = visibleNodes.slice(0, visibleLimit)

  const allDirIds = useMemo(() => collectDirectoryIds(treeRoots), [treeRoots])

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const collapseAll = () => {
    setExpandedIds(new Set())
  }

  const expandAll = () => {
    setExpandedIds(new Set(allDirIds))
  }

  const managerName = fileManagerName(platform)

  if (!project) {
    return (
      <EmptyState icon={<Folder size={24} />} title="No project files">
        Choose a local project to inspect files.
      </EmptyState>
    )
  }

  return (
    <div className="files-panel">
      {selectedFile ? <CurrentFilePreview key={`${selectedFile.id}:${project.harness}`} node={selectedFile} harness={project.harness} onOpen={onOpen} onClose={() => setSelectedFile(null)} /> : null}
      <div className="files-search">
        <TextInput label="Filter project paths" isLabelHidden value={query} onChange={setQuery} placeholder="Filter project paths" startIcon={<MagnifyingGlass size={13} />} hasClear controlClassName="files-search__input" containerStyle={{ flex: 1, minWidth: 0 }} />
        {!isSearching && allDirIds.size > 0 ? (
          expandedIds.size > 0 ? (
            <IconButton size="small" label="Collapse all folders" onClick={collapseAll}>
              <Folder size={13} />
            </IconButton>
          ) : (
            <IconButton size="small" label="Expand all folders" onClick={expandAll}>
              <FolderOpen size={13} />
            </IconButton>
          )
        ) : null}
        <IconButton size="small" label="Refresh project files" onClick={() => void load()}>
          <ArrowsClockwise className={loading ? 'spin' : ''} size={13} />
        </IconButton>
      </div>

      <div className="file-tree scroll-area">
        <button
          type="button"
          className="tree-root"
          onClick={() => onReveal(project.primaryFolder)}
          title={project.primaryFolder}
        >
          <Folder size={14} />
          <strong>
            {project.folders.length > 1
              ? `${project.folders.length} project folders`
              : basename(project.primaryFolder)}
          </strong>
        </button>

        {loading ? <div className="compact-state" role="status"><EmptyState title="Loading project files…">{null}</EmptyState></div> : null}
        {error ? <Banner status="error" role="alert" title={`Unable to list project files: ${error}`} /> : null}
        {!loading && !error && skipped > 0 ? (
          <p className="file-tree__skipped">
            {skipped} {skipped === 1 ? 'folder' : 'folders'} could not be read and{' '}
            {skipped === 1 ? 'was' : 'were'} skipped.
          </p>
        ) : null}

        {!loading && !error
          ? displayedNodes.map((node) => {
              const isDirectory = node.type === 'directory'
              const isExpanded = isSearching || expandedIds.has(node.id)
              const status =
                node.root === project.primaryFolder ? changed.get(node.path) : undefined

              const statusClassName =
                status === 'M'
                  ? 'file-tree__status--modified'
                  : status === 'A'
                    ? 'file-tree__status--added'
                    : status === 'D'
                      ? 'file-tree__status--deleted'
                      : ''

              return (
                <div key={node.id} className="file-tree__row">
                  <button
                    type="button"
                    className={`file-tree__item ${isDirectory ? 'is-directory' : 'is-file'}`}
                    style={{ paddingLeft: `${8 + node.depth * 14}px` }}
                    title={isDirectory ? node.path || node.name : node.path}
                    aria-expanded={isDirectory ? isExpanded : undefined}
                    onClick={
                      isDirectory
                        ? isSearching
                          ? undefined
                          : () => toggleExpand(node.id)
                        : () => setSelectedFile(node)
                    }
                    onDoubleClick={
                      isDirectory
                        ? (e) => {
                            e.stopPropagation()
                            onReveal(node.fullPath)
                          }
                        : undefined
                    }
                  >
                    {isDirectory ? (
                      <span className="file-tree__chevron">
                        {node.children.length > 0 ? (
                          isExpanded ? <CaretDown size={13} /> : <CaretRight size={13} />
                        ) : (
                          <span className="file-tree__expander-placeholder" />
                        )}
                      </span>
                    ) : (
                      <span className="file-tree__expander-placeholder" />
                    )}
                    <span className="file-tree__icon">
                      {isDirectory ? (
                        isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />
                      ) : (
                        getFileIcon(node.name)
                      )}
                    </span>
                    <span className="file-tree__name">{node.name}</span>
                    {status ? (
                      <small className={`file-tree__status ${statusClassName}`}>{status}</small>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="file-tree__reveal"
                    aria-label={`Reveal ${node.name} in ${managerName}`}
                    title={`Reveal in ${managerName}`}
                    onClick={() => onReveal(node.fullPath)}
                  >
                    <FolderOpen size={13} />
                  </button>
                </div>
              )
            })
          : null}

        {!loading && !error && visibleNodes.length > displayedNodes.length ? (
          <button
            type="button"
            className="file-tree__show-more"
            onClick={() =>
              setVisibleLimit((limit) => Math.min(visibleNodes.length, limit + 1_000))
            }
          >
            Show {Math.min(1_000, visibleNodes.length - displayedNodes.length)} more paths
          </button>
        ) : null}

        {!loading && !error && treeRoots.length > 0 && visibleNodes.length === 0 ? (
          <div className="compact-state"><EmptyState title={query.trim() ? `No files match “${query}”.` : 'No project files found.'}>{null}</EmptyState></div>
        ) : null}

        {!loading && !error && treeRoots.length === 0 ? <div className="compact-state"><EmptyState title="No project files found.">{null}</EmptyState></div> : null}
      </div>
    </div>
  )
}
