
<template lang="pug">
.game-container
  .loading.loading-lg(v-if="model.loading")
  template(v-else-if="needsMapDownload && !model.mapLoaded")
    MapLoader(:sourceId="sourceId" @done="model.mapLoaded = true")
  template(v-else)
    Game(@quit="gameQuit" :quitRequest="model.isQuitting")
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type { SourceId } from '../../../../../shared/types/Source';

interface IInstance extends ComponentPublicInstance {
  quitToPath: string
}
export default defineComponent({
  beforeRouteEnter(to, from, next) {
    next((vm) => {
      const instance = vm as IInstance
      instance.quitToPath = from.path
    })
  }
})
</script>
<script lang="ts" setup>
import Game from './Game.vue'
import MapLoader from './MapLoader.vue'
import {reactive, onMounted, computed, ref} from 'vue'
import GameInit from '../../../../game'
import { useGameStore } from '../../../stores/game';
import { useMapsStore } from '../../../stores/maps';
import { useRoute, onBeforeRouteLeave, useRouter } from 'vue-router';
import { mapState } from 'pinia';

const router = useRouter()
const route = useRoute()
const gameStore = useGameStore()
const mapsStore = useMapsStore()
const quitToPath = ref('/')

const model = reactive<{
  loading: boolean,
  mapLoaded: boolean,
  isQuitting: boolean,
  onQuit: (() => void) | null,
}>({
  loading: true,
  mapLoaded: false,
  isQuitting: false,
  onQuit: null,
})

const sourceId = computed(() => route.query && route.query['sourceId'] as SourceId)
const needsMapDownload = ref(false)

const gameQuit = (reason?: string) => {
  model.isQuitting = true
  const query = reason ? '?message=' + encodeURIComponent(reason) : ''
  router.push(quitToPath.value + query)

  // This used to be here to "reload" the entire app, forcing cleanup
  // when webgl didn't cleanup correctly. Not sure it's necessary anymore
  // Downside is we lose router history and the ability to "go back"
  // window.location.href = quitToPath.value
}

onMounted(() => {
  if (!sourceId.value) {
    model.loading = false
    return
  }

  mapsStore.loadPackageMeta(sourceId.value)
    .then((pkg) => {
      needsMapDownload.value = !pkg
      model.loading = false
    })
    .catch(() => {
      model.loading = false
    })
})

onBeforeRouteLeave((to, from, next) => {
  if (model.isQuitting) {
    return next()
  }

  const answer = window.confirm('Do you really want to leave?')
  if (answer) {
    model.onQuit = next
    model.isQuitting = true
  } else {
    next(false)
  }
})

defineExpose({
  quitToPath
})
</script>
