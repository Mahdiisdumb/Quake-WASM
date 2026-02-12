<template lang="pug">
.server-row
  MapImage(
    :mapName="props.server.map"
    v-tippy
    :content="props.server.map")
    .map-text {{props.server.map}}
  .detail
    .name 
      span(:class="{disabled: props.disabled}") {{props.server.name}} &nbsp;
      span.shareware(
        v-if="props.shareware"
        v-tippy
        content="This server allows anyone to join")
        a(href="/slicnse"  target="_blank") shareware
    .location
      span(v-tippy content="location")
        font-awesome-icon.icon(icon="fa-solid fa-location-dot" size="xs") 
        | {{props.server.location}}
    .ping 
      span(v-tippy content="ping")
        font-awesome-icon.icon(icon="fa-solid fa-signal" size="xs") 
        | {{props.server.ping}} ms
  .players Players

    .activity.active(v-if="props.server.players.length"
      v-tippy="{allowHTML: true}"
      :content="model.playerTooltipHtml")  {{formatPlayerCount}}
  
    .activity.inactive(v-else)  {{formatPlayerCount}}
  .action
    QButton(
        @click="emit('join', props.server)" 
        :disabled="props.disabled" 
        :tooltipPlacement="TooltipPlacement.left"
        :tooltip="joinTooltipText"
    ) Join

</template>

<script lang="ts" setup>
import {reactive, onMounted, computed, watch, ref} from 'vue'
import { createWriter } from "../../../helpers/charmap"
import { useGameStore } from '../../../stores/game';
import QButton, {TooltipPlacement, ButtonType} from '../../input/QButton.vue'
import type { ServerStatus } from '../../../stores/multiplayer';
import MapImage from '../../MapImage.vue'
import { getMapImageUrl, genericImageUrl } from '../../../helpers/map';

const mapEl = ref<HTMLImageElement|null>(null)
const emit = defineEmits<{
  (e: 'join', server: ServerStatus): void}
>()

const gameStore = useGameStore()
const props = defineProps<{
  server: ServerStatus
  disabled: boolean
  shareware: boolean
}>()

const model = reactive<{playerTooltipHtml: string}>({playerTooltipHtml: ''})
const formatPlayerCount = computed(() => `${props.server.players.length}/${props.server.maxPlayers}`)
const joinTooltipText = computed(() => props.disabled ? "You must load your pak1.pak before\nplaying modified games.\nSee FAQ for details." : "Join this game server")
const joinUrl = computed(() => {
  var query: Record<string, string> = {
    "-connect": `wss://${props.server.connecthostport}`,
  }
  if (props.server.game && props.server.game !== 'id1') {
    query["-game"] = props.server.game
  }
})

watch(props, () => {
  createWriter()
    .then(writer => {
      const body = [...props.server.players]
        .sort((a, b) => parseInt(b.frags) - parseInt(a.frags))
        .map((player) => {
          return `<tr style="line-height: 1;">
          <td style="text-align:right;">
            <img src="${writer.writeScore(14, parseInt(player.frags), (player.colors & 0xf0) >> 4, player.colors & 0xf)}" style="display:inline;">
          </td>
          <td style="padding-left: 1rem; text-align: left">
            <img src="${writer.write(12, btoa(player.name))}" style="display:inline;">
          </td>
          </tr>`;
        })
        .join('');

      model.playerTooltipHtml = `<table><tbody>${body}</tbody></table>`;
    })
}, {immediate: true})
</script>

<style lang="scss" scoped>
@import '../../../scss/colors.scss';
@import '../../../scss/variables.scss';

.server-row {
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
  .map-image {
    display: none;
    @media only screen and (min-width: $phone-breakpoint) {
      display: block;
    }
    grid-area: map;
    background-position: right;
    position: relative;
    height: 100%;
    background-repeat: no-repeat;
    background-size: cover;

    .map-text {
      text-shadow: 2px 2px rgb(0,0,0);
      //background-color: rgba(0,0,0,.4);
      position: absolute;
      bottom: 2px;
      left: 2px;
    }
  }
}
</style>