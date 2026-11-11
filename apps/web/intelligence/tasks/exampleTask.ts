/**
 * Example AI Task
 *
 * This is a starter task demonstrating the Prism intelligence system.
 * Replace with your own tasks following the BaseTask pattern.
 */

import { BaseTask } from "@intelligence/tasks/base";
import type { TaskConfig, ExecutionResult } from "@intelligence/tasks/types";
import { z } from "zod";

const inputSchema = z.object({
  prompt: z.string().min(1, "Prompt is required"),
});

const outputSchema = z.object({
  result: z.string(),
});

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

export class ExampleTask extends BaseTask<Input, Output> {
  name = "example-task";
  description = "An example AI task";
  inputSchema = inputSchema;
  outputSchema = outputSchema;

  defaultConfig: TaskConfig = {
    model: "google/gemini-3-flash",
    temperature: 0.7,
    maxTokens: 500,
    retries: 3,
  };

  protected async executeTask(
    input: Input,
    _config: TaskConfig
  ): Promise<ExecutionResult<Output>> {
    // TODO: Implement your task logic here
    // This is a placeholder that returns the input as output
    return {
      data: {
        result: `Processed: ${input.prompt}`,
      },
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      },
    };
  }
}
