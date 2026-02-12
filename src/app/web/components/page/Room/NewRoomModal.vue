<template lang="pug">
.modal.active#new-room-modal(@keydown.esc="emit('cancel')")
  a.modal-overlay(aria-label='Close')
  .modal-container
  
    form(@submit.prevent="okClick")
      .modal-header
        a.btn.btn-clear.float-right(aria-label='Close' @click="emit('cancel')")
        .modal-title.h5 Create new room

      .modal-body
        .content.container
          p Room Name
          input(name="room-name" v-model="model.roomName" maxLength="20" minLength="1" required)
          p Visiblity
          select.form-select(v-model="model.visibility")
            option(value="public") Public
            option(value="private") Invite Only

      .modal-footer
        button.btn Create
        button.btn(@click="emit('cancel')") Cancel
          
</template>
<script lang="ts">
export type CreationParams = {
  roomName: string,
  visibility: 'single' | 'private' | 'public'
}
</script>
<script setup lang="ts">
import {onMounted, reactive} from 'vue'

const props = defineProps<{
  playerName: string
}>();

const model = reactive<CreationParams>({
  roomName: props.playerName + "'s Room",
  visibility: 'public'
})

const okClick = () => {
  //TODO - Unique ROom Name, Check to see if room name exists
  // If Room Name exists, then error
  emit('ok', model)
}

const emit = defineEmits<{
    (e: 'ok', params: CreationParams): void,
    (e: 'cancel'): void
}>()

onMounted(() => {
  const closeHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      emit('cancel');
    }
  };
  // Close modal with 'esc' key
  document.addEventListener("keydown", closeHandler);
})
</script>

<style lang="scss">
@import '../../../scss/colors.scss';
#new-room-modal {
  .h5 {
    color: $primary-color;
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
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

