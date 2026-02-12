<template lang="pug">
.name-maker
  input(ref="input" :value="value" @input="emit('input', $event.target.value)" @keydown="inputKeyDown")
  .buttons
    button.btn(@click="space") Space
    button.btn(@click="backspace") Backspace
    button.btn.right(@click.stop="done") Done
  canvas(ref="canvas" :height="model.charsetSize" :width="model.charsetSize" @mousemove="canvashover" @click="canvasclick")
</template>

<script lang="ts" setup>
import {reactive, ref, nextTick, watch, onMounted} from 'vue'

const emit = defineEmits<{
  (e: 'input', newName: string): void,
  (e: 'done'): void 
}>()

const blockedChars = [0, 9, 10, 12, 13, 173]

const canvas = ref<HTMLCanvasElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const props = withDefaults(defineProps<{
  maxLength: number,
  value: string
}>(), {
  value: '',
  maxLength: 0
})
const model = reactive<{
  image: CanvasImageSource | null,
  charsetSize: number,
  name: string,
  hoverPosition: {x: number, y: number} 
}>({
  image: null,
  charsetSize: 400,
  name: props.value,
  hoverPosition: {x: -1, y: -1}
})

watch(props, () => {
  model.name = props.value
})

const insertCharacter = (char: string) => {
  if (!input.value) return
  const selectionStart = input.value.selectionStart!
  const selectionEnd = input.value.selectionEnd!
  const newName = model.name.slice(0, selectionStart) + char + model.name.slice(selectionEnd);
  
  if (newName.length <= props.maxLength) {
    change(newName)
    nextTick(() => {
      input.value!.focus()
      input.value!.selectionEnd = selectionStart + char.length
    })
  }
}

const change = (newName: string) => {
  if (model.name.length <= props.maxLength) {
    emit('input', newName)
  }
}

const space = () => {
  if (model.name.length <= props.maxLength) {
    insertCharacter(' ')
  }
}
const backspace = () => {
  if (!input.value) return
  if (model.name.length && input.value) {
    const selectionStart = input.value.selectionStart!
    const selectionEnd = input.value.selectionEnd!
    const newName = model.name.slice(0, selectionStart - 1) + model.name.slice(selectionEnd);
    
    change(newName)
    nextTick(() => {
      input.value!.focus()
      input.value!.selectionEnd = selectionStart - 1
    })
  }
}

const done = () => {
  if (!model.name) {
    emit('input', 'player')
  }
  // hack because for some reason the above doesn't trigger change if done is executed the same time.
  nextTick(() => emit('done'))
}

const inputKeyDown = (e: KeyboardEvent) => {
  const key = e.key
  if (key === "Escape") {
    emit('done')
    return
  }
  if (key === "Backspace" || key === "Delete" || key==="ArrowLeft" || key==="ArrowRight") {
    return
  }
  if (model.name.length > props.maxLength) {
    e.preventDefault()
    return false
  }
}

const getCharCode = (width: number, offsetX: number, offsetY: number) => {
  const blockSize = width / 16
  const x = Math.floor(offsetX / blockSize),
        y = Math.floor(offsetY / blockSize)
  return x + (y * 16)
}
const canvasclick = (e: MouseEvent) => {
  const canvas = e.target as HTMLCanvasElement
  const charCode = getCharCode(canvas.clientWidth, e.offsetX, e.offsetY)
  
  if (!blockedChars.includes(charCode)) {

    const char = String.fromCharCode(charCode);
    return insertCharacter(char)
  }
}
const canvashover = (e: MouseEvent) => {
  const canvas = e.target as HTMLCanvasElement
  model.hoverPosition = {x: e.offsetX, y: e.offsetY}
  if (canvas.getContext && model.image) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return

    const ratio = model.charsetSize / canvas.clientWidth
    const size = model.charsetSize / 16;
    const x = Math.floor((model.hoverPosition.x * ratio) / size) * size
    const y = Math.floor((model.hoverPosition.y * ratio) / size) * size
    const charCode = getCharCode(canvas.clientWidth, e.offsetX, e.offsetY)

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(model.image, 0, 0, model.charsetSize, model.charsetSize);
    
    canvas.style.cursor='default'
    if (!blockedChars.includes(charCode)) {
      canvas.style.cursor='pointer'
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(x, y, size, size); 
    }
  }
}

onMounted(() => {
  if (!canvas.value) return
  if (canvas.value.getContext) {
      const ctx = canvas.value.getContext('2d');

      //Loading of the home test image - img1
      var charset = new Image();

      //drawing of the test image - img1
      charset.onload = () => {
        if (!ctx) return
        //draw background image
        model.image = charset
        ctx.drawImage(model.image, 0, 0, model.charsetSize, model.charsetSize);
        //draw a box over the top
        // ctx.fillStyle = "rgba(200, 0, 0, 0.5)";
        // ctx.fillRect(0, 0, 500, 500);

      };

      charset.src = '/static/img/charset.png';
  }
  
})
</script>

<style lang="scss" scoped>
.name-maker {
  display: flex;
  flex-direction: column;
  .buttons {
    .right { 
      float: right;
    }
  }
}
</style>