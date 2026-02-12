
<template lang="pug">
.game-container
  .loading.loading-lg(v-if="model.loading")
  template(v-else-if="needsMapDownload")
    MapLoader(:game="game" @done="model.mapLoaded = true")
  template(v-else)
    Game(@quit="gameQuit" :quitRequest="model.isQuitting")
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import type { QuaddictedMap } from '../../../types/QuaddictedMap';
import { joinRoom } from './roomJoin';
import type { RoomId } from '../../../types/Room';
import { useRoomStore } from '../../../stores/room';

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
import Game from '../../page/Game/Game.vue'
import MapLoader from '../../page/Game/MapLoader.vue'
import {reactive, onMounted, computed, watch, ref} from 'vue'
import GameInit from '../../../../game'
import { useGameStore } from '../../../stores/game';
import { useMapsStore } from '../../../stores/maps';
import {  useRoute, onBeforeRouteLeave, useRouter } from 'vue-router';
import { mapState } from 'pinia';

const router = useRouter()
const route = useRoute()
const roomId = route.params.roomId as RoomId
const gameStore = useGameStore()
const mapsStore = useMapsStore()
const quitToPath = ref(`/room/${roomId}`)

const model = reactive<{
  map: QuaddictedMap | null,
  loading: boolean,
  mapLoaded: boolean,
  isQuitting: boolean,
}>({
  map: null,
  loading: true,
  mapLoaded: false,
  isQuitting: false,
})

const roomStore = useRoomStore()
const game = computed(() => route.query && route.query['-game'] as string)
const needsMapDownload = computed(() => !model.mapLoaded && game.value && model.map && !gameStore.hasGame(game.value))

const gameQuit = (reason?: string) => {
  model.isQuitting = true
  const query = reason ? '?message=' + btoa(reason) : ''
  router.push(quitToPath.value + query)

  // This used to be here to "reload" the entire app, forcing cleanup
  // when webgl didn't cleanup correctly. Not sure it's necessary anymore
  // Downside is we lose router history and the ability to "go back"
  // window.location.href = quitToPath.value
}

onMounted(async () => {
  await joinRoom(
    route.params.roomId as RoomId, 
    router, 
    roomStore
  )
  await mapsStore.loadMapListing()
    .then(() => {
      if (game.value) {
        model.map = mapsStore.getMapFromId(game.value)
      }
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
    model.isQuitting = true
  } else {
    next(false)
  }
})

defineExpose({
  quitToPath
})
</script>
