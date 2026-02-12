<template lang="pug">
.game-settings
  .mod
    .title Mode
    .value {{gameTypeDisplay(props.setting.gameType)}}
  .map
    .title Selected Map
    .image
      MapImage(:mapName="props.setting.startMap")
        .map-text {{props.setting.startMap}}
  .limits(v-if="props.setting.gameType === 'dm'")
    .title End Game Criteria
    .value Frags {{props.setting.fragLimit}} / Time {{props.setting.timeLimit}}
</template>

<script lang="ts" setup>
import type { GameSettings } from '../../../../../types/Room';
import MapImage from '../../../../MapImage.vue';

const props = defineProps<{ 
  setting: GameSettings
}>()

const gameTypeDisplay = (gameType: string) => {
  switch (gameType) {
    case 'dm': return 'DeathMatch'
    case 'coop': return 'Cooperative'
    case 'ctf': return 'Capture The Flag'
    default: return gameType
  }
}
</script>
<!-- 
    mod: 'dm' | 'ctf' | 'coop'
    map: string
    fragLimit: number
    timeLimit: number
    otherSettings: GenericSetting[] -->

<style lang="scss" scoped>
@import '../../../../../scss/colors.scss';
.title {
  font-weight: 600;
  color: $body-font-color-subdued;
}
.value {
}

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