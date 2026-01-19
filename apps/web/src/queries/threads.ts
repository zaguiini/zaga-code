import { queryOptions } from '@tanstack/react-query'
import { client } from '@/lib/ai-client'

export const threadsSearchQuery = () =>
  queryOptions({
    queryKey: ['threads'],
    queryFn: () => client.threads.search(),
    refetchOnMount: 'always', // Always refetch when component mounts
  })
