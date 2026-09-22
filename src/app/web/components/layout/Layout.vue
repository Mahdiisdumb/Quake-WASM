<template lang="pug">
.main
  .container.grid-lg
    Header
    .app-content
      router-view
    Footer
</template>
<script lang="ts" setup>
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useToast } from 'vue-toastification'
import QuakeText from '../QuakeText.vue'
import Footer from './Footer.vue'
import Profile from './Profile.vue';
import Header from './Header.vue'

const route = useRoute()
const router = useRouter()
const toast = useToast()

// Game quits land on any frontend page with a base64 ?message=; toast it once
// here (the layout wraps every page) and scrub it from the URL.
watch(() => route.query.message, (message) => {
  const raw = Array.isArray(message) ? message[0] : message
  if (!raw) return
  try { toast.info(atob(raw)) } catch {}
  const query = { ...route.query }
  delete query.message
  router.replace({ query })
}, { immediate: true })
</script>
