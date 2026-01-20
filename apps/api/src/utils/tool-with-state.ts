import { getCurrentTaskInput } from '@langchain/langgraph'
import { tool } from 'langchain'
import type { DynamicStructuredToolInput, ToolRuntime } from '@langchain/core/tools'

/**
 * Creates a tool that automatically extracts state from the LangGraph runtime.
 * This wrapper simplifies tool creation by handling state extraction via getCurrentTaskInput.
 *
 * @param fn - The tool implementation function that receives (input, state)
 * @param options - Tool options (name, description, schema)
 * @returns A LangChain tool that can access graph state
 *
 * @example
 * ```typescript
 * const stateSchema = z.object({
 *   projectPath: z.string(),
 * })
 *
 * export const myTool = toolWithState(
 *   async (input: z.infer<typeof inputSchema>, state: z.infer<typeof stateSchema>) => {
 *     // Use state.projectPath here
 *     return `Working with ${state.projectPath}`
 *   },
 *   {
 *     name: 'my_tool',
 *     description: 'Does something',
 *     schema: inputSchema,
 *   }
 * )
 * ```
 */
export type ToolRuntimeWithState<TState> = ToolRuntime & {
  state: TState
}

export function toolWithState<TInputSchema, TStateSchema>(
  fn: (
    input: TInputSchema,
    runtime: ToolRuntimeWithState<TStateSchema>
  ) => Promise<string> | string,
  options: Omit<DynamicStructuredToolInput, 'func'>
) {
  return tool(async (input: TInputSchema, runtime: ToolRuntime) => {
    // Extract state from the runtime config using getCurrentTaskInput
    const state = getCurrentTaskInput<TStateSchema>(runtime.config)

    // Call the original function with input and state
    return fn(input, { ...runtime, state })
  }, options)
}
