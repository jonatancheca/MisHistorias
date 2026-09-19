export default defineEventHandler(() => {
  throw createError({ statusCode: 404, message: 'No encontrado' })
})
