// @ts-ignore -- Types are needed so router compiles
import { TrackedData } from '@trpc/server/unstable-core-do-not-import'
import { router } from '../trpc'
import { threadsRouter } from './threads'
import { runsRouter } from './runs'

export const appRouter = router({
  threads: threadsRouter,
  runs: runsRouter,
})

export type AppRouter = typeof appRouter
