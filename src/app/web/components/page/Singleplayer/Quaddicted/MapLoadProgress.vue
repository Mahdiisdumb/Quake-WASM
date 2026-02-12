<template lang="pug">
.map-load-progress
  div {{mapsStore.getMapLoadProgress.message}}
  .bar.light-dark(ref="bar")
    .bar-text-dark {{loadedKb}}
    .bar-item(role="progressbar" :style="'width:' + progressPercent+ '%;'" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100")
      .bar-text-light(ref="barHack") {{loadedKb}}
</template>

<script lang="ts" setup>
import {reactive, onMounted, computed, watch, ref} from 'vue'
import { useMapsStore } from '../../../../stores/maps';
import type { QuaddictedMap } from '../../../../types/QuaddictedMap';

const mapsStore = useMapsStore()

const props = defineProps<{map: QuaddictedMap}>()
const addCommas = (x: number) => x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const bar = ref<HTMLElement | null>(null)
const barHack = ref<HTMLElement | null>(null)

const onResize = () => {
  if (barHack.value && bar.value) {
    barHack.value.style.width = bar.value.clientWidth + "px"
  }
}
const loadedKb = computed(() => {
  if (!mapsStore.getMapLoadProgress.total) {
    return ''
  }
  const total = addCommas(Math.floor(mapsStore.getMapLoadProgress.total / 1024))
  const loaded = addCommas(Math.floor(mapsStore.getMapLoadProgress.loaded / 1024))

  return `${loaded} / ${total} KB`
})

const progressPercent = computed(() => {
  if (!mapsStore.getMapLoadProgress.total) {
    return 0
  }
  const total = Math.floor(mapsStore.getMapLoadProgress.total)
  const loaded = Math.floor(mapsStore.getMapLoadProgress.loaded)
  return Math.ceil((loaded / total) * 100)
})

onMounted(() => {
  window.addEventListener('resize', onResize)
  onResize()
})
</script>
<style scoped lang="scss">
// I spent more time on this than I'd like to admit.
.bar.light-dark {
  position: relative;
  .bar-item {
    overflow: hidden;
    position: absolute;
    .bar-text-light {
      position: absolute;
      text-align: right;
      color: white;
      font-size: .6rem;
    }
  }
  .bar-text-dark {
    line-height: 0.8rem;
    height: 0.8rem;
    position: absolute;
    width: 100%;
    text-align: right;
    color: black;
    font-size: .6rem;
  }
}
</style>
