<template lang="pug">
.game-settings
  .mod
    .title Mode
    .value 
      select.form-select(
        :value="model.gameType" 
        @change="e => setGameType(e.target.value)")
        option(value="dm") DeathMatch
        option(value="coop") Cooperative
        //- option(value="ctf") Capture The Flag

  .map
    .title Map
    .value
      GameSelect(
        v-if="model.gameType === 'coop'"
        :modelValue="gameSelection" 
        @update:modelValue="setGameSelection" 
        :allowedSources="[ 'official' ]" 
        :isRegistered="true")
      DmMapSelect(
        v-if="model.gameType === 'dm'"
        :mapList="dmMapList"
        :modelValue="model.startMap"
        @update:modelValue="setDmMapSelection" 
        :isRegistered="true")
    .image
      MapImage(:mapName="model.startMap")
        .map-text {{model.startMap}}
      //-  SelectMap(v-model="model.map" :mapList="idMaps")
  .limits(v-if="model.gameType === 'dm'")
    .title Frag Limit
    input.form-input(type="number" min="0" max="100" v-model.number="model.fragLimit")
    .title Time Limit (minutes)
    input.form-input(type="number" min="0" max="60" v-model.number="model.timeLimit")

</template>

<script lang="ts" setup>
import SelectMap from './DmMapSelect.vue'
import MapImage from '../../../../MapImage.vue';

import { computed, onMounted, reactive, ref, watch } from 'vue';
import { idMaps, customDmMaps } from '../../../../../helpers/maps/multiplayer'
import type { GameSettings, GameTypes } from '../../../../../types/Room';
import { getMapImageUrl } from '../../../../../helpers/map';
import GameSelect from '../../../GameSelect.vue';
import DmMapSelect from './DmMapSelect.vue';

import type { MapGameSelection } from '../../../GameSelect.vue';
import type { MapName } from '../../../../../helpers/games';

const defaultMaps: Record<GameTypes, Pick<GameSettings, 'startMap' | 'gameDir' | 'sourceId'>> = {
  dm: {
    startMap: 'dm6',
    gameDir: 'original',
    sourceId: 'official:original'
  },
  coop: {
    startMap: 'start',
    gameDir: 'original',
    sourceId: 'official:original'
  },
  ctf: {
    startMap: 'e4m3',
    gameDir: 'original',
    sourceId: 'official:original'
  },
}

const emits = defineEmits<{
  (e: 'update:modelValue', modelValue: GameSettings): void
}>()

const props = defineProps<{ 
  modelValue: GameSettings
}>()

const model = reactive<GameSettings>({
  ...props.modelValue
})

const dmMapList = idMaps.concat(customDmMaps)

const setGameType = (gameType: GameTypes) => {
  model.gameType = gameType
  const newDefault = defaultMaps[gameType]
  model.sourceId = newDefault.sourceId
  if (newDefault.gameDir) {
    model.gameDir = newDefault.gameDir
  } else {
    delete model.gameDir
  }
  model.startMap = newDefault.startMap

}
const setDmMapSelection = (val: MapName) => {
  model.sourceId = 'official:quake'
  delete model.gameDir
  model.startMap = val
}

const setGameSelection = (val: MapGameSelection) => {
  model.sourceId = val.sourceId
  if (val.gameDir) {
    model.gameDir = val.gameDir
  } else {
    delete model.gameDir
  }
  model.startMap = val.map
}

const gameSelection = computed(() => ({
  sourceId: model.sourceId,
  gameDir: model.gameDir,
  map: model.startMap
}))

watch(model, (newVal, oldVal) => {
  emits("update:modelValue", model)
})
</script>

<style lang="scss" scoped>
.image {
  .map-image{ 
    min-height: 150px;
    position: relative;
    .map-text {
      text-shadow: 2px 2px rgb(0, 0, 0);
      position: absolute;
      bottom: 2px;
      left: 2px;
    }
  }
}
</style>