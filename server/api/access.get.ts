import { readAccessSession } from '../utils/access.ts'

export default defineEventHandler((event) => readAccessSession(event, true))
