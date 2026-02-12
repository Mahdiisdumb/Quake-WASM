<template lang="pug">
.packages
  .package-list(:class="model.loading ? 'loading-lg loading' : ''")
    Package(v-for="(pkg, idx) in gameStore.packages" 
      :package="pkg"
      @remove="removePackage"
      @edit="editPackage")
  .package-new
    button.btn(
      @click="showAddPackageDialog"
        v-tippy
        content="Create a new custom mod/map package")
      i.icon.icon-plus
      | Add Package
  NewPackageDialog(v-if="model.showCreateDialog" @cancel="closeDialog" @create="createPackage($event)")
</template>

<script lang="ts" setup>
import {reactive, computed, onMounted} from 'vue'
import {groupBy, keys, find} from 'ramda'
import { useRouter } from 'vue-router'
import Package from './Package.vue'
import * as indexedDb from '../../../../../../../shared/indexeddb'
import type { AssetMeta, PackageMeta, PackageMetaSeed } from '../../../../../../../shared/types/Store';
import { useGameStore } from '../../../../../stores/game';
import NewPackageDialog from './NewPackageDialog.vue';
import type { SourceId } from '../../../../../../../shared/types/Source';

const router = useRouter()
const gameStore = useGameStore()

const model = reactive<{
  selectedStore: string, 
  loading: boolean,
  showCreateDialog: boolean
}>({
  selectedStore: 'id1', 
  loading: false,
  showCreateDialog: false
})

const generateCustomSourceId = (): SourceId => {
  const randomString = Math.random().toString(36).substring(2, 15)
  return `custom:${randomString}`
}

const loadPackages = () => {
  model.loading = true
  gameStore.loadPackages().then((pkgs) => {
    model.loading = false
  })
}

const showAddPackageDialog = () => {
  model.showCreateDialog = true
}

const closeDialog = () => {
  model.showCreateDialog = false
}

const createPackage = async (newPackage: {name: string, gameDir: string}) => {
  if (!newPackage.name.trim()) return
  if (!newPackage.gameDir.trim()) newPackage.gameDir = 'id1'
  try {
    model.loading = true
    
    const packageSeed: PackageMetaSeed = {
      sourceId: generateCustomSourceId(),
      name: newPackage.name.trim(),
      gameDir: newPackage.gameDir.trim() || 'id1',
      depends: null
    }
    
    const packageId = await indexedDb.savePackage(packageSeed)
    
    closeDialog()
    await loadPackages()
  } catch (error) {
    console.error('Failed to create package:', error)
    alert(`Failed to create package: ${error.message}`)
  } finally {
    model.loading = false
  }
}

const editPackage = (packageId: number) => {
  router.push({ name: 'files', params: { id: packageId.toString() } })
}

const groupedAssets = computed(() => groupBy(e => e.game, gameStore.assetMetas))

const removePackage = async (packageId: number) => {
  await indexedDb.removePackage(packageId)
  await loadPackages()
}

onMounted(() => {
  loadPackages()
})
</script>

<style lang="scss" scoped>
.package-list {
  padding-bottom: 1rem;
}
</style>
