<template lang="pug">
.package(
  :class="{ dragging: model.dragActive }"
  @drop.prevent="handleFileDrop"
  @dragover.prevent="model.dragActive = true"
  @dragenter.prevent="model.dragActive = true"
  @dragleave.prevent="model.dragActive = false"
)
  .header.h6
    .expandable
      button.btn.btn-action.btn-sm(@click="toggleExpand")
        i.icon(:class="model.expanded ? 'icon-arrow-up' : 'icon-arrow-down'" style="margin: .3rem")
    .title {{props.package.name}}
    .actions
      input.file-input(
        ref="fileInput"
        type="file"
        multiple
        accept=".pak,.mdl,.bsp,.txt,.cfg,.dat,.spr,.lit,.map,.wav,.tga,.lmp"
        @change="handleFileSelect"
        style="display: none"
      )
      button.btn.btn-action.btn-sm.add-file(
          v-if="source === 'custom'"
          @click="onAddFile"
          v-tippy
          content="Add File to Package"
        )
        i.icon.icon-plus
      button.btn.btn-action.btn-sm.remove(
        @click="onRemovePackage"
        v-tippy
        content="Remove Package"
      )
        i.icon.icon-cross
  .package-files(v-if="model.expanded")
    PackageFile(
      v-for="customAsset in model.metaList"
      :source="source"
      :asset="customAsset" 
      @remove="onRemoveAsset(customAsset)"
      @edit="onEditAsset(customAsset, $event)"
    )

</template>


<script lang="ts" setup>
import PackageFile from './PackageFile.vue'
import {reactive, computed, watch, ref} from 'vue'
import { useGameStore } from '../../../../../stores/game';
import { useMapsStore } from '../../../../../stores/maps';
import type { AssetMeta, PackageMeta } from '../../../../../../../shared/types/Store';
import * as indexedDb from '../../../../../../../shared/indexeddb';
import { useToast } from 'vue-toastification';

interface Props {
  package: PackageMeta
}

const props = defineProps<Props>()

const emit = defineEmits<{
  (e: 'remove', packageId: number): void
  (e: 'edit', packageId: number): void
}>()

const gameStore = useGameStore()
const mapsStore = useMapsStore()
const model = reactive<{
  expanded: boolean
  metaList: Array<AssetMeta>,
  dragActive: boolean
}>({
  expanded: false,
  metaList: [],
  dragActive: false
})

const source = computed(() => props.package.sourceId.split(':')[0])
const fileInput = ref<HTMLInputElement>();
const toast = useToast();
const toggleExpand = () => model.expanded = !model.expanded

const onRemovePackage = async () => {
  if (!confirm(`Are you sure you want to delete the package "${props.package.name}"?`)) {
    return;
  }
  
  emit('remove', props.package.packageId)
}

const onRemoveAsset = async (asset: AssetMeta) => {
  if (!confirm(`Are you sure you want to delete "${asset.fileName}"?`)) {
    return;
  }
  
  try {
    await indexedDb.removeAsset(asset.assetId.toString());
    await loadAssetList();
    await gameStore.loadAssets();
  } catch (error) {
    console.error('Failed to delete asset:', error);
    toast.warning(`Failed to delete ${asset.fileName}`, { timeout: 5000 });
  }
}

const onEditAsset = async (asset: AssetMeta, fileName: string) => {
  // Check if filename already exists in this package
  const existingAsset = model.metaList.find(a => 
    a.assetId !== asset.assetId && 
    a.fileName.toLowerCase() === fileName.toLowerCase()
  );
  
  if (existingAsset) {
    toast.warning(`A file named "${fileName}" already exists in this package`, { timeout: 5000 });
    return;
  }
  
  try {
    await indexedDb.updateAssetFileName(asset.assetId, fileName);
    await loadAssetList();
    await gameStore.loadAssets();
  } catch (error) {
    console.error('Failed to update filename:', error);
    toast.warning(`Failed to update ${asset.fileName}`, { timeout: 5000 });
  }
}

const onAddFile = () => {
  fileInput.value?.click();
}

const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files?.length) {
    uploadFiles(Array.from(target.files));
  }
}

const handleFileDrop = (event: DragEvent) => {
  event.stopPropagation();
  model.dragActive = false;
  
  if (event.dataTransfer && event.dataTransfer.items) {
    const files = Array.from(event.dataTransfer.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter(file => !!file);
      
    if (files.length) {
      uploadFiles(files as File[]);
    }
  } else if (event.dataTransfer?.files.length) {
    uploadFiles(Array.from(event.dataTransfer.files));
  }
}

const fixFileName = (fileName: string): string => {
  const lowCase = fileName.toLowerCase();
  const extension = lowCase.split('.').pop();
  switch(extension) {
    case 'mdl':
    case 'spr':
      return `progs/${fileName}`;
    case 'bsp':
    case "map":
    case "lit":
      return `maps/${fileName}`;
    case "wav":
      return `sound/${fileName}`;
    case "tga":
    case "lmp":
      return `gfx/${fileName}`;
    case 'pak':
    case 'txt':
    case 'dat':
    case 'cfg':
      return fileName
    default:
      return fileName
  }
}

const uploadFiles = async (files: File[]) => {
  try {
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const fileName = fixFileName(file.name);
      await indexedDb.saveAsset(
        props.package.gameDir,
        fileName,
        file.size,
        arrayBuffer,
        props.package.packageId
      );
    }
    
    await loadAssetList();
    await gameStore.loadAssets();
  } catch (error) {
    console.error('Failed to add files:', error);

    toast.warning(`Failed to add files: ${error.message}`, { timeout: 5000 });
  }
}

const loadAssetList = async () => {
  model.metaList = await indexedDb.getAllMetaPerPackageId(props.package.packageId)
}

watch(model, (newModel) => {
  if (newModel.expanded) {
    loadAssetList()
  }
})
</script>

<style scoped lang="scss">
@import '../../../../../scss/colors.scss';

.package {
  border-top: 1px solid grey;
  
  .actions {
    display: flex;
    justify-content: flex-end;
  }
  &.dragging {
    background-color: lighten($body-bg, 20%);
    border: 2px dashed $border-color;
  }
}
.header {
  display: grid;
  grid-template-columns: 2rem 1fr 6rem;
  overflow: auto;
  padding: .5rem 0 .5rem .5rem;
  scrollbar-gutter: stable;

  .btn.remove {
    color: #ff0000;
  }

  &:hover  {
    background-color: lighten($body-bg, 10%);
  }
  &:not(:hover) {
    .actions .btn {
      color: lighten($body-bg, 15%);;
      background-color: lighten($body-bg, 5%);
    }
    .actions i {
      color: lighten($body-bg, 15%);;
    }
  }
}
.file-table {
  width: 100%;
}
.package-files {
  display: block;
  overflow: auto;
  max-height: 15rem;
  
  scrollbar-gutter: stable;
}


</style>