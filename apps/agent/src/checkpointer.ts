import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite'
import { dbPath } from './db'

export const checkpointer = SqliteSaver.fromConnString(dbPath)
