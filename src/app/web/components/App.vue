<template lang="pug">
router-view
</template>
<script lang="ts" setup>
import { onMounted } from 'vue';
import {useMultiplayerStore} from '../stores/multiplayer'
import {useGameStore} from '../stores/game'
import {useMapsStore} from '../stores/maps'
import { useRoomHubStore } from '../stores/room-hub';

const  multiplayerStore = useMultiplayerStore()
const gameStore = useGameStore()
const mapsStore = useMapsStore()

onMounted(() => {
  gameStore.loadConfig()
  if (!gameStore.configFile) {
    gameStore.loadRecommendedConfig()
  }
  gameStore.loadAutoexec()
  if (!gameStore.autoexecFile) {
    gameStore.loadRecommendedAutoexec()
  }

  mapsStore.loadMapListing()
  gameStore.loadAssets()
  gameStore.loadPackages()
  multiplayerStore.refreshLoop()
  useRoomHubStore().refreshLoop()
})
</script>