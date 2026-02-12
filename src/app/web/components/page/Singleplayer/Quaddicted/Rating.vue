<template lang="pug">
.rating
  .star-ratings-css-top(:style="'width: ' + rating + '%;'")
    span ★
    span ★
    span ★
    span ★
    span ★
  .star-ratings-css-bottom
    span ★
    span ★
    span ★
    span ★
    span ★
</template>

<script setup lang="ts">
import {computed} from 'vue'

const props = defineProps<{rating: number}>()

const rating =  computed(() => {
  return (props.rating / 5) * 100
})
</script>

<style lang="scss">
.rating {
  position: relative;
  max-width: fit-content;
}
.star-ratings-css {
  unicode-bidi: bidi-override;
  font-size: 25px;
  height: 25px;
  width: 100px;
  margin: 0 auto;
  position: relative;
  padding: 0;
  text-shadow: 0px 1px 0 #e2e2e2;
  
  &-top {
    color: #8f4e28;
    padding: 0;
    position: absolute;
    z-index: 1;
    display: block;
    top: 0;
    left: 0;
    overflow: hidden;
  }
  &-bottom {
    color: #e0e0e0;
    padding: 0;
    display: block;
    z-index: 0;
  }
}
</style>