export type TaskPriority = "low" | "medium" | "high";

export type Task = {
  id: string;
  name: string;
  meta?: string;
  completed: boolean;
  dayKey?: string | null;
  status?: "backlog" | "planned" | "in_progress" | "done";
  order?: number;
  studyBlockId?: string | null;
  /** Planner inputs — added in Stage 3. */
  priority?: TaskPriority;
  /** "YYYY-MM-DD" or null. */
  dueDate?: string | null;
  estimatedMinutes?: number | null;
};
