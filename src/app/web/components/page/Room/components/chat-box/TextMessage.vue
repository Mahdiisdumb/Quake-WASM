<template lang="pug">
.message-event
  .prefix
    font-awesome-icon.icon(v-if="player.type === 'host'" icon="fa-solid fa-crown" size="xs") 
  .name 
    img(v-if="props.playerImageDataUrl" :src="props.playerImageDataUrl")
    span(v-else) {{props.player.name}}
  .colon 
    span :&nbsp;

  .message {{props.message}}
</template>
  
<script lang="ts" setup>
import { computed } from 'vue';
import type  { ChatMessage, ChatMessages, PlayerId } from '../../../../../types/Room';

type Props = {
  message: Extract<ChatMessage['content'],  { tag: 'text' }>['message'],
  player: ChatMessages['players'][PlayerId],
  playerImageDataUrl?: string
}
const props = defineProps<Props>()

</script>
<style lang="scss" scoped>
.message-event {
  display: flex;
  align-items: flex-start;
  .prefix {
    width: 1rem;
  }
}
</style>