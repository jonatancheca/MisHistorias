<script setup lang="ts">
import { changelogEntries, type ChangelogEntry } from '~/data/changelog'

useHead({ title: 'Historial de cambios · Mis Historias' })

const monthFormatter = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const dateFormatter = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

const groups = Array.from(
  changelogEntries.reduce((months, entry) => {
    const month = entry.completedAt.slice(0, 7)
    const entries = months.get(month) || []
    entries.push(entry)
    months.set(month, entries)
    return months
  }, new Map<string, ChangelogEntry[]>())
).map(([month, entries]) => ({
  month,
  label: monthFormatter.format(new Date(month + '-01T12:00:00Z')).replace(/^./, initial => initial.toLocaleUpperCase('es-ES')),
  entries
}))

function issueUrl(issue: number) {
  return 'https://github.com/jonatancheca/MisHistorias/issues/' + issue
}

function formatDate(date: string) {
  return dateFormatter.format(new Date(date + 'T12:00:00Z'))
}
</script>

<template>
  <div class="page-shell max-w-5xl">
    <header class="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="page-kicker">Actualizaciones</p>
        <h1 class="page-title">Historial de cambios</h1>
        <p class="mt-2 max-w-2xl text-sm text-[var(--color-fg-muted)]">
          Cambios completados en Mis Historias. Abre cada issue para consultar sus detalles.
        </p>
      </div>
      <NuxtLink to="/settings#actualizaciones" class="btn-ghost">
        Volver a Ajustes
      </NuxtLink>
    </header>

    <section
      v-for="group in groups"
      :key="group.month"
      class="mb-8"
      :aria-labelledby="'month-' + group.month"
    >
      <h2 :id="'month-' + group.month" class="mb-3 text-lg font-bold">
        {{ group.label }}
      </h2>
      <ol class="card divide-y divide-[var(--color-border-soft)]" data-testid="changelog-entries">
        <li
          v-for="entry in group.entries"
          :key="entry.issue"
          class="flex min-w-0 flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
        >
          <a
            :href="issueUrl(entry.issue)"
            target="_blank"
            rel="noopener noreferrer"
            class="min-w-0 break-words text-sm font-semibold text-[var(--color-fg)] hover:text-brand-600 hover:underline focus-visible:text-brand-600"
          >
            {{ entry.summary }}
            <span class="ml-1 whitespace-nowrap text-xs font-medium text-brand-600">#{{ entry.issue }} ↗</span>
          </a>
          <time :datetime="entry.completedAt" class="shrink-0 text-xs text-[var(--color-fg-muted)]">
            {{ formatDate(entry.completedAt) }}
          </time>
        </li>
      </ol>
    </section>
  </div>
</template>
