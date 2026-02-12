<template lang="pug">
.quaddicted-maps
  .server-error(v-if="!model.loading && !available")
    h5.text-error The map service seems to be down and is currently unvailable :(
  .server-error(v-if="model.loadMapError")
    h6.text-error The map failed to load :(
  Breakout(v-if="!!selectedMap" :map="selectedMap" @play="playMap")
  .search.form-group(v-if="model.loading || available")
    .col-3
      label.form-label(for="maps-search") Search
    .col-9
      input.form-input(type="search" placeholder="Search" v-model="model.search" :disabled="model.loading")
  Table.maps-table(v-if="model.loading || available" :mapList="filteredMaps" v-model="model.selectedMapId" :loading="model.loading")
</template>

<script lang="ts" setup>
import {reactive, onMounted, computed, watch, ref} from 'vue'
import Table from './Table.vue'
import Breakout from './Breakout.vue'
import {find} from 'ramda'
import { useMapsStore } from '../../../../stores/maps'
import { useRouter } from 'vue-router'

const router = useRouter()
const mapStore = useMapsStore()

const model = reactive<{
  search: string,
  selectedMapId: string,
  loading: boolean,
  loadMapError: string
}>({
  search: '',
  selectedMapId: '',
  loading: false,
  loadMapError: ''
})

watch(() => model.selectedMapId, _newVal => {
  model.loadMapError = ''
})



const available = computed(() => mapStore.getMapListing.length > 0)
const selectedMap = computed(() => find(map => map.id === model.selectedMapId, mapStore.getMapListing))
const filteredMaps = computed(() => {
  const searchTerm = (model.search || '').trim().toLowerCase()
  return !searchTerm
    ? mapStore.getMapListing
    : mapStore.getMapListing.filter(map => 
      map.title.toLowerCase().indexOf(searchTerm) > -1 
      || map.author.toLowerCase().indexOf(searchTerm) > -1 
      || map.fileName.toLowerCase().indexOf(searchTerm) > -1
    )
})
onMounted(() => {
  if (!mapStore.getMapListing  || mapStore.getMapListing.length <= 0) {
    model.loading = true
    mapStore.loadMapListing()
      .then(maps => {
        model.loading = false
      })
      .catch(err => {
        model.loading = false
      })
  }
})
const playMap = (mapName: string) => {
  const sourceId = `quaddicted:${model.selectedMapId}` as const
  mapStore.loadMap(sourceId)
    .then((pkgMeta) => {
      const query = {
      
        '+map': mapName,
        'sourceId': sourceId,
        ...(
          pkgMeta.gameDir !== 'id1' 
            ? {'-game': pkgMeta.gameDir }
            : undefined
        )
      }
      router.push({
        name: 'quake', query
      })
    })
    .catch(err => {
      console.error(err)
      model.loadMapError = err.message
    })
}
</script>
<style lang="scss">
.quaddicted-maps {
  min-height: 30rem;
}
</style>