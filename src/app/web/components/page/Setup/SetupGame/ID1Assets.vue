<template lang="pug">
.base-assets.container
  .pack-upload(v-if="!packOne || !packZero")
    PakUpload.test2( @uploadFiles="uploadFilesRequest" :loading="model.loading")
  .columns
    .column.col-12.mb-2
      h5(v-if="assetMetas.length") Loaded Id1 packs:
        
      h5(v-else) No packs loaded
      Asset(v-for="meta in assetMetas"
        :assetMeta="meta"
        :key="meta.filename"
        :label="meta.filename"
        game="id1")
</template>

<script lang="ts" setup>
import {reactive, onMounted, computed, watch} from 'vue'
import Asset from './Asset.vue'
import PakUpload from './PakUpload.vue'
import { useGameStore } from '../../../../stores/game';
import {isId1Pak1, readPackFile} from '../../../../helpers/assetChecker'

import { useToast } from "vue-toastification";

const toast = useToast();
type FileWithData = {fileName: string, data: ArrayBuffer}
const emit = defineEmits<{
  (e: 'uploaded', uploadedFiles: any): void}
>()
const gameStore = useGameStore()

const readFile = async (file: File): Promise<FileWithData> => {
  return new Promise((resolve, reject) => {
    const fileName = file.name
    const reader = new FileReader()
    reader.onloadend = loadEvt => {
      resolve({
        fileName,
        data: loadEvt.target!.result as ArrayBuffer
      })
    }
    reader.onerror = (e) => reject(e)
    reader.readAsArrayBuffer(file)
  })
}

const model = reactive<{loading: boolean}>({loading: false})

const assetMetas = computed(() => gameStore.assetMetas.filter(am => am.game === 'id1' && (am.fileName.toLowerCase() === 'pak0.pak' || am.fileName.toLowerCase() === 'pak1.pak')))
const packOne = computed(() => assetMetas.value.find(am => am.fileName.toLowerCase() === 'pak1.pak'))
const packZero = computed(() => assetMetas.value.find(am => am.fileName.toLowerCase() === 'pak0.pak'))
const processReadFile = async ({fileName, data}: FileWithData) => {
  const packFiles = readPackFile(data)
  if (packFiles.length === 0) {
    throw new Error("Not a valid quake pak file")
  }
  if (fileName.toLowerCase() === 'pak1.pak' && !isId1Pak1(packFiles, data)) {
    throw new Error("Pak1.pak is not the original registered quake pak")
  }
  
  return gameStore.saveAsset({game: 'id1', fileName, fileCount: packFiles.length, data})
}

const uploadFilesRequest = async (files: File[]) => {
  model.loading = true
  
  const promises = files.map(async file => {
    try {
      const fileObj = await readFile(file)
      await processReadFile(fileObj)
      if (file.name.toLowerCase() === 'pak1.pak') {
        toast.success("Successfully added pak1.pak");
      }
      return file.name
    } catch (e) {
      toast.warning(e.message);
      console.log(e)
    }
  });

  const uploadedFiles = (await Promise.all(promises)).filter(f => !!f)

  emit('uploaded', uploadedFiles)
  model.loading = false
}
</script>
