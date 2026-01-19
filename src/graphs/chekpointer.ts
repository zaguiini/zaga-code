import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { DB_PATH } from '@/graphs/db/constants'

export const getCheckpointer = () => {
  return SqliteSaver.fromConnString(DB_PATH)
}
