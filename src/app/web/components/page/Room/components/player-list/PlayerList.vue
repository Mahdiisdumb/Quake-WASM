<template lang="pug">
.player-list
  .player(v-for="(player) in sortedPlayers")
    .prefix
      font-awesome-icon.icon(v-if="player.isHost" icon="fa-solid fa-crown" size="xs") 
    .type {{player.type}}
    .name 
      img(v-if="renderedNames[player.name]" :src="renderedNames[player.name]")
      span(v-else) {{player.name}}
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import type { Player } from '../../../../../types/Room';
import { createWriter } from '../../../../../helpers/charmap';

const renderedNames = ref<Record<string, string>>({})
const props = defineProps<{ players: Player[] }>()

const sortedPlayers = computed(() => {
  return props.players.slice().sort((a, b) => {
    // Host first
    if (a.isHost && !b.isHost) return -1
    if (!a.isHost && b.isHost) return 1
    // Then by name
    return a.name.localeCompare(b.name)
  })
})

watch(sortedPlayers, () => {
  createWriter()
    .then(writer => {
      renderedNames.value = sortedPlayers.value.reduce((acc, player) => {
        if (!acc[player.name]) {
          acc[player.name] = writer.write(12, btoa(player.name))  
        }
        return acc
      }, {} as Record<string, string>)
    })
}, {immediate: true})
</script>

<style lang="scss" scoped>
.player {
  display: flex;
  align-items: center;
  .prefix {
    min-width: 1rem;
    display: flex;
    justify-content: center;  
    align-items: center;
  }
  .type {
    margin-right: 5px;
  }
}
</style>