<template lang="pug">
.quake-text-input(v-on-click-outside="() => model.editing = false" @click="edit" )
  QuakeText(:value="props.modelValue" :size="14")
  .edit-box(v-if="model.editing")
    NameMakerVue(
      :maxLength="props.maxLength"
      :value="props.modelValue"
      @done="model.editing=false" 
      @input="emit('update:modelValue', $event)")
</template>

<script setup lang="ts">
import { vOnClickOutside } from '@vueuse/components'
import QuakeText from '../QuakeText.vue';
import NameMakerVue from './NameMaker.vue';
import {reactive} from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string,
  maxLength: number
}>(), {modelValue: '', maxLength: 0})

const emit = defineEmits<{
  (e: 'update:modelValue', value: 'string'): void
}>()
const edit = () => {
  model.editing=true
}
const model = reactive<{
  editing: boolean
}>({
  editing: false
})
</script>
<style lang="scss">
@import '../../scss/colors.scss';
.quake-text-input {
  position: relative;
  display: flex;
  cursor:pointer;
  background-color: lighten($body-bg, 1%);
  box-shadow: 0px 8px 15px rgba(0, 0, 0, 0.1);
  padding: 4px;
}
.edit-box {
  background-color: $body-bg;
  position: fixed;
  overflow:visible;
  margin-top: 1rem;
  z-index: 9;
}
</style>