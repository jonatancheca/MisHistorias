/**
 * Catálogo semilla jugable (M4/M6).
 * 8 Experiences / 12 Personajes / 12 Lugares — metadatos, sin blobs.
 */
export const NSFW_SEED_CHARACTERS = [
  { name: 'Nora', tags: ['directa', 'nocturna'] },
  { name: 'Mar', tags: ['cálida', 'humor'] },
  { name: 'Iván', tags: ['reservado', 'leal'] },
  { name: 'Sol', tags: ['juguetona', 'urbana'] },
  { name: 'Teo', tags: ['intelectual', 'seco'] },
  { name: 'Lina', tags: ['intensa', 'artística'] },
  { name: 'Bruno', tags: ['protector', 'silencioso'] },
  { name: 'Cira', tags: ['irónica', 'nocturna'] },
  { name: 'Álex', tags: ['fluido', 'curioso'] },
  { name: 'Vera', tags: ['dominante', 'precisa'] },
  { name: 'Nico', tags: ['suave', 'musical'] },
  { name: 'Rita', tags: ['práctica', 'cálida'] }
] as const

export const NSFW_SEED_PLACES = [
  { name: 'Terraza alta', setting: 'Exterior', era: 'Contemporánea' },
  { name: 'Biblioteca cerrada', setting: 'Interior', era: 'Contemporánea' },
  { name: 'Tren nocturno', setting: 'Transporte', era: 'Contemporánea' },
  { name: 'Cocina estrecha', setting: 'Interior', era: 'Contemporánea' },
  { name: 'Azotea con luces', setting: 'Exterior', era: 'Contemporánea' },
  { name: 'Habitación de hotel', setting: 'Interior', era: 'Contemporánea' },
  { name: 'Calle mojada', setting: 'Exterior', era: 'Contemporánea' },
  { name: 'Estudio con lienzos', setting: 'Interior', era: 'Contemporánea' },
  { name: 'Bar casi vacío', setting: 'Interior', era: 'Contemporánea' },
  { name: 'Playa fuera de temporada', setting: 'Exterior', era: 'Contemporánea' },
  { name: 'Oficina después de hora', setting: 'Interior', era: 'Contemporánea' },
  { name: 'Pasillo de teatro', setting: 'Interior', era: 'Contemporánea' }
] as const

export const NSFW_SEED_EXPERIENCES = [
  {
    title: 'Último tren',
    premise: 'Compartís el vagón casi vacío y la conversación se vuelve demasiado personal.'
  },
  {
    title: 'Clave equivocada',
    premise: 'Llegas al piso equivocado; la persona que abre no te echa de inmediato.'
  },
  {
    title: 'Ensayo a solas',
    premise: 'Tras el ensayo, solo quedan dos personas y una partitura a medias.'
  },
  {
    title: 'Turno de noche',
    premise: 'El cierre del local deja espacio para confesiones que de día no caben.'
  },
  {
    title: 'Lluvia sin taxi',
    premise: 'Os resguardáis bajo el mismo toldo; el tiempo se estira.'
  },
  {
    title: 'Foto sin flash',
    premise: 'Una sesión improvisada empieza como trabajo y deja de serlo.'
  },
  {
    title: 'Vecinos de balcón',
    premise: 'Dos terrazas enfrentadas; una noche cualquiera se vuelve cita.'
  },
  {
    title: 'Lista de espera',
    premise: 'En la sala de espera, la conversación salta del protocolo a lo íntimo.'
  }
] as const
