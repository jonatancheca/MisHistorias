import { getRequestURL } from 'h3'
import { readAccessSession } from '../utils/access.ts'

export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname
  if (!pathname.startsWith('/api/') || pathname === '/api/health' || pathname === '/api/access') {
    return
  }
  readAccessSession(event)
})
