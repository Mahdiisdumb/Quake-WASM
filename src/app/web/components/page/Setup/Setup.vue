<template lang="pug">
.setup
  ul.tab
    li.tab-item(:class="$route.name==='assets' ? 'active' : ''")
      router-link.btn.btn-link(:to="{name: 'assets'}") Packages
    li.tab-item(:class="$route.name==='config' ? 'active' : ''")
      router-link.btn.btn-link(:to="{name: 'config'}") Config.cfg
    li.tab-item(:class="$route.name==='autoexec' ? 'active' : ''")
      router-link.btn.btn-link(:to="{name: 'autoexec'}") Autoexec.cfg
  router-view
</template>

<style>
</style>