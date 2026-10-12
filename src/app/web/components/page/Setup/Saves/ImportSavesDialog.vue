<template lang="pug">
.modal-overlay(@click.self="emit('cancel')")
  .modal-container
    .modal-header
      span.modal-title Import {{ items.length === 1 ? 'save' : items.length + ' saves' }}
      button.modal-close(@click="emit('cancel')")
        font-awesome-icon(icon="fa-solid fa-xmark")
    .modal-body
      .import-row(v-for="(item, i) in items" :key="i")
        .import-source
          span.import-title {{ item.header.title || item.header.map }}
          span.import-detail {{ item.header.map }} · from {{ item.sourceName }}
        .import-fields
          .field
            label.field-label Campaign
            select.field-input(v-model="item.dir")
              option(:value="null" disabled) Choose…
              option(v-for="dir in orderedDirs(item)" :key="dir" :value="dir") {{ dirName(dir) }}
            p.field-hint.warn(v-if="item.dir == null && item.candidates.length === 0") Couldn't tell which campaign this map belongs to
            p.field-hint.warn(v-else-if="item.dir == null") This map exists in more than one campaign
          .field
            label.field-label Save as
            select.field-input(v-model="item.target")
              option(v-if="slotIndex(item.fileName) == null" :value="item.fileName") Keep name: {{ stripExt(item.fileName) }}
              option(v-for="n in MENU_SLOTS" :key="n" :value="slotFileName(n - 1)") Slot {{ n }} (s{{ n - 1 }})
            p.field-hint.warn(v-if="overwrites(item)") Replaces {{ overwrites(item) }}
            p.field-hint.warn(v-else-if="duplicateTarget(item)") Another file in this import targets the same slot
            p.field-hint(v-else-if="slotIndex(item.target) == null") Not a menu slot: load it from the console with load {{ stripExt(item.target) }}
    .modal-footer
      button.btn-ghost-sm(@click="emit('cancel')") Cancel
      button.btn-save(:disabled="!ready" @click="emit('confirm', items)") Import
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { PackageMeta } from '../../../../../../shared/types/Store'
import {
  type SaveEntry, type SaveHeader,
  MENU_SLOTS, slotIndex, slotFileName, stripExt, gameDisplayName, saveLabel,
} from '../../../../helpers/saves'

export type ImportItem = {
  sourceName: string
  /** Chosen directory; null until the player picks one. */
  dir: string | null
  /** Directories the map was found in, listed first in the picker. */
  candidates: string[]
  /** Name the file carried in; the default target. */
  fileName: string
  /** Name it will be stored under. */
  target: string
  header: SaveHeader
  data: ArrayBuffer
}

const props = defineProps<{
  items: ImportItem[]
  dirs: string[]
  packages: PackageMeta[]
  entries: SaveEntry[]
}>()

const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'confirm', items: ImportItem[]): void
}>()

const dirName = (dir: string) => gameDisplayName(dir, props.packages)

const orderedDirs = (item: ImportItem) =>
  [...item.candidates, ...props.dirs.filter(d => !item.candidates.includes(d))]

const overwrites = (item: ImportItem): string | null => {
  if (item.dir == null) return null
  const existing = props.entries.find(e => e.meta.game === item.dir && e.meta.fileName === item.target)
  if (!existing) return null
  const title = existing.header?.title || existing.header?.map
  return title ? `${saveLabel(item.target)}: ${title}` : saveLabel(item.target)
}

const duplicateTarget = (item: ImportItem) =>
  props.items.some(other => other !== item && other.dir === item.dir && other.target === item.target)

const ready = computed(() =>
  props.items.every(item => item.dir != null && !duplicateTarget(item)))
</script>

<style lang="scss" scoped>
@import '../../../../scss/tokens';

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.modal-container {
  background: $palette-surface;
  border: $border-subtle;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  margin: 0 16px;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: $border-subtle;
}

.modal-title {
  font-size: $font-base;
  font-weight: $fw-bold;
  color: $palette-bright;
}

.modal-close {
  background: none;
  border: none;
  cursor: pointer;
  color: $palette-muted;
  font-size: $font-base;
  padding: 4px;
  transition: $transition-color;
  &:hover { color: $palette-bright; }
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

.import-row {
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: $border-subtle;
  &:last-child { padding-bottom: 0; margin-bottom: 0; border-bottom: none; }
}

.import-source {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.import-title {
  font-size: $font-sm;
  color: $palette-bright;
}

.import-detail {
  font-size: $font-2xs;
  color: $palette-muted;
  font-family: 'JetBrains Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field { min-width: 0; }

.field-label {
  display: block;
  font-size: $font-xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-labels;
  color: $palette-muted;
  margin-bottom: 6px;
}

.field-input {
  width: 100%;
  background: $palette-body;
  border: $border-subtle;
  color: $palette-text;
  font-family: 'JetBrains Mono', monospace;
  font-size: $font-sm;
  padding: 8px 12px;
  outline: none;
  &:focus { border-color: $palette-muted; }
}

.field-hint {
  font-size: $font-2xs;
  color: $palette-muted;
  margin-top: 6px;
  &.warn { color: $palette-red; }
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: $border-subtle;
}

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
}

.btn-save {
  font-family: inherit;
  font-size: $font-xs;
  font-weight: $fw-bold;
  letter-spacing: $tracking-links;
  text-transform: uppercase;
  padding: 7px 16px;
  background: $palette-red;
  color: $palette-bright;
  border: none;
  cursor: pointer;
  transition: $transition-bg;
  &:hover:not(:disabled) { background: lighten($palette-red, 6%); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

@media (max-width: 480px) {
  .import-fields { grid-template-columns: 1fr; }
}
</style>
