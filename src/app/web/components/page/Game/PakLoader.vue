<template lang="pug">
#lateregistered
  .uploader
    h3 You must load the original Pak1.pak to play registered games
    a(href="/") Nevermind, take me back.
    Id1Assets(@uploaded="pakUploaded")
</template>

<script lang="ts" setup>
import Id1Assets from '../Setup/SetupGame/ID1Assets.vue'
const emit = defineEmits<{
  (e: 'done'): void}
>()
const pakUploaded = (files: string[]) => {
  if (files.some(f => f.toLowerCase() === 'pak1.pak')) {
    emit('done')
  }
}
</script>