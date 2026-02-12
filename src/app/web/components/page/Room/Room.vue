<template lang="pug">
.room
  .container(v-if="roomStore.connectionStatus !== 'connected'")
    .loading.loading-lg
  .container(v-else)
    h2 {{roomStore.roomState?.room?.name || 'Unknown'}}
    h5 {{roomStatusText}}
    .columns
      .column.col-8.col-sm-12
        .panel
          .panel-header
            .panel-title
              h5 Chat
          .panel-body
            .container.chat-box-container(v-if="roomStore.roomState?.chat")
              ChatBox(:chat="roomStore.roomState?.chat || {}" @send="roomStore.sendMessage")
          .panel-footer
      .column.col-4.col-sm-12
        .panel
          .panel-header
            .panel-title
              h5 Players
          .panel-body
            .container.player-list-container
              PlayerList(:players="roomStore.roomState?.players || []")
          .panel-footer
        .panel.col-sm-12
          .panel-header
            .panel-title
              h5 Game Settings
          .panel-body
            .container.player-list-container(v-if="roomStore.roomState.gameSettings")
              EditGameSettings(v-if="roomStore.isHost" 
                :modelValue="roomStore.roomState.gameSettings" 
                @update:modelValue="roomStore.sendGameSettingChange")
              ViewGameSettings(v-else :setting="roomStore.roomState.gameSettings")
          .panel-footer
        .panel
          .panel-header
          .panel-body.action-buttons
            QButton(
              v-if="roomStore.isHost"
              @click="launchGame()"
              ) Launch
            QButton(
              v-else-if="roomStore.roomState?.status === 'in-game'"
              @click="launchGame()"
              ) Join
            QButton(
              @click="leaveRoom()"
              ) Leave Room
          .panel-footer
</template>

<script setup lang="ts">
import QButton from '../../input/QButton.vue';
import ChatBox from './components/chat-box/ChatBox.vue'
import PlayerList from './components/player-list/PlayerList.vue';
import EditGameSettings from './components/game-settings/EditGameSettings.vue';
import ViewGameSettings from './components/game-settings/ViewGameSettings.vue';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoomStore } from '../../../stores/room';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { usePlayerStore } from '../../../stores/player';
import { joinRoom } from './roomJoin';
import { useToast } from "vue-toastification";
import { getMapGameQueryParams } from '../../../helpers/map';

type Model = {
  roomId: string
  message: string,
  clickToLeave: boolean
}

const router = useRouter()
const route = useRoute()
const roomStore = useRoomStore();
const playerStore = usePlayerStore()
const toast = useToast();

const model = reactive<Model>({
  roomId: route.params.id as string,
  message: route.query.message as string || '',
  clickToLeave: false
})

if (model.message) {
  toast.info(atob(model.message))
  router.replace({ query: {} } )
}
const roomStatus = ref<'unknown' | 'lobby' | 'in-game'>(roomStore.roomState.status)
roomStore.$subscribe((mutation, state) => {
  if (state.connectionStatus === 'not-connected') {
    leaveRoom('You left the room.')
  } else if (roomStatus.value === 'lobby' && state.roomState.status === 'in-game') {
    launchGame()
  }
  
  roomStatus.value = state.roomState.status
})

const roomStatusText = computed(() => {
  switch(roomStore.roomState.status) {
    case 'in-game': return 'Currently in game'
    case 'lobby':  return 'Waiting for host to Launch'
    default:  return 'Unknown'
  }
})

const leaveRoom = (reason?: string) => {
  const base64Message = reason ? btoa(reason) : undefined
  
  model.clickToLeave = true
  router.replace('/multiplayer' + (base64Message ? `?message=${base64Message}` : ''))
}

const launchGame = () => {
  let query = getMapGameQueryParams({
    sourceId: roomStore.roomState.gameSettings.sourceId,
    gameDir: roomStore.roomState.gameSettings.gameDir,
    map: roomStore.roomState.gameSettings.startMap
  })
  if (roomStore.isHost) {
    switch (roomStore.roomState.gameSettings.gameType) {
      case 'coop' :
        query = {
          ...query,
          "-coop": "1"
        }
        break;
      case 'dm':
        query = {
          ...query,
          "-timelimit": roomStore.roomState.gameSettings.timeLimit.toString(),
          "-fraglimit": roomStore.roomState.gameSettings.fragLimit.toString(),
        }
        break;
    }
    query = {
      ...query,
      "-listen": "16"
    }
  } else {
    query = {
      ...query,
      "-connect": `rtc://netquake.io/room`
    }
  }
  
  router.push({
    name: 'room-game',
    params: {
      roomId: model.roomId
    }, 
    query
  })
}

onMounted(() => {
  joinRoom(
    model.roomId, 
    router, 
    roomStore
  )
})

onBeforeRouteLeave((to, from, next) => {
  if (to.name === 'room-game' || roomStore.connectionStatus === 'not-connected') {
    return next()
  }
  const answer = model.clickToLeave || roomStore.connectionStatus === 'connecting' || window.confirm('Do you want to leave this room?')
  if (answer) {
    roomStore.leaveRoom()
    next()
  } else {
    next(false)
  }
})
</script>

<style lang="scss" scoped>
.chat-box-container {
  height: 20rem;
}
.room {
  min-height: 100vh;
}
.action-buttons {
  display: flex;
  gap: .5rem;
}
</style>
