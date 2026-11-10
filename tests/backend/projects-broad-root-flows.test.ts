import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createGitWorktree: vi.fn(),
  listGitWorktrees: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  validateGitBranch: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: mocks.showOpenDialog, showSaveDialog: mocks.showSaveDialog },
}))

vi.mock('../../apps/desktop/electron/main/git', () => ({
  createGitWorktree: mocks.createGitWorktree,
  isNotARepositoryFailure: () => false,
  listGitWorktrees: mocks.listGitWorktrees,
  validateGitBranch: mocks.validateGitBranch,
}))

import { ProjectService } from '../../apps/desktop/electron/main/projects'
import { JsonStateStore } from '../../apps/desktop/electron/main/store'
import { MAX_WORKSPACE_IMAGE_BYTES, readWorkspaceImage } from '../../apps/desktop/electron/main/workspace-image'

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

const dirs: string[] = []

function folderIdentity(path: string) {
  const info = lstatSync(path, { bigint: true })
  return {
    dev: info.dev.toString(),
    ino: info.ino.toString(),
    birthtimeNs: info.birthtimeNs > 0n ? info.birthtimeNs.toString() : undefined,
  }
}

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'gooeypi-broad-flows-'))
  const root = join(dataDir, 'project')
  dirs.push(dataDir)
  const store = new JsonStateStore(join(dataDir, 'state.json'))
  const service = new ProjectService(store, () => null)
  return { dataDir, root, service, store }
}

async function authorizeNarrowProject(root: string, service: ProjectService, store: JsonStateStore): Promise<void> {
  mkdirSync(root)
  const canonical = realpathSync(root)
  const now = new Date().toISOString()
  await store.update((state) => { state.projects.push({
    id: 'narrow-project', harness: 'pi', name: 'Narrow project', path: canonical, folders: [canonical], primaryFolder: canonical,
    pinned: false, createdAt: now, lastOpenedAt: now, folderIdentities: { [canonical]: folderIdentity(canonical) },
  }) })
  await service.list()
}

beforeEach(() => {
  mocks.createGitWorktree.mockReset().mockResolvedValue(undefined)
  mocks.listGitWorktrees.mockReset().mockResolvedValue([])
  mocks.showOpenDialog.mockReset()
  mocks.showSaveDialog.mockReset()
  mocks.validateGitBranch.mockReset().mockResolvedValue('feature')
})

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('broad-root flow boundaries', () => {
  it('rejects an inferred filesystem-root grant before session discovery or persistence', async () => {
    const { service, store } = setup()
    const filesystemRoot = realpathSync(resolve('/'))

    await expect(service.grantInferred(filesystemRoot)).rejects.toThrow(/Broad filesystem roots cannot be inferred as projects/)
    expect(store.snapshot().projects).toEqual([])
  })

  it('rejects a broad linked worktree at the central grant boundary', async () => {
    const { root, service, store } = setup()
    await authorizeNarrowProject(root, service, store)
    const filesystemRoot = realpathSync(resolve('/'))
    mocks.listGitWorktrees.mockResolvedValue([
      { path: realpathSync(root), name: 'project', branch: 'main', head: 'a'.repeat(40), current: true, detached: false },
      { path: filesystemRoot, name: 'root', branch: 'unsafe', head: 'b'.repeat(40), current: false, detached: false },
    ])

    await expect(service.adoptCheckoutWorktree('narrow-project', root, filesystemRoot)).rejects.toThrow(/Broad filesystem roots cannot be added as projects/)
    expect(store.snapshot().projects).toHaveLength(1)
  })

  it('rejects a broad create-worktree destination before invoking Git', async () => {
    const { root, service, store } = setup()
    await authorizeNarrowProject(root, service, store)
    mocks.listGitWorktrees.mockResolvedValue([
      { path: realpathSync(root), name: 'project', branch: 'main', head: 'a'.repeat(40), current: true, detached: false },
    ])
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: realpathSync(homedir()) })

    await expect(service.chooseCheckoutWorktreePath(root, 'feature', await mocks.listGitWorktrees())).rejects.toThrow(/Broad filesystem roots cannot be added as worktrees/)
    expect(mocks.createGitWorktree).not.toHaveBeenCalled()
    expect(store.snapshot().projects).toHaveLength(1)
  })
})

describe('readWorkspaceImage workspace boundaries', () => {
  it('reads authorized workspace images via relative path, absolute/file URL, and percent-encoded query/hash path', async () => {
    const { root, service, store } = setup()
    await authorizeNarrowProject(root, service, store)
    const assetsDir = join(root, 'assets')
    mkdirSync(assetsDir, { recursive: true })
    const plainPng = join(assetsDir, 'tiny.png')
    const spacedPng = join(assetsDir, 'tiny icon.png')
    writeFileSync(plainPng, TINY_PNG)
    writeFileSync(spacedPng, TINY_PNG)

    const expected = {
      type: 'image',
      mimeType: 'image/png',
      data: TINY_PNG.toString('base64'),
    }

    for (const input of [
      'assets/tiny.png',
      plainPng,
      pathToFileURL(plainPng).href,
      'assets/tiny%20icon.png?v=1#preview',
      'assets/bad%ZZ.png',
    ]) {
      if (input === 'assets/bad%ZZ.png') writeFileSync(join(assetsDir, 'bad%ZZ.png'), TINY_PNG)
      await expect(readWorkspaceImage(service, root, input)).resolves.toEqual(expected)
    }
  })

  it('rejects unauthorized cwd, lexical/junction workspace escapes, invalid URLs, and invalid image targets', async () => {
    const { dataDir, root, service, store } = setup()
    await authorizeNarrowProject(root, service, store)

    const outsideDir = join(dataDir, 'outside')
    mkdirSync(outsideDir, { recursive: true })
    const outsidePng = join(outsideDir, 'secret.png')
    writeFileSync(outsidePng, TINY_PNG)

    const escapeLink = join(root, 'escape-link')
    symlinkSync(outsideDir, escapeLink, process.platform === 'win32' ? 'junction' : 'dir')

    const noteSvg = join(root, 'vector.svg')
    writeFileSync(noteSvg, '<svg/>')

    const emptyPng = join(root, 'empty.png')
    writeFileSync(emptyPng, '')

    const hugePng = join(root, 'huge.png')
    writeFileSync(hugePng, TINY_PNG)
    truncateSync(hugePng, MAX_WORKSPACE_IMAGE_BYTES + 1)

    const dirPng = join(root, 'folder.png')
    mkdirSync(dirPng)

    const cases: Array<[string, string, string, RegExp]> = [
      ['unauthorized cwd', outsideDir, outsidePng, /path is not inside an added Pi Work project/],
      ['empty query-only path', root, '?only-query', /The image path is empty/],
      ['outside lexical path', root, '../outside/secret.png', /The image path is outside the active workspace/],
      ['directory junction/symlink escaping workspace', root, 'escape-link/secret.png', /The image path resolves outside the active workspace/],
      ['remote URL', root, 'https://example.com/tiny.png', /Remote or non-file image URLs are not supported/],
      ['invalid file URL', root, 'file://bad%ZZ/tiny.png', /The image URL is not a valid local file URL/],
      ['NUL byte path', root, 'tiny%00.png', /The image path contains a NUL byte/],
      ['unsupported extension', root, noteSvg, /Unsupported workspace image extension/],
      ['directory with raster suffix', root, dirPng, /The image path is not a regular file/],
      ['empty file', root, emptyPng, /The workspace image file is empty/],
      ['oversized file', root, hugePng, /The workspace image is too large to display/],
    ]

    for (const [label, cwd, target, pattern] of cases) {
      await expect(readWorkspaceImage(service, cwd, target), label).rejects.toThrow(pattern)
    }
  })
})
