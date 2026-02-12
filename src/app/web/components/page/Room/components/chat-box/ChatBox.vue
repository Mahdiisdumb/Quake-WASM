<template lang="pug">
.chat-box
  .chat-messages(ref="chatMessagesRef" @scroll="handleScroll")
    .message(v-for="(message, index) in props.chat.messages" :key="index")
      EventMessage(
        v-if="message.content.tag === 'event'" 
        :type="message.content.type" 
        :player="chat.players[message.playerId]"
        :playerImageDataUrl="renderedNames[chat.players[message.playerId].name]")
      TextMessage(
        v-if="message.content.tag === 'text'" 
        :message="message.content.message" 
        :player="chat.players[message.playerId]"
        :playerImageDataUrl="renderedNames[chat.players[message.playerId].name]")

  form(@submit.prevent="onSend")  
    .chat-new-message
      input.form-input(type="text" v-model="model.newMessage" placeholder="Type a message...")
      button.btn.btn-primary(type="submit")
        font-awesome-icon.icon(icon="fa-solid fa-paper-plane" size="xs") 
</template>

<script lang="ts" setup>
import EventMessage from './EventMessage.vue';
import TextMessage from './TextMessage.vue';
import { nextTick, onMounted, reactive, ref, watch } from 'vue';
import type { ChatMessages } from '../../../../../types/Room';
import { createWriter } from '../../../../../helpers/charmap';

export type ChatBoxProps = {
  chat: ChatMessages
}
type Model = {
  newMessage: string
  isScrolledAtBottom: boolean
}
const model = reactive<Model>({
  newMessage: '',
  isScrolledAtBottom: true
})

const renderedNames = ref<Record<string, string>>({})
const props = defineProps<ChatBoxProps>()
const emit = defineEmits<{(event: 'send', content: string): void}>()
const chatMessagesRef = ref<HTMLElement | null>(null)

const scrollToBottom = () => {
  chatMessagesRef.value?.scrollTo({ top: chatMessagesRef.value?.scrollHeight, behavior: 'smooth' })
}

watch(
  () => props.chat.messages,
  () => {
    if (model.isScrolledAtBottom) {
      nextTick(() => {
        chatMessagesRef.value?.scrollTo({ top: chatMessagesRef.value?.scrollHeight, behavior: 'smooth' })
      })
    }
  },
  { deep: true }
)

watch(props, () => {
  createWriter()
    .then(writer => {
      renderedNames.value = Object.entries(props.chat.players)
        .reduce((acc, [_playerId, player]) => {
          if (!acc[player.name]) {
            acc[player.name] = writer.write(12, btoa(player.name))  
          }
          return acc
        }, {} as Record<string, string>)
    })
}, {immediate: true})

const handleScroll = () => {
  const element = chatMessagesRef.value
  if (element) {
    const isAtBottom = element.scrollTop + element.offsetHeight >= element.scrollHeight
    model.isScrolledAtBottom = isAtBottom
  }
}

const onSend = () => {
  if (model.newMessage.trim() === '') return
  emit('send', model.newMessage)
  model.newMessage = ''
}
onMounted(() => {
  scrollToBottom()
})
</script>

<style lang="scss" scoped>
.chat-messages {
  display: flex;
  flex-direction: column;
  flex-grow: 1; /* or flex-grow: 1; */
  min-height: 300px;
  overflow-y: auto;
  margin-bottom: 10px;
}
.chat-box {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.chat-new-message{
  display: flex;
  flex-direction: row;
}
</style>
