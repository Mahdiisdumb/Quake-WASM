<template lang="pug">
.singleplayer
  .container
    .column.col-12        
      .panel
        .panel-header
          .panel-title
            h5 Quake 1
        .panel-body
          .container
            GameSelect(v-model="model.gameSelection" :isRegistered="gameStore.hasRegistered")
        .panel-footer
          button.btn(@click="start()") Start Game
      .panel
        .panel-header
          .panel-title
            h5 Quaddicted Custom Map Selection
            .note Note: Webquake may 
              span.text-error not 
              | work with some of the more advanced mods. If you own a mod that is unsupported with webquake and know why, please
              |  fill out an issue 
              a(href="https://gitlab.com/joe.lukacovic/netquake.io/issues" target="_blank") here  
              |  with your mod name and what feature needs to be added to webquake to support your mod
              
        .panel-body
          .container
            .column.col-12
              Quaddicted
              p 
                span Data provided with permission from 
                a(href="https://www.quaddicted.com/") Quaddicted.com
        .panel-footer
</template>

<script lang="ts" setup>
import {reactive, onMounted, computed, watch, ref} from 'vue'
import { useMapsStore } from '../../../stores/maps';
import type { QuaddictedMap } from '../../../types/QuaddictedMap';

import type { MapGameSelection } from '../GameSelect.vue';
import GameSelect from '../GameSelect.vue'
import Quaddicted from './Quaddicted/Quaddicted.vue'
import { officialGameDefinitions } from '../../../helpers/games'
import type { GameDefinition} from '../../../helpers/games'
import { useGameStore } from '../../../stores/game';
import { useRouter } from 'vue-router';
import { retailSourceId } from '../../../../../shared/types/Source';
import { getMapGameQueryParams } from '../../../helpers/map';

const router = useRouter()
const gameStore = useGameStore()
const model = reactive<{
  gameSelection: MapGameSelection
}>({
  gameSelection: {
    sourceId: retailSourceId,
    gameDir: 'original',
    map: 'start'
  }
})

const start = () => {
  router.push({name: 'quake', query: getMapGameQueryParams(model.gameSelection)})
}
</script>
<style lang="scss">
.panel {
  margin-top: 1rem;
}
</style>
