<script setup lang="ts">
definePageMeta({ layout: 'private' })

const studio = useNsfwStudioStore()
const title = ref('')
const premise = ref('')
const message = ref<string | null>(null)
const selectedId = ref<string | null>(null)
const creating = ref(false)

await studio.loadExperiences()
selectedId.value = studio.experiences[0]?.id || null

const selected = computed(
  () => studio.experiences.find((item) => item.id === selectedId.value) || null
)

/** Huecos: slots sin asignar. Se puede publicar con ellos, pero se marcan en la ficha. */
const gaps = computed(() => (selected.value?.slots || []).filter((slot) => slot.required && !slot.defaultCharacterId))

async function create() {
  const experience = await studio.createExperience({
    title: title.value,
    premise: premise.value
  })
  title.value = ''
  premise.value = ''
  selectedId.value = experience.id
  creating.value = false
  message.value = 'Experience creada'
}

async function publish(id: string) {
  await studio.publish({ resourceType: 'experience', resourceId: id })
  await studio.loadExperiences()
  message.value = 'Publicada en el Hub'
}
</script>

<template>
  <div class="nsfw-page nsfw-studio">
    <div class="nsfw-studio-rail">
      <p class="nsfw-eyebrow px-6">Studio</p>
      <h1 class="mb-5 px-6 font-serif text-3xl">Experiences</h1>

      <button
        v-for="experience in studio.experiences"
        :key="experience.id"
        type="button"
        class="nsfw-studio-item"
        :class="selectedId === experience.id && !creating ? 'is-active' : ''"
        @click="selectedId = experience.id; creating = false"
      >
        <span class="min-w-0">
          <strong class="truncate">{{ experience.title }}</strong>
          <small :class="experience.published ? 'text-[var(--nsfw-success)]' : ''">
            {{ experience.published ? 'publicada' : 'borrador' }}
          </small>
        </span>
      </button>

      <button
        type="button"
        class="nsfw-studio-item text-[var(--nsfw-dim)]"
        :class="creating ? 'is-active' : ''"
        @click="creating = true"
      >
        <span class="text-base leading-none">+</span> Nueva Experience
      </button>

      <div class="flex-1" />

      <div class="mx-4 flex flex-col gap-2.5 border-t border-[var(--nsfw-hair)] px-2 pt-4">
        <NuxtLink to="/private/studio/characters" class="nsfw-btn-text">Personajes</NuxtLink>
        <NuxtLink to="/private/studio/places" class="nsfw-btn-text">Lugares</NuxtLink>
      </div>
    </div>

    <div class="nsfw-studio-detail">
      <p v-if="message" class="mb-4 text-sm text-[var(--nsfw-success)]" role="status">{{ message }}</p>

      <section v-if="creating || !selected" class="max-w-lg">
        <h2 class="mb-2 font-serif text-3xl">Nueva Experience</h2>
        <p class="mb-7 font-serif text-base italic text-[var(--nsfw-muted)]">
          Premisa, slots y perfil. La sesión no muta la plantilla.
        </p>
        <div class="grid gap-6">
          <label class="block">
            <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Título</span>
            <input v-model="title" class="nsfw-underline" placeholder="Hotel Arenal, 203">
          </label>
          <label class="block">
            <span class="nsfw-eyebrow nsfw-eyebrow--dim mb-2 block">Premisa</span>
            <textarea
              v-model="premise"
              class="nsfw-input min-h-28 w-full"
              placeholder="Dos desconocidos coinciden en el mismo congreso por tercera vez este año…"
            />
          </label>
          <div>
            <button type="button" class="nsfw-btn-primary" @click="create">Crear</button>
          </div>
        </div>
      </section>

      <section v-else class="flex flex-col gap-9 lg:flex-row lg:gap-12">
        <div class="min-w-0 flex-1">
          <div class="mb-7 flex flex-wrap items-start justify-between gap-5">
            <div>
              <p class="nsfw-eyebrow" :class="selected.published ? '!text-[var(--nsfw-success)]' : '!text-[var(--nsfw-gold)]'">
                {{ selected.published ? 'Publicada' : 'Borrador' }}
              </p>
              <h2 class="font-serif text-3xl">{{ selected.title }}</h2>
            </div>
            <div class="flex flex-wrap items-center gap-5">
              <NuxtLink :to="`/private/create?experience=${selected.id}`" class="nsfw-btn-text">
                Jugar
              </NuxtLink>
              <button
                v-if="!selected.published"
                type="button"
                class="nsfw-btn-primary min-h-10"
                @click="publish(selected.id)"
              >
                Publicar
              </button>
            </div>
          </div>

          <p class="nsfw-eyebrow nsfw-eyebrow--dim">Premisa</p>
          <p class="mb-9 max-w-[62ch] font-serif text-lg leading-relaxed text-[var(--nsfw-prose)]">
            {{ selected.premise || 'Sin premisa todavía.' }}
          </p>

          <div class="nsfw-section-head">
            <h3>Slots del reparto</h3>
            <span class="text-xs text-[var(--nsfw-dim)]">quien juegue elige o deja a la IA</span>
          </div>
          <div v-if="selected.slots.length" class="nsfw-hairgrid mb-9">
            <div
              v-for="slot in selected.slots"
              :key="slot.id"
              class="flex items-center gap-4 px-4 py-3.5"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm">{{ slot.role }}</p>
                <p class="text-xs text-[var(--nsfw-dim)]">
                  {{ slot.required ? 'obligatorio' : 'opcional' }}
                  <template v-if="slot.replaceable"> · reemplazable</template>
                </p>
              </div>
              <span
                class="shrink-0 text-xs"
                :class="slot.defaultCharacterId ? 'text-[var(--nsfw-muted)]' : 'text-[var(--nsfw-gold)]'"
              >
                {{ slot.defaultCharacterId ? 'asignado' : 'sin asignar' }}
              </span>
            </div>
          </div>
          <p v-else class="mb-9 text-sm text-[var(--nsfw-muted)]">
            Sin slots definidos: la historia elegirá reparto y lugar.
          </p>

          <div class="nsfw-section-head">
            <h3>Finales previstos</h3>
          </div>
          <div class="custom-pills">
            <span
              v-for="ending in selected.endings"
              :key="ending"
              class="pill !min-h-8 !py-1 !text-xs !border-[color-mix(in_srgb,var(--nsfw-gold)_35%,transparent)] !text-[var(--nsfw-gold)]"
            >
              {{ ending }}
            </span>
            <span v-if="!selected.endings.length" class="text-xs text-[var(--nsfw-dim)]">
              Sin finales previstos.
            </span>
          </div>
        </div>

        <aside class="nsfw-summary w-full shrink-0 lg:w-[19rem]">
          <p class="nsfw-eyebrow nsfw-eyebrow--dim mb-3">Perfil de contenido adulto</p>
          <p class="mb-7 text-sm leading-relaxed text-[var(--nsfw-muted)]">
            {{ selected.adultProfile || 'Sin perfil definido; manda el de quien juegue.' }}
          </p>

          <p class="nsfw-eyebrow nsfw-eyebrow--dim mb-3">Semillas de plan</p>
          <ul class="mb-7 space-y-2">
            <li
              v-for="(seed, index) in selected.planSeeds"
              :key="index"
              class="font-serif text-[0.95rem] italic leading-relaxed text-[var(--nsfw-muted)]"
            >
              {{ seed }}
            </li>
            <li v-if="!selected.planSeeds.length" class="text-xs text-[var(--nsfw-dim)]">
              Sin semillas.
            </li>
          </ul>

          <p class="nsfw-eyebrow nsfw-eyebrow--dim mb-3">Cobertura</p>
          <p v-if="!gaps.length" class="text-sm text-[var(--nsfw-success)]">
            Reparto y lugares resueltos.
          </p>
          <ul v-else class="space-y-2">
            <li
              v-for="slot in gaps"
              :key="slot.id"
              class="text-xs leading-relaxed text-[var(--nsfw-gold)]"
            >
              Falta asignar «{{ slot.role }}».
            </li>
          </ul>
          <p class="mt-4 text-xs leading-relaxed text-[var(--nsfw-dim)]">
            Puedes publicar con huecos: se marcan en la ficha del Hub. Los límites de quien juegue
            siempre ganan sobre los de la Experience.
          </p>
        </aside>
      </section>
    </div>
  </div>
</template>
