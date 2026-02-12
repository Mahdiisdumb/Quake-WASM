<template lang="pug">
.modal.active
  a.modal-overlay(@click="closeDialog")
  .modal-container
    .modal-header
      a.btn.btn-clear.float-right(aria-label='Close' @click="emit('cancel')")
      .modal-title.h5 Create New Package
    .modal-body
      .form-group
        label.form-label Package Name
        input.form-input(
          v-model="model.name"
          placeholder="Enter package name"
        )
      .form-group
        label.form-label Game Directory
        input.form-input(
          v-model="model.gameDir"
          placeholder="id1"
        )
        p.form-input-hint The directory where maps/mods will be mounted in the game (defaults to "id1")
    .modal-footer
      button.btn(@click="emit('cancel')") Cancel
      button.btn.btn-primary(@click="emit('create', model)" :disabled="!model.name.trim()")
        | Create Package

</template>
<script setup lang="ts">
import { ref, reactive, defineEmits } from 'vue';

const model = reactive<{
  name: string,
  gameDir: string
}>({
  name: '',
  gameDir: 'id1'
})

const emit = defineEmits<{
  (e: 'cancel'): void,
  (e: 'create', newPackage: {name: string, gameDir: string}): void
}>()
</script>

<style lang="scss" module>
.modal {
  .modal-container {
    max-width: 400px;
    
    
    .form-group {
      margin-bottom: 1rem;
      
      .form-label {
        font-weight: 500;
        margin-bottom: 0.5rem;
        display: block;
      }
      
      .form-input-hint {
        font-size: 0.875rem;
        margin-top: 0.25rem;
        margin-bottom: 0;
      }
    }
    
  }
}
</style>