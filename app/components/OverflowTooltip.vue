<script setup lang="ts">
const props = defineProps<{
  text: string
  tooltipId: string
}>()

const root = ref<HTMLElement | null>(null)
const overflowing = ref(false)
let observer: ResizeObserver | undefined

function measure() {
  const target = root.value?.firstElementChild as HTMLElement | null
  if (!target) return
  overflowing.value = target.scrollWidth > target.clientWidth + 1
    || target.scrollHeight > target.clientHeight + 1
}

onMounted(() => {
  measure()
  const target = root.value?.firstElementChild
  if (!target) return
  observer = new ResizeObserver(measure)
  observer.observe(target)
})

onUpdated(() => nextTick(measure))
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div ref="root" class="group relative block min-w-0">
    <slot
      :described-by="overflowing ? props.tooltipId : undefined"
      :overflowing="overflowing"
    />
    <span
      v-if="overflowing"
      :id="props.tooltipId"
      role="tooltip"
      class="pointer-events-none invisible absolute top-full left-0 z-30 mt-1.5 w-max max-w-[min(24rem,calc(100vw-3rem))] rounded-lg bg-slate-950 px-3 py-2 text-left text-sm leading-snug break-words whitespace-normal text-white opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
    >
      {{ props.text }}
    </span>
  </div>
</template>
