<template lang="pug">
.game-container
  template(v-if="model.showRequiresPak")
    PakLoader(@done="pakUploaded")
  template(v-else)
    h4#progress Starting Quake...
    canvas#mainwindow
    #loading(style="display: none; position: fixed;")
      img(alt="Loading")
      .loading-message(style="color: burlywood; font-family: monospace; font-weight:bold;background: RGBA(0,0,0,.2); padding: 3px 10px; margin-left: -7px;")

</template>

<script lang="ts" setup>
import {reactive, onMounted, onBeforeUnmount,  computed, watch} from 'vue'
import GameInit from '../../../../game'
import PakLoader from './PakLoader.vue'
import { useGameStore } from '../../../stores/game';
import { useRoute } from 'vue-router';
import { usePlayerStore } from '../../../stores/player';
import { useRoomStore } from '../../../stores/room';
import type { AssetMeta } from '../../../../../shared/types/Store';

const player = usePlayerStore()
const room = useRoomStore()
const route = useRoute()
const gameStore = useGameStore()
const emit = defineEmits<{
  (e: 'quit', reason?: string): void}
>()

const props = withDefaults(defineProps<{
  quitRequest: boolean
}>(), {quitRequest: false})

const model = reactive<{
  gameSys: any, 
  showRequiresPak: boolean,
  uploadResolve: (value: unknown) => void
}>({
  gameSys: null,
  showRequiresPak: false,
  uploadResolve: () => null
})

const allAssetMetas = computed<AssetMeta[]>(() => gameStore.assetMetas)
const args = computed(() => {
  const params = route.query
  return Object.keys(params)
    .map(param => (!!params[param] ? param + ' ' + params[param] : param))
    .join(' ')
})

const pak1 = computed(() => allAssetMetas.value.filter(assetMeta => 
  assetMeta.game === 'id1' && assetMeta.fileName.toLowerCase() === 'pak1.pak') )

const pakUploaded = () => {
  model.showRequiresPak = false
  model.uploadResolve(undefined)
}

onMounted(async () => {
  console.log('init game')
  model.gameSys = await GameInit(args.value, {
    // hooks
    quit: (reason?: string) => {
      emit('quit', reason)
    },
    startRequestPak: resolve => {
      model.showRequiresPak = true;
      model.uploadResolve = resolve
    }
  }, {
    playerId: player.playerId,
    isHost: !!room.isHost,
    socket: room.serverConnection
  })
})

watch(props, () => {
  if (props.quitRequest && model.gameSys) {
    model.gameSys.quit()
  }
})
</script>

<style lang="scss">
.game-container {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
}

#lateregistered {
  margin-top: 2rem;
  display: flex;
  flex-direction: column;
  align-items:center;
  justify-content: center;
  .uploader {
    width: 80%;
  }
}
#progress {
  margin-top: 2rem;
  text-align: center;
}
</style>
