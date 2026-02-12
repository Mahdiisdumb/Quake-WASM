<template lang="pug">
.map-select
  select.form-select(@change="$emit('update:modelValue', $event.target.value)")
    option(
      v-for="map in props.mapList"
      :selected="map.name === props.modelValue" 
      :value="map.name"
    ) {{getMapDisplay(map)}}
</template>

<script lang="ts" setup>
import type { MapName, MultiplayerMap } from '../../../../../helpers/games';

const emits = defineEmits<{
  (e: 'update:modelValue', modelValue: MapName): void
}>()

const props = withDefaults(
  defineProps<{
    mapList: MultiplayerMap[]
    modelValue: MapName
  }>(),
  {
    modelValue: ''
  })

const getMapDisplay = (map: MultiplayerMap) => {
  return `${map.title} (${map.name})`
}
</script>