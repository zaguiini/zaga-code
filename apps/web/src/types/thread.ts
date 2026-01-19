/**
 * Metadata stored with each thread in LangGraph
 */
export interface ThreadMetadata {
  /**
   * Auto-generated title summarizing the thread's first message
   */
  title?: string

  /**
   * Timestamp when the thread was created
   */
  createdAt?: string

  /**
   * Additional custom metadata fields
   */
  [key: string]: unknown
}

/**
 * Thread information returned from client.threads.search()
 */
export interface Thread {
  thread_id: string
  metadata?: ThreadMetadata
  created_at?: string
  updated_at?: string
}
