import { getAuthStatus } from '../../../utils/nsfwAuth.ts'

export default defineEventHandler((event) => getAuthStatus(event))
