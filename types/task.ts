export type Task = {
  id: string;
  name: string;
  meta?: string;
  completed: boolean;
  dayKey?: string | null;
  status?: "backlog" | "planned" | "in_progress" | "done";
  order?: number;
  studyBlockId?: string | null;
};
