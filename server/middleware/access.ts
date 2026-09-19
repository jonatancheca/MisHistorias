import { getRequestURL } from 'h3'
import { readAccessSession } from '../utils/access.ts'

export default defineEventHandler(async (event) => {
  const pathname = getRequestURL(event).pathname
  if (!pathname.startsWith('/api/') || pathname === '/api/health' || pathname === '/api/access') {
    return
  }
  await readAccessSession(event)
})
