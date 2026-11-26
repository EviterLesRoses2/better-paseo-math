import type { TaskListData, TaskItemData } from "../../shared/contracts";
import { todoTaskStatus, type TodoTask } from "../state/todo-timeline";

/** A host todo list as the checklist draws it. */
export function todoTaskListData(items: readonly TodoTask[]): TaskListData {
  const tasks: TaskItemData[] = (items || []).map((task, idx) => {
    const status = todoTaskStatus(task);
    const text = typeof task.text === "string" ? task.text : "Untitled task";
    return {
      id: typeof task.id === "string" ? task.id : `todo-${idx}`,
      // As Paseo does: the task in progress reads as what is happening now.
      title: status === "in_progress" && typeof task.activeForm === "string" && task.activeForm ? task.activeForm : text,
      phase: "Execution",
      status,
    };
  });

  return {
    id: "live-todo",
    phaseName: "Checklist Progress",
    tasks,
  };
}
