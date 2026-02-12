<template lang="pug">
.server-list
  template(v-if="props.loading")
    .loading.loading-lg
  template(v-else)
    ServerRow(
      v-for="(server, key) in sortedList" 
      :server="server"
      :disabled="isDisabled(server)"
      :shareware="isShareware(server)"
      @join="emit('join', server)")
</template>

<script lang="ts" setup>
import {computed} from 'vue'
import ServerRow from './ServerRow.vue';
import { useGameStore } from '../../../stores/game';
import type { ServerStatus } from '../../../stores/multiplayer';
import { sharewareMaps } from '../../../helpers/map';

const gameStore = useGameStore()
const isShareware = (server: ServerStatus) => !!sharewareMaps.find(m => m === server.map)
const isDisabled = (server: ServerStatus) => !gameStore.hasRegistered && !isShareware(server)

const props = defineProps<{
  loading: boolean,
  servers: Record<string, ServerStatus>
}>()

const emit = defineEmits<{
  (e: 'join', server: ServerStatus): void
}>()
const sortedList = computed(() => 
  Object.values(props.servers)
  .sort((s1, s2) => {
    const s1Disabled = isDisabled(s1)
    const s2Disabled = isDisabled(s2)
    if (s1Disabled === s2Disabled) {
      return 0
    }
    return s1Disabled ? 1 : -1
}))
</script>

<style lang="scss">
.server-list {
  .loading {
    height: 200px;
  }
}
</style>