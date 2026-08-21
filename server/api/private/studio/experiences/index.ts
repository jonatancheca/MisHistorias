import { requireSessionUser } from '../../../../utils/nsfwAuth.ts'
import { createExperience, listExperiences } from '../../../../utils/nsfwStudio.ts'

export default defineEventHandler(async (event) => {
  const user = requireSessionUser(event)
  if (event.method === 'GET') return { experiences: listExperiences(user.id) }
  const body = (await readBody(event)) as Record<string, unknown>
  const experience = createExperience(user.id, {
    title: typeof body.title === 'string' ? body.title : '',
    premise: typeof body.premise === 'string' ? body.premise : '',
    adultProfile: typeof body.adultProfile === 'string' ? body.adultProfile : undefined,
    planSeeds: Array.isArray(body.planSeeds)
      ? body.planSeeds.filter((item): item is string => typeof item === 'string')
      : [],
    endings: Array.isArray(body.endings)
      ? body.endings.filter((item): item is string => typeof item === 'string')
      : []
  })
  return { experience }
})
