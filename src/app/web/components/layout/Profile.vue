<template lang="pug">
div.profile
  div.name(@click="onProfileClick")
    font-awesome-icon.icon(icon="fa-solid fa-user" size="xs")
    QuakeText(:value="playerStore.playerName" :size="14")
  EditProfie(
    v-if="editProfileOpen"
    okText="OK"
    :showCancel="false"
    @ok="editProfileOpen = false"
    @cancel="editProfileOpen = false")
</template>

<script lang="ts" setup>
import QuakeText from '../QuakeText.vue'
import {usePlayerStore} from '../../stores/player';
import EditProfie from '../EditProfile.vue';
import {ref} from 'vue'

const playerStore = usePlayerStore()

const editProfileOpen = ref(false)

const onProfileClick = () => {
  editProfileOpen.value = true
}
</script>
<style scoped lang="scss">
.profile {
  cursor: pointer;
  .name {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
}
</style>