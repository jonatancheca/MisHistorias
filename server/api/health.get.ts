import { getStorage } from '../utils/storage'

export default defineEventHandler(() => getStorage().health())
