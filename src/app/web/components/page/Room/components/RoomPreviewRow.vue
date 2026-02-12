<template lang="pug">
.room-preview-row
  //- MapImage(:mapName="props.room.map")
  MapImage(
    :mapName="room.startMap"
    v-tippy
    :content="room.startMap")
    .map-text {{room.startMap}}
  .detail
    h5.name {{room.name}}
    h6 
      font-awesome-icon.icon(icon="fa-solid fa-crown" size="xs") 
      span {{hostPlayerName}}
    h6 
      font-awesome-icon.icon(icon="fa-solid fa-gamepad" size="xs")
      span {{gameType}} &nbsp;
  .players Players
    .activity.active(v-if="room.players.length"
      v-tippy="{allowHTML: true}"
      :content="playerTooltipHtml")  {{formatPlayerCount}}
  
    .activity.inactive(v-else)  {{formatPlayerCount}}
  .action
    QButton(
      :disabled="!hasRegistered"
      @click="router.push('/room/' + room.id)"
      :tooltipPlacement="TooltipPlacement.left"
      tooltip="Join this room's lobby"
    ) Join

</template>

<script lang="ts" setup>
import MapImage from '../../../MapImage.vue';
import type { Room } from '../../../../types/Room';
import { computed, reactive, watch } from 'vue';
import { createWriter } from '../../../../helpers/charmap';
import QButton, {TooltipPlacement, ButtonType} from '../../../input/QButton.vue';
import { useRouter } from 'vue-router';
import { escapeHtml } from '../../../../helpers/string';

const router = useRouter()
const model = reactive<{
  playerTooltipHtml: string,
  renderedNames: Record<string, string>
}>({
  playerTooltipHtml: '',
  renderedNames: {}
})
const props = defineProps<{
  hasRegistered: boolean,
  room: Room
}>()

const hostPlayerName = computed(() => {
  const hostPlayer = props.room.players.find(p => p.id === props.room.hostPlayerId)
  return hostPlayer ? hostPlayer.name : '*Host Left*  '
})
const formatPlayerCount = computed(() => `${props.room.players.length}/${props.room.maxPlayers}`)
const gameType = computed(() => {
  switch(props.room.gameType) {
    case 'dm': return 'DeathMatch'
    case 'coop': return 'Cooperative'
    case 'ctf': return 'Capture The Flag'
  }
})

const playerTooltipHtml = computed(() => {
  const nameHtml = props.room.players.map(player => {
    if (model.renderedNames[player.name]) {
      return `<img src=${model.renderedNames[player.name]} />`
    } else return escapeHtml(player.name)
  })
  return  `<div style="display: flex; flex-direction: column;">${
    nameHtml.reduce((aggr, name) => aggr.concat(`<div>${name}</div>`), '')
  }</div>`
})

watch(props, () => {
  createWriter()
    .then(writer => {
      model.renderedNames = props.room.players.reduce((acc, player) => {
        if (!acc[player.name]) {
          acc[player.name] = writer.write(12, btoa(player.name))  
        }
        return acc
      }, {} as Record<string, string>)
    })
}, {immediate: true})
</script>

<style lang="scss" scoped>
@import '../../../../scss/colors.scss';
@import '../../../../scss/variables.scss';

.room-preview-row {
  padding: .2rem 0;
  border-top: 1px solid grey;

  &:last-child {
    border-bottom: 1px solid grey;
  }

  width: 100%;
  display: grid;
  grid-template-columns: auto 8rem 2rem;
  grid-template-areas: 
    "details players action";
  @media only screen and (min-width: $phone-breakpoint)  {
    grid-template-columns: 150px auto 8rem 2rem;
    grid-template-areas: 
      "map details players action";
  }
  .map-image {
    position: relative;
    .map-text {
      text-shadow: 2px 2px rgb(0, 0, 0);
      position: absolute;
      bottom: 2px;
      left: 2px;
    }
  }

  .detail {
    margin-left: .5rem;
    grid-area: details;
    color: darken($body-font-color, 30%);
    .icon {
      font-size: .7rem;
      padding-right: .7rem;
    }
    .name {
      color: $body-font-color;
      font-weight: 700;
      font-size: 1rem;
      .disabled {
        color: darken($body-font-color, 50%);
      }
      .shareware {
        font-size: .8rem;
      }
    }
  }
  .players {
    grid-area: players;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    font-weight: 700;
      color: darken($body-font-color, 30%);
    font-size: 1rem;
    .activity {
      &.active {
        color: $light-color;
      }
    }
  }
  .action {
    grid-area: action;
    display: flex;
    justify-content: center;
    flex-direction: column;
    align-items: center;
    margin-right: 2rem;
  }
}
</style>