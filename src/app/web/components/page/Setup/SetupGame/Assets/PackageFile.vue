<template lang="pug">
.package-row(@mouseenter="model.hovered = true" @mouseleave="model.hovered = false")
  .filename-edit(v-if="!model.editing") {{ asset.fileName }}
  .filename(v-else)
    input.form-input.asset-filename-input(
      v-model="model.filenameEdit"
      @keyup.enter="onFinishEdit"
      @keyup.esc="onCancelEdit"
      ref="filenameInput"
    )
  .filesize {{ formatFileSize(asset.fileCount) }}
  .actions
    button.btn.btn-action.btn-sm(
      v-if="source === 'custom'"
      @click="onEdit"
        v-tippy
        content="Edit Filename"
      )
      i.icon.icon-edit
    button.btn.btn-action.btn-sm(
        @click="onDownload"
        v-tippy
        content="Download File"
      )
      i.icon.icon-download
    button.btn.btn-action.btn-sm.remove(
        v-if="source === 'custom'"
        @click="onRemove"
        v-tippy
        content="Remove File from Package"
      )
      i.icon.icon-cross
</template> 

<script lang="ts" setup>
import {reactive, computed, watch, nextTick} from 'vue'
import type { AssetMeta } from '../../../../../../../shared/types/Store';
import * as indexedDb from '../../../../../../../shared/indexeddb';
import { formatFileSize } from '../../../../../helpers/number';
import type { Source } from '../../../../../../../shared/types/Source';

const emit = defineEmits<{
  (e: 'edit', fileName: string): void,
  (e: 'remove'): void
}>()

const props = defineProps<{
  source: Source
  asset: AssetMeta
}>()

const model = reactive<{
  hovered: boolean,
  editing: boolean,
  filenameEdit: string
}>({
  hovered: false,
  editing: false,
  filenameEdit: ''
})

const onEdit = async () => {
  model.editing = true
  model.filenameEdit = props.asset.fileName;
  
  // SUrely there's a better way
  // Focus the input field after Vue updates the DOM
  await nextTick();
  const input = document.querySelector('.asset-filename-input') as HTMLInputElement;
  if (input) {
    input.focus();
    input.select();
  }
}

const onDownload =async  () => {
  try {
    const assetData = await indexedDb.getAsset(props.asset.game, props.asset.fileName);
    if (assetData?.data) {
      const blob = new Blob([assetData.data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = props.asset.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    console.error('Failed to download asset:', error);
    alert(`Failed to download ${props.asset.fileName}`);
  }
}

const onFinishEdit = () => {
  const newFileName = model.filenameEdit.trim()
  if (!newFileName) {
    alert('Filename cannot be empty');
    return;
  }
  
  if (newFileName !== props.asset.fileName) {
    emit("edit", model.filenameEdit)
  }
  onCancelEdit()
}

const onCancelEdit = () => {
  model.editing = false
}

const onRemove = () => {
  emit('remove')
}
</script>

<style lang="scss" scoped>
@import '../../../../../scss/colors.scss';

.package-row {
  display: grid;
  grid-template-columns: 1fr 3rem 6rem;
  padding: .2rem 0 0 1rem;

  .actions {
    display: flex;
    justify-content: flex-end;
  }

  &:hover  {
    background-color: lighten($body-bg, 10%);
  }

  .btn.remove {
    color: #ff0000;
  }

  &:not(:hover) {
    .btn {
      color: lighten($body-bg, 15%);;
      background-color: lighten($body-bg, 5%);
    }
    i {
      color: lighten($body-bg, 15%);;
    }
  }
}
</style>