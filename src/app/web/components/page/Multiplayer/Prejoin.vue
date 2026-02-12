<template lang="pug">

.modal.active#prejoin-modal( @keydown.esc="emit('cancel')")
  a.modal-overlay(aria-label='Close')
  .modal-container
    .modal-header
      a.btn.btn-clear.float-right(aria-label='Close' @click="emit('cancel')")
      .modal-title.h5 Customize Player
    .modal-body
      .content.container
        .controls.columns
          .control-selection.column.col-8
            .general-fields
              .name Player Name
              .value
                QuakeTextInput(:maxLength="15" :modelValue="playerName" @update:modelValue="setPlayerName($event)")

              .name Shirt Color
              .value
                ColorSelect(:modelValue="shirtValue" @update:modelValue="setShirtColor($event)")

              .name Pant Color 
              .value
                ColorSelect(:modelValue="pantValue" @update:modelValue="setPantColor($event)")  
              
        .controls.columns
          .header.column.col-12 Select your control scheme
          .control-selection.column.col-6
            .button(
              :class="controlStyle === 'modern' ? 'selected' : ''" 
              @click="gameStore.loadModernConfig")
              ModernControlImg(width="100%" height="100%")
              .description  
                span Modern
          .control-selection.column.col-6
            .button(
              :class="controlStyle === 'classic' ? 'selected' : ''" 
              @click="gameStore.loadClassicConfig")
              ClassicControlImg(width="100%"  height="100%")
              .description 
                span Classic
    .modal-footer
      button.btn(@click="emit('ok')") {{props.okText}}
      button.btn(v-if="props.showCancel" @click="emit('cancel')") Cancel
      

</template>
<script setup lang="ts">
import QuakeTextInput from '../../input/QuakeTextInput.vue'
import ModernControlImg from '../../../assets/modern-controls.svg'
import ClassicControlImg from '../../../assets/classic-controls.svg'
import {computed, onMounted, onUnmounted} from 'vue'
import { useGameStore } from '../../../stores/game'
import ColorSelect from './ColorSelect.vue'

const gameStore = useGameStore()

const props = withDefaults(defineProps<{
  showCancel: boolean,
  okText: string
}>(), {showCancel: false, okText: 'OK'})

const emit = defineEmits<{
  (e: 'ok'): void,
  (e: 'cancel'): void
}>()

const controlStyle = computed(() => gameStore.getCurrentConfigType)
const playerName = computed(() => gameStore.getAutoexecValue('name') ?? 'player')
const setPlayerName = (name: string) => gameStore.setAutoexecValue({name: 'name', value: name})
const colorValue = computed(() => parseInt(gameStore.getConfigValue('_cl_color') || '0') ?? 0)
const shirtValue = computed(() => colorValue.value >> 4)
const pantValue = computed(() => colorValue.value & 15)
const setShirtColor = (shirtColor: number) => setColors((shirtColor << 4) + pantValue.value)
const setPantColor = (pantColor: number) => setColors((shirtValue.value << 4) + pantColor)
const setColors = (colorValue: number) => gameStore.setConfigValue({name: '_cl_color', value: colorValue.toFixed(0)})

// const cancelOnEsc = (e) => {
//   if (e.keyCode == 27) {
//     emit('cancel')
//   }
// }
// onUnmounted(() => {
//   document.removeEventListener("keydown", cancelOnEsc)
// })
// onMounted(() => {
//   document.addEventListener("keydown", cancelOnEsc)
// })
</script>

<style lang="scss">
@import '../../../scss/colors.scss';
#prejoin-modal {
  .h5 {
    color: $primary-color;
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }
  .general-fields {
    display: grid;
    grid-template-columns: 1.5fr 2fr;
    row-gap: .2rem;
    .name {
      font-weight: 500;
    }
    .value {
      .color-select {
        width: fit-content;
      }
    }
  }
  .modal-container {
    max-width: 860px;
    position: relative;
  } 
  .modal-footer {
    button {
      margin-left: 1rem;
    }
  }
  .button {
    cursor: pointer;
    padding: 1rem;
    border: 2px solid $border-color-dark;
    background-color: $body-bg;
    box-shadow: 0px 8px 15px rgba(0, 0, 0, 0.1);
    i {
      color: $primary-color;
      font-size: .8rem;
      margin-left: 1rem;
    }
    &.selected {
      background-color: lighten($body-bg, 7%);
      .description {
        position: relative;
        span::before {
          position: absolute;
          color: $primary-color;
          font-size: .8rem;
          content: '✓';
          vertical-align: baseline;
          margin-left: -1rem;
          margin-top: .3rem;
        }
      }
    }
    &:hover {
      background-color: lighten($body-bg, 10%);
      border: 2px solid $border-color;
    }
    .description  {
      text-align: center;
      font-size: 1.1rem;
    }
  }
}
</style>

