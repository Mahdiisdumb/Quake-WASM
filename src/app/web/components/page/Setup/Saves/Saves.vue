<template lang="pug">
.saves-section
  .header-row
    span.section-label Saved games
    .header-actions
      button.btn-ghost-sm(:disabled="entries.length === 0 || model.exporting" @click="exportAll") Export all

  .drop-zone(
    :class="{ active: model.dragOver }"
    @drop.prevent="handleDrop"
    @dragover.prevent="model.dragOver = true"
    @dragenter.prevent="model.dragOver = true"
    @dragleave.prevent="model.dragOver = false"
    @click="fileInput?.click()"
  )
    input.hidden-file-input(
      ref="fileInput"
      type="file"
      multiple
      accept=".sav,.zip"
      @change="handleFileSelect"
    )
    template(v-if="model.importing")
      .drop-zone-progress
        span.import-label Reading…
        .import-track
          .import-fill.indeterminate
    template(v-else)
      span.drop-zone-text Drop .sav files or an exported saves .zip here to import
      span.drop-zone-hint Or click to browse

  .group(v-for="group in groups" :key="group.dir" :class="{ open: isOpen(group.dir) }")
    .group-header(
      role="button"
      tabindex="0"
      :aria-expanded="isOpen(group.dir)"
      @click="toggle(group.dir)"
      @keydown.enter.self.prevent="toggle(group.dir)"
      @keydown.space.self.prevent="toggle(group.dir)"
    )
      font-awesome-icon.group-chevron(icon="fa-solid fa-chevron-right")
      span.group-name {{ group.name }}
      span.group-count {{ group.entries.length }} {{ group.entries.length === 1 ? 'save' : 'saves' }}
      button.file-icon-btn(:disabled="model.exporting" @click.stop="exportGroup(group)" title="Export as zip")
        font-awesome-icon(icon="fa-solid fa-download")
    template(v-if="isOpen(group.dir)")
      .file-row(v-for="entry in group.entries" :key="entry.meta.assetId")
        span.save-slot(:title="saveLabel(entry.meta.fileName)") {{ saveLabel(entry.meta.fileName) }}
        .save-info
          template(v-if="entry.header")
            span.save-title {{ entry.header.title || entry.header.map }}
            span.save-detail {{ entry.header.map }} · skill {{ entry.header.skill }} · {{ formatPlayTime(entry.header.time) }}
              template(v-if="entry.header.kills != null")  · {{ entry.header.kills }}/{{ entry.header.totalKills }} kills
          template(v-else-if="headersLoaded.has(group.dir)")
            span.save-title.unreadable Unreadable save
          template(v-else)
            span.save-title.unreadable Loading…
        span.file-size {{ formatFileSize(entry.meta.fileSize ?? 0) }}
        .file-actions
          button.file-icon-btn(@click="downloadEntry(entry)" title="Download")
            font-awesome-icon(icon="fa-solid fa-download")
          button.file-icon-btn.danger(@click="deleteEntry(entry)" title="Delete")
            font-awesome-icon(icon="fa-solid fa-xmark")

  .empty(v-if="!model.loading && groups.length === 0")
    | No saved games yet. Saves you make in-game show up here, and you can import .sav files from another computer or from Quakespasm or Ironwail.

  ImportSavesDialog(
    v-if="model.pending.length > 0"
    :items="model.pending"
    :dirs="knownDirs"
    :packages="gameStore.packages"
    :entries="entries"
    @cancel="model.pending = []"
    @confirm="applyImport"
  )
</template>

<script lang="ts" setup>
import { reactive, ref, computed, onMounted } from 'vue'
import JSZip from '@progress/jszip-esm'
import { useToast } from 'vue-toastification'
import * as indexedDb from '../../../../../../shared/indexeddb'
import type { AssetMeta } from '../../../../../../shared/types/Store'
import { useGameStore } from '../../../../stores/game'
import { formatFileSize } from '../../../../helpers/number'
import { officialGameDefinitions } from '../../../../helpers/games'
import {
  type SaveEntry, type SaveHeader,
  parseSaveHeader, saveLabel, slotIndex, isSaveFile, gameDisplayName, gameDirOf,
  candidateDirsForMap, exportFileName, parseImportName, normalizeLineEndings, formatPlayTime,
  normalizeSaveName, saveVersion, migrateLegacySaves, SAVEGAME_VERSION_KEX,
} from '../../../../helpers/saves'
import ImportSavesDialog, { type ImportItem } from './ImportSavesDialog.vue'

const gameStore = useGameStore()
const toast = useToast()
const fileInput = ref<HTMLInputElement>()

const model = reactive<{
  loading: boolean
  importing: boolean
  exporting: boolean
  dragOver: boolean
  pending: ImportItem[]
}>({ loading: false, importing: false, exporting: false, dragOver: false, pending: [] })

const entries = ref<SaveEntry[]>([])

type Group = { dir: string, name: string, entries: SaveEntry[] }

const byName = (a: SaveEntry, b: SaveEntry) => {
  const sa = slotIndex(a.meta.fileName), sb = slotIndex(b.meta.fileName)
  if (sa != null && sb != null) return sa - sb
  if (sa != null) return -1
  if (sb != null) return 1
  return a.meta.fileName.localeCompare(b.meta.fileName)
}

// Official campaigns first in their menu order, then packages, then anything else.
const dirRank = (dir: string) => {
  const o = officialGameDefinitions.findIndex(d => gameDirOf(d.game) === dir)
  if (o !== -1) return o
  const p = gameStore.packages.findIndex(pkg => pkg.gameDir === dir)
  return p !== -1 ? 100 + p : 1000
}

const groups = computed<Group[]>(() => {
  const map = new Map<string, SaveEntry[]>()
  for (const e of entries.value) {
    const list = map.get(e.meta.game) ?? []
    list.push(e)
    map.set(e.meta.game, list)
  }
  return Array.from(map.entries())
    .map(([dir, list]) => ({ dir, name: gameDisplayName(dir, gameStore.packages), entries: list.sort(byName) }))
    .sort((a, b) => dirRank(a.dir) - dirRank(b.dir) || a.name.localeCompare(b.name))
})

/** Directories a save can be imported into: installed official games, packages, and anything already holding saves. */
const knownDirs = computed<string[]>(() => {
  const dirs = new Set<string>()
  for (const def of officialGameDefinitions) {
    const dir = gameDirOf(def.game)
    if (gameStore.hasGame(dir)) dirs.add(dir)
  }
  for (const pkg of gameStore.packages) dirs.add(pkg.gameDir)
  for (const e of entries.value) dirs.add(e.meta.game)
  return Array.from(dirs).sort((a, b) => dirRank(a) - dirRank(b))
})

// Open accordion sections, and the sections whose save headers have been read.
// Headers need each save's payload, so they are only fetched when a section opens.
const expanded = ref<Set<string>>(new Set())
const headersLoaded = ref<Set<string>>(new Set())

const isOpen = (dir: string) => expanded.value.has(dir)

const loadHeaders = async (dir: string) => {
  if (headersLoaded.value.has(dir)) return
  const list = entries.value.filter(e => e.meta.game === dir)
  await Promise.all(list.map(async entry => {
    const asset = await indexedDb.getAsset(entry.meta.game, entry.meta.fileName)
    entry.header = asset ? parseSaveHeader(asset.data) : null
  }))
  headersLoaded.value = new Set(headersLoaded.value).add(dir)
}

const open = (dir: string) => {
  if (!expanded.value.has(dir)) expanded.value = new Set(expanded.value).add(dir)
  return loadHeaders(dir)
}

const toggle = (dir: string) => {
  if (!expanded.value.has(dir)) return open(dir)
  const next = new Set(expanded.value)
  next.delete(dir)
  expanded.value = next
}

const load = async () => {
  model.loading = true
  try {
    await Promise.all([gameStore.loadAssets(), gameStore.loadPackages()])
    entries.value = gameStore.assetMetas
      .filter((m: AssetMeta) => isSaveFile(m.fileName))
      .map((meta: AssetMeta): SaveEntry => ({ meta, header: null }))
    headersLoaded.value = new Set()
    await Promise.all(Array.from(expanded.value).map(loadHeaders))
  } finally {
    model.loading = false
  }
}

onMounted(async () => {
  try {
    const moved = await migrateLegacySaves()
    if (moved > 0) console.info(`[saves] migrated ${moved} legacy localStorage save(s) to IndexedDB`)
  } catch (e) {
    console.warn('[saves] legacy save migration failed:', e)
  }
  await load()
  if (groups.value.length === 1) open(groups.value[0].dir)
})

// ── Export ────────────────────────────────────────────────────────────────────

const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const downloadEntry = async (entry: SaveEntry) => {
  try {
    const asset = await indexedDb.getAsset(entry.meta.game, entry.meta.fileName)
    if (!asset) throw new Error('missing')
    const header = entry.header ?? parseSaveHeader(asset.data)
    downloadBlob(new Blob([asset.data]), exportFileName(entry.meta.game, entry.meta.fileName, header, gameStore.packages))
  } catch {
    toast.warning(`Failed to download ${entry.meta.fileName}`)
  }
}

// Zip layout is <dir>/<fileName> so an import routes each file without asking.
const exportZip = async (list: SaveEntry[], zipName: string) => {
  model.exporting = true
  try {
    const zip = new JSZip()
    for (const entry of list) {
      const asset = await indexedDb.getAsset(entry.meta.game, entry.meta.fileName)
      if (asset) zip.file(`${entry.meta.game}/${entry.meta.fileName}`, asset.data)
    }
    downloadBlob(await zip.generateAsync({ type: 'blob' }), zipName)
  } catch (err: any) {
    toast.warning(`Export failed: ${err.message}`)
  } finally {
    model.exporting = false
  }
}

const exportGroup = (group: Group) =>
  exportZip(group.entries, `${group.name.replace(/[\\/:*?"<>|]/g, '_')} saves.zip`)

const exportAll = () => exportZip(entries.value, 'netquake saves.zip')

// ── Import ────────────────────────────────────────────────────────────────────

const handleDrop = (e: DragEvent) => {
  model.dragOver = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) stageFiles(files)
}

const handleFileSelect = (e: Event) => {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  if (files.length) stageFiles(files)
}

type RawImport = { sourceName: string, dir: string | null, fileName: string, data: ArrayBuffer }

const unpack = async (files: File[]): Promise<RawImport[]> => {
  const out: RawImport[] = []
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.zip')) {
      const zip = new JSZip()
      await zip.loadAsync(await file.arrayBuffer())
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || !isSaveFile(entry.name)) continue
        const segs = entry.name.split('/').filter(s => s.length > 0)
        const data = await entry.async('arraybuffer')
        if (segs.length >= 2 && knownDirs.value.includes(segs[0].toLowerCase()))
          out.push({ sourceName: entry.name, dir: segs[0].toLowerCase(), fileName: segs.slice(1).join('/').toLowerCase(), data })
        else {
          // Unknown top folder (a game not installed here, or a hand-made zip): the
          // campaign gets asked for, but keep any inner path such as autosave/<map>.
          const named = parseImportName(segs[segs.length - 1], knownDirs.value, gameStore.packages)
          if (named.dir != null || segs.length < 3)
            out.push({ sourceName: entry.name, ...named, data })
          else
            out.push({ sourceName: entry.name, dir: null, fileName: normalizeSaveName(segs.slice(1).join('/')), data })
        }
      }
    } else if (isSaveFile(file.name)) {
      out.push({ sourceName: file.name, ...parseImportName(file.name, knownDirs.value, gameStore.packages), data: await file.arrayBuffer() })
    }
  }
  return out
}

const stageFiles = async (files: File[]) => {
  model.importing = true
  try {
    const raws = await unpack(files)
    if (raws.length === 0) {
      toast.warning('No .sav files found')
      return
    }
    const items: ImportItem[] = []
    let rejected = 0
    let kex = 0
    for (const raw of raws) {
      const data = normalizeLineEndings(raw.data)
      const header: SaveHeader | null = parseSaveHeader(data)
      if (header == null) {
        if (saveVersion(data) === SAVEGAME_VERSION_KEX) kex++
        else rejected++
        continue
      }
      let dir = raw.dir
      const candidates = dir ? [dir] : candidateDirsForMap(header.map, knownDirs.value, gameStore.assetMetas)
      if (dir == null && candidates.length === 1) dir = candidates[0]
      items.push({ sourceName: raw.sourceName, dir, candidates, fileName: raw.fileName, target: raw.fileName, header, data })
    }
    if (kex > 0)
      toast.warning(`${kex} file${kex === 1 ? ' is a save' : 's are saves'} from the Quake re-release, which uses a different format that isn't supported yet`)
    if (rejected > 0)
      toast.warning(`${rejected} file${rejected === 1 ? ' is' : 's are'} not a Quake savegame and will be skipped`)
    model.pending = items
  } catch (err: any) {
    toast.warning(`Import failed: ${err.message}`)
  } finally {
    model.importing = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

const applyImport = async (items: ImportItem[]) => {
  model.pending = []
  let ok = 0
  const touched = new Set<string>()
  for (const item of items) {
    if (item.dir == null) continue
    try {
      await indexedDb.saveAsset(item.dir, item.target, 1, item.data, null)
      // a pre-IndexedDB localStorage copy of this name would shadow the import in-game
      try { localStorage.removeItem(`Quake.${item.dir}/${item.target}`) } catch { /* storage blocked */ }
      touched.add(item.dir)
      ok++
    } catch (err: any) {
      if (err?.name === 'QuotaExceededError') {
        toast.error('Your browser is out of storage space for this site. Free some space (for example by removing unused packages) and try again.')
        break
      }
      toast.warning(`Failed to import ${item.sourceName}`)
    }
  }
  await load()
  await Promise.all(Array.from(touched).map(open))
  if (ok > 0) toast.success(`Imported ${ok} save${ok === 1 ? '' : 's'}`)
}

// ── Delete ────────────────────────────────────────────────────────────────────

const deleteEntry = async (entry: SaveEntry) => {
  const what = entry.header?.title ? `${saveLabel(entry.meta.fileName)} — ${entry.header.title}` : saveLabel(entry.meta.fileName)
  if (!confirm(`Delete ${what}?`)) return
  try {
    await gameStore.removeAsset(String(entry.meta.assetId))
    entries.value = entries.value.filter(e => e !== entry)
  } catch {
    toast.warning(`Failed to delete ${entry.meta.fileName}`)
  }
}
</script>

<style lang="scss" scoped>
@import '../../../../scss/tokens';

.section-label {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-caps;
  color: $palette-muted;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.header-actions { display: flex; gap: 8px; }

.hidden-file-input { display: none; }

.btn-ghost-sm {
  font-family: inherit;
  font-size: $font-xs;
  font-weight: $fw-bold;
  letter-spacing: $tracking-links;
  text-transform: uppercase;
  padding: 7px 16px;
  background: transparent;
  border: $border-subtle;
  color: $palette-muted;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { color: $palette-bright; border-color: $palette-text; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

/* ── Drop zone ── */
.drop-zone {
  border: 1px dashed $palette-border;
  padding: 18px 20px;
  margin-bottom: 24px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  &:hover, &.active {
    border-color: $palette-muted;
    background: rgba(255, 255, 255, 0.02);
  }
  &.active { border-color: $palette-red; }
}

.drop-zone-text { font-size: $font-sm; color: $palette-muted; }
.drop-zone-hint { font-size: $font-2xs; color: $palette-border; }

.drop-zone-progress { width: 100%; display: flex; align-items: center; gap: 12px; }

.import-label {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-caps;
  color: $palette-muted;
  white-space: nowrap;
}

.import-track { flex: 1; height: 2px; background: $palette-border; overflow: hidden; }

.import-fill {
  height: 100%;
  background: $palette-red;
  &.indeterminate { width: 40%; animation: import-slide 1.2s ease-in-out infinite; }
}

@keyframes import-slide {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

/* ── Groups ── */
.group {
  border: $border-subtle;
  margin-bottom: 8px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: $palette-surface;
  cursor: pointer;
  user-select: none;
  &:hover .group-name { color: $palette-bright; }
  &:focus-visible { outline: 1px solid $palette-muted; outline-offset: -1px; }
}

.group.open .group-header { border-bottom: $border-subtle; }

.group-chevron {
  font-size: $font-2xs;
  color: $palette-muted;
  transition: transform 0.15s;
  .group.open & { transform: rotate(90deg); }
}

.group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: $font-sm;
  font-weight: $fw-bold;
  color: $palette-text;
  transition: $transition-color;
  .group.open & { color: $palette-bright; }
}

.group-count {
  font-size: $font-2xs;
  color: $palette-muted;
  font-family: 'JetBrains Mono', monospace;
}

// Fixed name column so titles line up down a section whatever the save is called.
.file-row {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr) auto auto;
  grid-template-areas: "slot info size actions";
  align-items: center;
  column-gap: 14px;
  padding: 9px 16px;
  border-bottom: $border-subtle;
  &:last-child { border-bottom: none; }
  &:hover { background: rgba(255, 255, 255, 0.02); }
}

.save-slot {
  grid-area: slot;
  min-width: 0;
  font-size: $font-xs;
  color: $palette-text;
  font-family: 'JetBrains Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.save-info {
  grid-area: info;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.save-title {
  font-size: $font-sm;
  color: $palette-bright;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  &.unreadable { color: $palette-muted; font-style: italic; }
}

.save-detail {
  font-size: $font-2xs;
  color: $palette-muted;
  font-family: 'JetBrains Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: $font-2xs;
  color: $palette-muted;
  font-family: 'JetBrains Mono', monospace;
  grid-area: size;
  min-width: 64px;
  text-align: right;
  white-space: nowrap;
}

.file-actions { grid-area: actions; display: flex; gap: 4px; }

.file-icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: $font-xs;
  color: $palette-muted;
  padding: 3px 5px;
  transition: $transition-color;
  line-height: 1;
  &:hover        { color: $palette-bright; }
  &.danger:hover { color: $palette-red; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

.empty {
  font-size: $font-sm;
  color: $palette-muted;
  padding: 16px 0;
}

@media (max-width: 768px) {
  .file-row { grid-template-columns: 150px minmax(0, 1fr) auto auto; }
}

// Phones: name on its own line above the details, and text wraps instead of clipping.
@media (max-width: 600px) {
  .header-row { gap: 12px; }
  .drop-zone { text-align: center; }
  .group-header { padding: 10px 12px; gap: 10px; }
  .file-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "slot actions"
      "info actions";
    row-gap: 4px;
    column-gap: 10px;
    padding: 10px 12px;
  }
  .save-slot { color: $palette-muted; }
  .save-title, .save-detail { white-space: normal; overflow-wrap: anywhere; }
  .file-size { display: none; }
  .file-actions { gap: 8px; }
  .file-icon-btn { padding: 8px; font-size: $font-sm; }
  .group-header .file-icon-btn { padding: 6px 8px; }
}
</style>
