
<template lang="pug">
.map-image(ref="image")
  slot
</template>
  
<script lang="ts" setup>
import { defineComponent , onMounted, ref, watch, computed } from 'vue'
import { getMapImageUrl, genericImageUrl } from '../helpers/map';

const props = defineProps<{mapName?: string, fullMapPath?: string}>()

const image = ref<HTMLImageElement|null>(null)
const mapUrl = computed(() => props.fullMapPath || getMapImageUrl(props.mapName))
const mountImage = () => {
  if (image.value) {
    image.value.style.backgroundImage = `url(${mapUrl.value}), url(${genericImageUrl})`
  }
}

onMounted(mountImage)
watch(mapUrl, mountImage)
</script>

<style lang="scss" scoped>
.map-image {
  background-repeat: no-repeat;
  background-size: cover;
}
</style>