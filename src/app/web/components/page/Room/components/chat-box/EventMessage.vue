<template lang="pug">
.message-event
  .prefix
    font-awesome-icon.icon(:icon="eventIcon" size="xs") 
  .text 
    img(v-if="playerImageDataUrl" :src="playerImageDataUrl")
    span(v-else) {{player.name}} 
    span(style="margin-left: 4px;")  {{eventText}}
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { ChatMessage, ChatMessages, PlayerId } from '../../../../../types/Room';

type Props = {
  type: Extract<ChatMessage['content'],  { tag: 'event' }>['type'],
  reason?: Extract<ChatMessage['content'],  { tag: 'event' }>['reason'],
  player: ChatMessages['players'][PlayerId],
  playerImageDataUrl?: string
}
const props = defineProps<Props>()

const eventIcon = computed(() => {
  switch(props.type) {
    case 'joined':
      return 'fa-solid fa-user-plus'
    case 'left':
      return 'fa-solid fa-right-to-bracket'
    case 'kicked':
      return 'fa-solid fa-user-slash'
    case 'banned':
      return 'fa-solid fa-ban'
    case 'changed-name':
      return 'fa-solid fa-id-badge'
    case 'timed-out':
      return 'fa-solid fa-user-clock'
    case 'connection-lost':
      return 'fa-solid fa-plug-circle-xmark'
    default:
      return 'fa-solid fa-comment-dots'
  }
})
const eventText = computed(() => {
  switch(props.type) {
    case 'joined':
      return `joined the room`
    case 'left':
      return `left the room`
    case 'kicked':
      return `was kicked from the room`
    case 'banned':
      return `was banned from the room`
    case 'timed-out':
      return `took too long and was removed`
    case 'connection-lost':
      return `lost connection and has been removed from the room`
    case 'changed-name':
      return props.reason
        ? `${props.reason}`
        : `changed their name`
    default:
      return '<UNKNOWN EVENT>'
  }
})
</script>

<style lang="scss" scoped>
.message-event {
  display: flex;
  align-items: center;
  .prefix {
    width: 1rem;
    display: flex;
    .icon {
      margin-right: .5rem;
    }
  }
  color: grey;
}
</style>