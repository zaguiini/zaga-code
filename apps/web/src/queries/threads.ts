import { queryOptions } from '@tanstack/react-query'
import { trpcClient } from '@/lib/trpc'

export const threadsSearchQuery = () =>
  queryOptions({
    queryKey: ['threads'],
    queryFn: () => trpcClient.threads.list.query(),
    refetchOnMount: 'always', // Always refetch when component mounts
  })
