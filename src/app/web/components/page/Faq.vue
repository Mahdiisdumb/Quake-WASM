<template lang="pug">
.faq 
  h2 Frequently Asked Questions 
  .accordion(v-for="(qa, idx) in qas")
    input(type="radio" :id="'accordion-' + idx" name="accordion-radio" hidden)
    label.accordion-header(:for="'accordion-' + idx")
      i.icon.icon-arrow-right.mr-1 
      strong {{ qa.question }} 
    .accordion-body(v-html="qa.answer")

</template>
<script setup lang="ts">
type QA = {
  question: string
  answer: string
}

const qas = [{
  question: 'Why are some features of the site disabled?',
  answer: `<p>Many features of this site are disabled 
  because they require the pak1.pak file, which is
  only available with a purchased copy of Quake. Only features
  available in the shareware version are enabled by default.`
}, {
  question: 'What is shareware?',
  answer: `<p>Shareware is an old term referring to a portion of the game
  shipped as a demo for free. This usually only included a few levels, or
  in the case of Quake, the first episode.  To play the full game would
  require a purchased copy of the game.`
}, {
  question: 'What is a pak file?',
  answer: `<p>A pak file is an archive of files that contain 
   game assets like maps, models, sounds, etc. 
   The base game shipped with two pak files - pak0.pak and pak1.pak. 
   <p>The first one, pak0.pak, shipped with the shareware 
   version of quake which was freely distributable.  
   <p>The pak1.pak file was only shipped with the purchased version which is why
   this site cannot provide this file for you.  
   This file is also required to play any modified games or maps.`
}, {
  question: 'Where can I buy quake?',
  answer: `<p>You can find purchasable copies of quake on <a href="https://www.gog.com/en/game/quake_the_offering" target="_blank">GoG</a> or <a href="https://store.steampowered.com/agecheck/app/2310/" target="_blank">Steam</a> which sell for ~$10.  It regularly goes on sale for under $5. After the purchase, locate and add the pak1.pak, which was provided during the install, in the <a href="/setup/assets">setup</a> section.`
}, {
  question: 'Where is my pak1.pak file?',
  answer: `<p>The pak1 file is in the idt1 direcory of your quake installation.  Your quake installation can 
  depend where you bought it, what OS you run, and if you have customized the install path.  <br>For steam on windows, this is C:\\Program Files (x86)\\Steam\\steamapps\\common\\Quake.  
  <br>GoG may install here C:\\GOG Games\\Quake.`
}, {
  question: 'How do I assign a key to the rocket launcher?',
  answer: `The original quake had limited options in the options menu. Sadly, assigning weapons to keys is also missing. 
    There are a few ways of going about this to "bind" key to the action. One is via the console - you can enter
      <p><pre>bind <key> "impulse #"</pre> 
      <p>where # is the number of the weapon:
        <ul>
          <li>1 - axe</li>
          <li>2 - Shotgun</li>
          <li>3 - Super Shotgun</li>
          <li>4 - Nailgun</li>
          <li>5 - Super Nailgun</li>
          <li>6 - Grenade Launcher</li>
          <li>7 - Rocket Launcher</li>
          <li>8 - Lightning gun</li>
        </ul>
      <p> You can also edit your <pre>config.cfg</pre> in <a href="/setup/config">setup</a> and add these binds directly. They apply when you start
        the game.
      <p>This can also be used to assign other actions.`
}, {
  question: 'What are these files - Autoexec.cfg and Config.cfg?',
  answer: `These two files contain configuration commands that are executed when the game start.
    <p>The config.cfg file is where the game stores your settings like video options, key bindings, mouse sensitivity, etc. This file can be modified, but additional commands may be overwritten by the game.
    <p>The autoexec.cfg file is an optional file that you can create to add your own custom commands that you want to run every time the game starts. This file will not be modified by the game engine.
    <p>You can edit these files in the <a href="/setup/config">setup</a> section.`
}]
</script>

<style lang="scss" scoped>
.accordion-body {
  margin-left: 2rem;
}</style>