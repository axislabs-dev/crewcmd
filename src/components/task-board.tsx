"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Task, Agent, TaskStatus, TimeEntry } from "@/lib/data";

interface ProjectDoc {
  name: string;
  url: string;
}

interface Project {
  id: string;
  name: string;
  color?: string;
  documents?: ProjectDoc[] | null;
}

interface TaskComment {
  id: string;
  taskId: string;
  agentId: string | null;
  content: string;
  createdAt: string;
}

interface TaskBoardProps {
  initialTasks: Task[];
  agents: Agent[];
  projects?: Project[];
}

const columns: { key: TaskStatus; label: string }[] = [
  { key: "backlog", label: "BACKLOG" },
  { key: "inbox", label: "INBOX" },
  { key: "queued", label: "QUEUED" },
  { key: "in_progress", label: "IN PROGRESS" },
  { key: "review", label: "REVIEW" },
  { key: "done", label: "DONE" },
];

const columnColors: Record<TaskStatus, string> = {
  backlog: "#555",
  inbox: "#666",
  queued: "#00f0ff",
  in_progress: "#f0ff00",
  review: "#ff00aa",
  done: "#00ff88",
};

const priorityStyles: Record<string, string> = {
  low: "text-[var(--text-tertiary)] bg-[var(--bg-surface-hover)]",
  medium: "text-blue-400 bg-blue-400/10",
  high: "text-orange-400 bg-orange-400/10",
  critical: "text-red-400 bg-red-400/10",
};

export function TaskBoard({ initialTasks, agents, projects = [] }: TaskBoardProps) {
  const [boardTasks, setBoardTasks] = useState<Task[]>(initialTasks);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    description: "",
    priority: "medium" as string,
    status: "inbox" as string,
    assignedAgentId: "",
    humanAssignee: "",
    projectId: "",
  });
  const [saving, setSaving] = useState(false);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loadingComments, setLoadingComments] = useState(false);
  const [copiedTaskId, setCopiedTaskId] = useState<string | null>(null);
  const [copiedDescription, setCopiedDescription] = useState(false);

  const [activeTimers, setActiveTimers] = useState<Map<string, TimeEntry>>(new Map());
  const [timerTick, setTimerTick] = useState(0);
  const [taskTimeEntries, setTaskTimeEntries] = useState<TimeEntry[]>([]);
  const [loadingTimeEntries, setLoadingTimeEntries] = useState(false);

  // Task documents state
  interface TaskDoc {
    id: string;
    title: string;
    content: string;
    category: string;
    projectId: string | null;
    taskId: string | null;
    createdAt: string;
    updatedAt: string;
  }
  const [taskDocs, setTaskDocs] = useState<TaskDoc[]>([]);
  const [loadingTaskDocs, setLoadingTaskDocs] = useState(false);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [docEditMode, setDocEditMode] = useState(false);
  const [docEditTitle, setDocEditTitle] = useState("");
  const [docEditContent, setDocEditContent] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);
  const [showNewDocForm, setShowNewDocForm] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocContent, setNewDocContent] = useState("");
  const [creatingDoc, setCreatingDoc] = useState(false);

  // Task images state
  const [taskImages, setTaskImages] = useState<Array<{ url: string; filename: string; uploadedAt: string }>>([]);
  const [loadingTaskImages, setLoadingTaskImages] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageInput, setImageInput] = useState<HTMLInputElement | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);
  
  // Lightbox state for viewing images
  const [lightboxImage, setLightboxImage] = useState<{ url: string; filename: string } | null>(null);

  const formatShortId = (shortId: number) => `TSK-${String(shortId).padStart(4, "0")}`;

  const copyShortId = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation();
    navigator.clipboard.writeText(formatShortId(task.shortId));
    setCopiedTaskId(task.id);
    setTimeout(() => setCopiedTaskId(null), 1500);
  };

  const copyDescription = useCallback(() => {
    if (selectedTask?.description) {
      navigator.clipboard.writeText(selectedTask.description);
      setCopiedDescription(true);
      setTimeout(() => setCopiedDescription(false), 1500);
    }
  }, [selectedTask?.description]);

  // Load images for the selected task
  const loadTaskImages = useCallback(async (taskId: string) => {
    if (!taskId) {
      setTaskImages([]);
      return;
    }

    setLoadingTaskImages(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/images`);
      if (res.ok) {
        const data = await res.json();
        setTaskImages(data.images || []);
      } else {
        console.error("Failed to load task images");
        setTaskImages([]);
      }
    } catch (error) {
      console.error("Error loading task images:", error);
      setTaskImages([]);
    } finally {
      setLoadingTaskImages(false);
    }
  }, []);

  // Update images when a task is selected
  useEffect(() => {
    if (selectedTask) {
      loadTaskImages(selectedTask.id);
    }
  }, [selectedTask?.id, loadTaskImages]);

  // Upload one or more image files to the selected task
  const uploadFiles = useCallback(async (files: File[]) => {
    if (!selectedTask || files.length === 0) return;

    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    setUploadingImage(true);
    try {
      const formData = new FormData();
      for (const file of imageFiles) {
        formData.append("files", file);
      }

      const res = await fetch(`/api/tasks/${selectedTask.id}/images`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        setTaskImages(data.images || []);
        setSelectedTask((prev) => prev ? { ...prev, images: data.images || [] } : null);
      } else {
        const error = await res.json();
        alert(`Failed to upload image: ${error.error}`);
      }
    } catch (error) {
      console.error("Error uploading image:", error);
      alert("Failed to upload image");
    } finally {
      setUploadingImage(false);
      if (imageInput) imageInput.value = "";
    }
  }, [selectedTask, imageInput]);

  // Handle file input change
  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await uploadFiles(Array.from(files));
  }, [uploadFiles]);

  // Handle drag & drop
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    await uploadFiles(files);
  }, [uploadFiles]);

  // Handle paste from clipboard
  useEffect(() => {
    if (!selectedTask) return;

    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }

      if (imageFiles.length > 0) {
        e.preventDefault();
        await uploadFiles(imageFiles);
      }
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [selectedTask, uploadFiles]);

  useEffect(() => {
    setBoardTasks(initialTasks);
  }, [initialTasks]);

  useEffect(() => {
    async function fetchActiveTimers() {
      try {
        const res = await fetch("/api/time-entries?active=true");
        if (res.ok) {
          const data = await res.json();
          const entries: TimeEntry[] = data.entries ?? [];
          const map = new Map<string, TimeEntry>();
          for (const e of entries) {
            map.set(e.taskId, e);
          }
          setActiveTimers(map);
        }
      } catch { /* ignore */ }
    }
    fetchActiveTimers();
  }, []);

  useEffect(() => {
    if (activeTimers.size === 0) return;
    const id = setInterval(() => setTimerTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [activeTimers.size]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const refresh = async () => {
      try {
        const res = await fetch("/api/tasks");
        if (res.ok) {
          const fresh = await res.json();
          setBoardTasks((current) => {
            // Don't overwrite if user is actively dragging
            if (dragRef.current?.isDragging) return current;
            return fresh;
          });
        }
      } catch {
        // silently ignore refresh failures
      }
    };

    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, []);

  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);

  // Pointer-based drag state
  const dragRef = useRef<{
    taskId: string;
    startX: number;
    startY: number;
    clone: HTMLDivElement | null;
    isDragging: boolean;
  } | null>(null);

  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const projectMap = new Map(projects.map((p) => [p.id, p]));

  async function loadComments(taskId: string) {
    setLoadingComments(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data);
      }
    } catch {
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  }

  async function postComment() {
    if (!selectedTask || !newComment.trim()) return;
    try {
      const res = await fetch(`/api/tasks/${selectedTask.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newComment.trim(), agentId: "admin" }),
      });
      if (res.ok) {
        const comment = await res.json();
        setComments((prev) => [comment, ...prev]);
        setNewComment("");
      }
    } catch { /* ignore */ }
  }

  async function loadTaskDocs(taskId: string) {
    setLoadingTaskDocs(true);
    setActiveDocId(null);
    setDocEditMode(false);
    try {
      const res = await fetch(`/api/docs?taskId=${taskId}`);
      if (res.ok) {
        const data = await res.json();
        setTaskDocs(Array.isArray(data) ? data : []);
      }
    } catch {
      setTaskDocs([]);
    } finally {
      setLoadingTaskDocs(false);
    }
  }

  async function createTaskDoc(taskId: string, projectId: string | null) {
    if (!newDocTitle.trim()) return;
    setCreatingDoc(true);
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newDocTitle,
          content: newDocContent || `# ${newDocTitle}\n\n`,
          category: "general",
          taskId,
          projectId: projectId || null,
        }),
      });
      if (res.ok) {
        const doc = await res.json();
        setTaskDocs((prev) => [doc, ...prev]);
        setShowNewDocForm(false);
        setNewDocTitle("");
        setNewDocContent("");
        setActiveDocId(doc.id);
        setDocEditTitle(doc.title);
        setDocEditContent(doc.content);
        setDocEditMode(false);
      }
    } finally {
      setCreatingDoc(false);
    }
  }

  async function saveTaskDoc(docId: string) {
    setSavingDoc(true);
    try {
      const res = await fetch(`/api/docs/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: docEditTitle, content: docEditContent }),
      });
      if (res.ok) {
        const updated = await res.json();
        setTaskDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
        setDocEditMode(false);
      }
    } finally {
      setSavingDoc(false);
    }
  }

  async function deleteTaskDoc(docId: string) {
    await fetch(`/api/docs/${docId}`, { method: "DELETE" });
    setTaskDocs((prev) => prev.filter((d) => d.id !== docId));
    if (activeDocId === docId) {
      setActiveDocId(null);
      setDocEditMode(false);
    }
  }

  async function startTimer(taskId: string, humanAssignee: string) {
    try {
      const res = await fetch(`/api/tasks/${taskId}/time-entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ humanAssignee }),
      });
      if (res.ok) {
        const entry: TimeEntry = await res.json();
        setActiveTimers((prev) => new Map(prev).set(taskId, entry));
      } else if (res.status === 409) {
        const data = await res.json();
        if (data.activeEntry) {
          setActiveTimers((prev) => new Map(prev).set(data.activeEntry.taskId, data.activeEntry));
        }
      }
    } catch { /* ignore */ }
  }

  async function stopTimer(taskId: string, timeEntryId: string, note?: string) {
    const prev = activeTimers.get(taskId);
    setActiveTimers((m) => {
      const next = new Map(m);
      next.delete(taskId);
      return next;
    });

    try {
      const res = await fetch(`/api/tasks/${taskId}/time-entries`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeEntryId, note }),
      });
      if (res.ok) {
        const stopped: TimeEntry = await res.json();
        setTaskTimeEntries((entries) =>
          entries.map((e) => (e.id === stopped.id ? stopped : e))
        );
      }
    } catch {
      if (prev) {
        setActiveTimers((m) => new Map(m).set(taskId, prev));
      }
    }
  }

  function getElapsedSeconds(entry: TimeEntry): number {
    return Math.floor(
      (Date.now() - new Date(entry.startedAt).getTime()) / 1000
    );
  }

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function formatDurationShort(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    if (m > 0) return `${m}m`;
    return `${seconds}s`;
  }

  async function loadTimeEntries(taskId: string) {
    setLoadingTimeEntries(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/time-entries`);
      if (res.ok) {
        const data = await res.json();
        setTaskTimeEntries(data);
      }
    } catch {
      setTaskTimeEntries([]);
    } finally {
      setLoadingTimeEntries(false);
    }
  }

  function openTaskDetail(task: Task) {
    setSelectedTask(task);
    setEditForm({
      title: task.title,
      description: task.description || "",
      priority: task.priority,
      status: task.status,
      assignedAgentId: task.assignedAgentId || "",
      humanAssignee: task.humanAssignee || "",
      projectId: task.projectId || "",
    });
    setEditing(false);
    setComments([]);
    setNewComment("");
    setTaskDocs([]);
    setShowNewDocForm(false);
    loadComments(task.id);
    loadTaskDocs(task.id);
    loadTimeEntries(task.id);
  }

  async function saveTask() {
    if (!selectedTask) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tasks/${selectedTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editForm.title,
          description: editForm.description || null,
          priority: editForm.priority,
          status: editForm.status,
          assignedAgentId: editForm.assignedAgentId || null,
          humanAssignee: editForm.humanAssignee || null,
          projectId: editForm.projectId || null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setBoardTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
        setSelectedTask(updated);
        setEditing(false);

        // Slack notification is handled server-side via the PATCH API route
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteTask() {
    if (!selectedTask || !confirm("Delete this task?")) return;
    try {
      const res = await fetch(`/api/tasks/${selectedTask.id}`, { method: "DELETE" });
      if (res.ok) {
        setBoardTasks((prev) => prev.filter((t) => t.id !== selectedTask.id));
        setSelectedTask(null);
      }
    } catch { /* empty */ }
  }

  async function moveTaskToColumn(taskId: string, newStatus: TaskStatus) {
    const previousTasks = boardTasks;

    setBoardTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, status: newStatus, updatedAt: new Date().toISOString() }
          : t
      )
    );
    setDraggedTaskId(null);
    setDragOverColumn(null);
    setDragOverTaskId(null);

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update task");
    } catch {
      setBoardTasks(previousTasks);
    }
  }

  async function reorderTasks(taskId: string, targetTaskId: string) {
    const previousTasks = boardTasks;
    const draggedTask = boardTasks.find((t) => t.id === taskId);
    const targetTask = boardTasks.find((t) => t.id === targetTaskId);
    
    if (!draggedTask || !targetTask || draggedTask.status !== targetTask.status) {
      setDraggedTaskId(null);
      setDragOverTaskId(null);
      return;
    }

    // Get all tasks in this column, sorted by sortIndex
    const columnTasks = boardTasks
      .filter((t) => t.status === draggedTask.status)
      .sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0));
    
    const dragIndex = columnTasks.findIndex((t) => t.id === taskId);
    const dropIndex = columnTasks.findIndex((t) => t.id === targetTaskId);
    
    if (dragIndex === -1 || dropIndex === -1 || dragIndex === dropIndex) {
      setDraggedTaskId(null);
      setDragOverTaskId(null);
      return;
    }

    // Reorder in local state
    const reordered = [...columnTasks];
    const [removed] = reordered.splice(dragIndex, 1);
    reordered.splice(dropIndex, 0, removed);
    
    // Update sortIndex for all affected tasks
    const updates = reordered.map((t, i) => ({ ...t, sortIndex: i }));
    
    setBoardTasks((prev) =>
      prev.map((t) => {
        const update = updates.find((u) => u.id === t.id);
        return update ? { ...t, sortIndex: update.sortIndex } : t;
      })
    );
    setDraggedTaskId(null);
    setDragOverTaskId(null);

    // Persist to backend - update sortIndex for affected tasks
    try {
      await Promise.all(
        updates.map((t) =>
          fetch(`/api/tasks/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sortIndex: t.sortIndex }),
          })
        )
      );
    } catch {
      setBoardTasks(previousTasks);
    }
  }

  function detectColumnAtPoint(x: number, y: number): TaskStatus | null {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      const col = (el as HTMLElement).closest<HTMLElement>("[data-column-id]");
      if (col) return col.dataset.columnId as TaskStatus;
    }
    return null;
  }

  function detectTaskAtPoint(x: number, y: number): string | null {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      const task = (el as HTMLElement).closest<HTMLElement>("[data-task-id]");
      if (task) return task.dataset.taskId || null;
    }
    return null;
  }

  function cleanupDrag() {
    if (dragRef.current?.clone) {
      dragRef.current.clone.remove();
    }
    dragRef.current = null;
    setDraggedTaskId(null);
    setDragOverColumn(null);
    setDragOverTaskId(null);
  }

  function handlePointerDown(e: React.PointerEvent, taskId: string) {
    // Only primary button (left click / touch)
    if (e.button !== 0) return;
    // Don't interfere with interactive elements inside the card
    const target = e.target as HTMLElement;
    if (target.closest("select, button, a, input")) return;

    dragRef.current = {
      taskId,
      startX: e.clientX,
      startY: e.clientY,
      clone: null,
      isDragging: false,
    };
  }

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (!drag.isDragging) {
      // Only start drag if pointer moved >8px from start
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      drag.isDragging = true;
      setDraggedTaskId(drag.taskId);

      // Create visual clone
      const sourceCard = document.querySelector<HTMLElement>(`[data-task-id="${drag.taskId}"]`);
      if (sourceCard) {
        const rect = sourceCard.getBoundingClientRect();
        const clone = document.createElement("div");
        clone.innerHTML = sourceCard.innerHTML;
        clone.className = sourceCard.className;
        clone.style.cssText = `
          position: fixed;
          width: ${rect.width}px;
          pointer-events: none;
          z-index: 9999;
          opacity: 0.85;
          transform: rotate(2deg);
          box-shadow: 0 8px 32px rgba(0,0,0,0.4);
          left: ${e.clientX - rect.width / 2}px;
          top: ${e.clientY - 20}px;
        `;
        document.body.appendChild(clone);
        drag.clone = clone;
      }
    }

    // Move clone
    if (drag.clone) {
      const w = drag.clone.offsetWidth;
      drag.clone.style.left = `${e.clientX - w / 2}px`;
      drag.clone.style.top = `${e.clientY - 20}px`;
    }

    // Detect column under pointer
    // Temporarily hide clone so elementFromPoint hits the column
    if (drag.clone) drag.clone.style.display = "none";
    const col = detectColumnAtPoint(e.clientX, e.clientY);
    const overTask = detectTaskAtPoint(e.clientX, e.clientY);
    if (drag.clone) drag.clone.style.display = "";
    setDragOverColumn(col);
    setDragOverTaskId(overTask);
  }, []);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    if (drag.isDragging) {
      // Hide clone to detect element below
      if (drag.clone) drag.clone.style.display = "none";
      
      // First check if we're over a task (reorder within column)
      const overTaskId = detectTaskAtPoint(e.clientX, e.clientY);
      if (overTaskId && overTaskId !== drag.taskId) {
        const overTask = boardTasks.find((t) => t.id === overTaskId);
        const draggedTask = boardTasks.find((t) => t.id === drag.taskId);
        
        // Only reorder if same column
        if (overTask && draggedTask && overTask.status === draggedTask.status) {
          reorderTasks(drag.taskId, overTaskId);
          cleanupDrag();
          return;
        }
      }
      
      // Otherwise check if we're over a column (move to column)
      const col = detectColumnAtPoint(e.clientX, e.clientY);
      if (drag.clone) drag.clone.style.display = "";

      if (col && col !== boardTasks.find((t) => t.id === drag.taskId)?.status) {
        moveTaskToColumn(drag.taskId, col);
      } else {
        setDraggedTaskId(null);
        setDragOverColumn(null);
        setDragOverTaskId(null);
      }
    }

    cleanupDrag();
  }, [boardTasks]);

  // Attach window-level pointer listeners
  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      cleanupDrag();
    };
  }, [handlePointerMove, handlePointerUp]);

  // Filter columns based on showDone toggle
  const visibleColumns = showDone 
    ? columns 
    : columns.filter(col => col.key !== "done");

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
          Task Board
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowDone(!showDone)}
            className={`text-[10px] tracking-wider transition-colors ${
              showDone
                ? "text-neo/60 hover:text-neo"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {showDone ? "◉ DONE SHOWN" : "○ SHOW DONE"}
          </button>
          <span className="text-[10px] text-[var(--text-tertiary)]">
            Click task for details · Drag between columns
          </span>
        </div>
      </div>

      {/* Image Lightbox Modal */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute -top-10 right-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.filename}
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
            />
            <div className="mt-2 text-center">
              <span className="text-xs text-[var(--text-secondary)]">{lightboxImage.filename}</span>
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelectedTask(null)}>
          <div className="glass-card flex w-full max-w-2xl flex-col space-y-4 overflow-y-auto p-6" style={{ maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: columnColors[selectedTask.status as TaskStatus] }} />
                <span className="text-[10px] tracking-wider text-[var(--text-tertiary)]">
                  {selectedTask.status.replace("_", " ").toUpperCase()}
                </span>
                {selectedTask.projectId && projectMap.get(selectedTask.projectId) && (() => {
                  const project = projectMap.get(selectedTask.projectId)!;
                  const projectColor = project.color || "#00f0ff";
                  return (
                    <>
                      <span className="text-[var(--text-tertiary)]">·</span>
                      <span 
                        className="rounded-full border px-2 py-0.5 text-[9px] tracking-wider"
                        style={{ 
                          borderColor: `${projectColor}30`,
                          backgroundColor: `${projectColor}15`,
                          color: projectColor,
                        }}
                      >
                        📁 {project.name.toUpperCase()}
                      </span>
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center gap-2">
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="rounded-lg border border-[var(--border-medium)] px-3 py-1.5 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-neo"
                  >
                    EDIT
                  </button>
                )}
                <button
                  onClick={deleteTask}
                  className="rounded-lg border border-red-500/20 px-3 py-1.5 text-[10px] tracking-wider text-red-400/40 transition-colors hover:text-red-400"
                >
                  DELETE
                </button>
                <button
                  onClick={() => setSelectedTask(null)}
                  className="text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">TITLE</label>
                  <input
                    type="text"
                    value={editForm.title}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-neo/30"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">DESCRIPTION</label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    rows={4}
                    className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-neo/30"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">STATUS</label>
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-neo/30"
                    >
                      <option value="backlog">Backlog</option>
                      <option value="inbox">Inbox</option>
                      <option value="queued">Queued</option>
                      <option value="in_progress">In Progress</option>
                      <option value="review">Review</option>
                      <option value="done">Done</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">PRIORITY</label>
                    <select
                      value={editForm.priority}
                      onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-neo/30"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">ASSIGN TO AGENT</label>
                    <select
                      value={editForm.assignedAgentId}
                      onChange={(e) => setEditForm({ ...editForm, assignedAgentId: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-neo/30"
                    >
                      <option value="">Unassigned</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.emoji} {a.callsign}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">ASSIGN TO HUMAN</label>
                    <select
                      value={editForm.humanAssignee}
                      onChange={(e) => setEditForm({ ...editForm, humanAssignee: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-red-400/30"
                    >
                      <option value="">None</option>
                      <option value="admin">👤 Admin</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] tracking-wider text-[var(--text-tertiary)]">PROJECT</label>
                    <select
                      value={editForm.projectId}
                      onChange={(e) => setEditForm({ ...editForm, projectId: e.target.value })}
                      className="w-full rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none focus:border-neo/30"
                    >
                      <option value="">No project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>📁 {p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setEditing(false)}
                    className="rounded-lg border border-[var(--border-medium)] px-4 py-2 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
                  >
                    CANCEL
                  </button>
                  <button
                    onClick={saveTask}
                    disabled={saving}
                    className="rounded-lg bg-neo/20 px-4 py-2 text-[10px] tracking-wider text-neo transition-all duration-200 hover:bg-neo/30 disabled:opacity-30"
                  >
                    {saving ? "SAVING..." : "SAVE CHANGES"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => copyShortId(e, selectedTask)}
                    className="shrink-0 rounded border border-[var(--border-medium)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-secondary)]"
                    title="Copy task ID"
                  >
                    {copiedTaskId === selectedTask.id ? "Copied!" : formatShortId(selectedTask.shortId)}
                  </button>
                  <h2 className="text-sm font-bold tracking-wider text-[var(--text-primary)]">
                    {selectedTask.title}
                  </h2>
                </div>
                {/* Context docs banner — shown before description so agents read it first */}
                {selectedTask.projectId && (() => {
                  const proj = projectMap.get(selectedTask.projectId!);
                  const docs = proj?.documents;
                  if (!docs || docs.length === 0) return null;
                  return (
                    <div className="rounded-lg border border-yellow-400/25 bg-yellow-400/5 p-3">
                      <div className="mb-2 flex items-center gap-1.5">
                        <svg className="h-3.5 w-3.5 shrink-0 text-yellow-400/70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.95 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                        </svg>
                        <span className="text-[9px] tracking-[0.2em] text-yellow-400/70">READ BEFORE STARTING</span>
                      </div>
                      <div className="space-y-1">
                        {docs.map((doc, i) => (
                          <a
                            key={i}
                            href={doc.url.startsWith("http") ? doc.url : `/docs?file=${encodeURIComponent(doc.url)}`}
                            target={doc.url.startsWith("http") ? "_blank" : undefined}
                            rel={doc.url.startsWith("http") ? "noopener noreferrer" : undefined}
                            className="flex items-center gap-2 text-[11px] text-yellow-300/70 transition-colors hover:text-yellow-300"
                          >
                            <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                            </svg>
                            {doc.name}
                            {doc.url.startsWith("http") && <span className="text-yellow-400/30">↗</span>}
                          </a>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                {selectedTask.description && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[9px] tracking-wider text-[var(--text-tertiary)]">DESCRIPTION</span>
                      <button
                        onClick={copyDescription}
                        className="shrink-0 rounded border border-[var(--border-medium)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[9px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-secondary)]"
                        title="Copy description"
                      >
                        {copiedDescription ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <div className="prose prose-invert max-w-none text-[11px] leading-relaxed text-[var(--text-tertiary)] [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:mb-0.5 [&_h1]:text-[var(--text-primary)] [&_h2]:text-[var(--text-secondary)] [&_h3]:text-[var(--text-secondary)] [&_strong]:text-[var(--text-secondary)] [&_code]:text-neo [&_code]:bg-[var(--bg-surface-hover)] [&_code]:px-1 [&_code]:rounded [&_hr]:border-[var(--border-medium)] [&_hr]:my-3">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {selectedTask.description}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}

                {/* Task Images — drag & drop zone */}
                <div
                  className={`border-t border-[var(--border-subtle)] pt-4 rounded-lg transition-all ${
                    isDraggingOver
                      ? "bg-neo/[0.06] ring-2 ring-neo/30 ring-inset"
                      : ""
                  }`}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
                      {loadingTaskImages ? "Loading..." : `Images (${taskImages.length})`}
                    </h3>
                    <div className="flex items-center gap-2">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleImageUpload}
                        ref={(ref) => setImageInput(ref)}
                        disabled={uploadingImage}
                        className="hidden"
                        id="task-image-upload"
                      />
                      <button
                        onClick={() => imageInput?.click()}
                        disabled={uploadingImage}
                        className="text-[10px] text-neo/50 hover:text-neo/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {uploadingImage ? "Uploading…" : "+ Add Image"}
                      </button>
                    </div>
                  </div>

                  {isDraggingOver && (
                    <div className="mb-3 flex items-center justify-center rounded-lg border-2 border-dashed border-neo/40 bg-neo/[0.04] py-8">
                      <div className="text-center">
                        <svg className="mx-auto mb-2 h-8 w-8 text-neo/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                        </svg>
                        <span className="text-[11px] text-neo/60">Drop images here</span>
                      </div>
                    </div>
                  )}

                  {uploadingImage && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-neo/20 bg-neo/[0.04] px-3 py-2">
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-neo/30 border-t-neo" />
                      <span className="text-[10px] text-neo/60">Uploading…</span>
                    </div>
                  )}

                  {loadingTaskImages ? (
                    <p className="text-xs text-[var(--text-tertiary)] italic">Loading...</p>
                  ) : taskImages.length === 0 && !isDraggingOver ? (
                    <div
                      className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-medium)] bg-[var(--bg-surface)] py-6 transition-colors hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface)]"
                      onClick={() => imageInput?.click()}
                    >
                      <svg className="mb-2 h-6 w-6 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                      </svg>
                      <span className="text-[10px] text-[var(--text-tertiary)]">
                        Drop images here, paste from clipboard, or click to browse
                      </span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {taskImages.map((image, index) => (
                        <div key={index} className="group relative">
                          <div 
                            className="relative aspect-square rounded-lg overflow-hidden border border-[var(--border-medium)] bg-[var(--bg-surface)] cursor-pointer transition-all hover:border-[var(--border-medium)]"
                            onClick={() => setLightboxImage(image)}
                          >
                            <img
                              src={image.url}
                              alt={image.filename}
                              className="w-full h-full object-cover"
                            />
                            {/* Delete overlay on hover */}
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const confirmed = confirm("Delete this image?");
                                if (!confirmed) return;

                                try {
                                  const res = await fetch(`/api/tasks/${selectedTask!.id}/images/${index}`, {
                                    method: "DELETE",
                                  });

                                  if (res.ok) {
                                    const data = await res.json();
                                    setTaskImages(data.images || []);
                                    setSelectedTask((prev) => prev ? { ...prev, images: data.images || [] } : null);
                                  } else {
                                    const errData = await res.json();
                                    alert(`Failed to delete image: ${errData.error}`);
                                  }
                                } catch (err) {
                                  console.error("Error deleting image:", err);
                                  alert("Failed to delete image");
                                }
                              }}
                              className="absolute top-1.5 right-1.5 rounded-md bg-black/60 p-1 text-red-400/60 opacity-0 backdrop-blur-sm transition-all group-hover:opacity-100 hover:text-red-400 hover:bg-black/80"
                              title="Delete image"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                          <span className="mt-1 block truncate text-[9px] text-[var(--text-tertiary)]">
                            {image.filename}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-3 border-t border-[var(--border-subtle)] pt-4">
                  <div>
                    <span className="text-[9px] tracking-wider text-[var(--text-tertiary)]">PRIORITY</span>
                    <div className={`mt-1 rounded px-2 py-0.5 text-[10px] uppercase ${priorityStyles[selectedTask.priority]}`}>
                      {selectedTask.priority}
                    </div>
                  </div>
                  <div>
                    <span className="text-[9px] tracking-wider text-[var(--text-tertiary)]">ASSIGNED TO</span>
                    <select
                      value={selectedTask.assignedAgentId || ""}
                      onChange={async (e) => {
                        const val = e.target.value || null;
                        const updated = { ...selectedTask, assignedAgentId: val };
                        setSelectedTask(updated);
                        setBoardTasks((prev) => prev.map((t) => t.id === selectedTask.id ? updated : t));
                        await fetch(`/api/tasks/${selectedTask.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignedAgentId: val }) });
                      }}
                      className="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5 text-[11px] text-[var(--text-secondary)] outline-none focus:border-neo/30"
                    >
                      <option value="">Unassigned</option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.emoji} {a.callsign}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className="text-[9px] tracking-wider text-red-400/50">HUMAN ASSIGNEE</span>
                    <div className="mt-1 flex items-center gap-2">
                      <select
                        value={selectedTask.humanAssignee || ""}
                        onChange={async (e) => {
                          const val = e.target.value || null;
                          const updated = { ...selectedTask, humanAssignee: val };
                          setSelectedTask(updated);
                          setBoardTasks((prev) => prev.map((t) => t.id === selectedTask.id ? updated : t));
                          await fetch(`/api/tasks/${selectedTask.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ humanAssignee: val }) });
                        }}
                        className="w-full rounded-lg border border-red-400/[0.08] bg-red-400/[0.02] px-2 py-1.5 text-[11px] text-red-400/50 outline-none focus:border-red-400/20"
                      >
                        <option value="">None</option>
                        <option value="admin">👤 Admin</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <span className="text-[9px] tracking-wider text-[var(--text-tertiary)]">CREATED BY</span>
                    <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                      {selectedTask.createdBy || "Unknown"}
                    </div>
                  </div>
                  <div>
                    <span className="text-[9px] tracking-wider text-[var(--text-tertiary)]">PROJECT</span>
                    <div className="mt-1 text-[11px]">
                      {selectedTask.projectId && projectMap.get(selectedTask.projectId) ? (() => {
                        const project = projectMap.get(selectedTask.projectId)!;
                        const projectColor = project.color || "#00f0ff";
                        return (
                          <span style={{ color: projectColor }}>
                            📁 {project.name}
                          </span>
                        );
                      })() : <span className="text-[var(--text-tertiary)]">No project</span>}
                    </div>
                  </div>
                  <div>
                    <span className="text-[9px] tracking-wider text-[var(--text-tertiary)]">CREATED</span>
                    <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                      {new Date(selectedTask.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  {selectedTask.prUrl && (
                    <>
                      <div>
                        <span className="text-[9px] tracking-wider text-[var(--text-tertiary)]">PR</span>
                        <div className="mt-1">
                          <a
                            href={selectedTask.prUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-neo/70 transition-colors hover:text-neo"
                          >
                            {selectedTask.prUrl.replace(/.*\/pull\//, "PR #")} ↗
                          </a>
                        </div>
                      </div>
                      <div>
                        <span className="text-[9px] tracking-wider text-[var(--text-tertiary)]">PR STATUS</span>
                        <div className={`mt-1 text-[11px] ${
                          selectedTask.prStatus === "merged" ? "text-green-400/70"
                            : selectedTask.prStatus === "changes_requested" ? "text-orange-400/70"
                            : "text-neo/50"
                        }`}>
                          {selectedTask.prStatus?.replace("_", " ").toUpperCase() || "OPEN"}
                        </div>
                      </div>
                    </>
                  )}
                  {selectedTask.branch && (
                    <div>
                      <span className="text-[9px] tracking-wider text-[var(--text-tertiary)]">BRANCH</span>
                      <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                        {selectedTask.branch}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {selectedTask.humanAssignee && (
              <div className="border-t border-[var(--border-subtle)] pt-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[10px] tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
                    TIME TRACKING
                  </h3>
                  {(() => {
                    const totalSecs = taskTimeEntries.reduce(
                      (sum, e) => sum + (e.durationSeconds ?? 0),
                      0
                    );
                    if (totalSecs === 0) return null;
                    return (
                      <span className="text-[10px] tracking-wider text-[var(--text-tertiary)]">
                        TOTAL: <span className="text-neo/70">{formatDurationShort(totalSecs)}</span>
                      </span>
                    );
                  })()}
                </div>

                {(() => {
                  const activeEntry = activeTimers.get(selectedTask.id);
                  return (
                    <div className="mb-3 flex items-center gap-3">
                      {activeEntry ? (
                        <>
                          <button
                            onClick={() => stopTimer(selectedTask.id, activeEntry.id)}
                            className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[10px] tracking-wider text-red-400 transition-all hover:bg-red-400/20"
                          >
                            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-red-400" />
                            STOP
                          </button>
                          <div className="flex items-center gap-2">
                            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-400" />
                            <span className="text-sm font-bold tabular-nums text-red-400">
                              {formatDuration(getElapsedSeconds(activeEntry))}
                            </span>
                          </div>
                        </>
                      ) : (
                        <button
                          onClick={() => startTimer(selectedTask.id, selectedTask.humanAssignee!)}
                          className="flex items-center gap-2 rounded-lg border border-green-400/20 bg-green-400/5 px-3 py-2 text-[10px] tracking-wider text-green-400/70 transition-all hover:border-green-400/40 hover:bg-green-400/10 hover:text-green-400"
                        >
                          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                          START TIMER
                        </button>
                      )}
                    </div>
                  );
                })()}

                {loadingTimeEntries ? (
                  <p className="text-[10px] text-[var(--text-tertiary)]">Loading...</p>
                ) : taskTimeEntries.filter((e) => e.stoppedAt).length === 0 ? (
                  <p className="text-[10px] text-[var(--text-tertiary)] italic">No time entries recorded yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {taskTimeEntries
                      .filter((e) => e.stoppedAt)
                      .map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-[var(--text-tertiary)]">⏱️</span>
                            <span className="text-[10px] font-bold text-neo/60">
                              {formatDurationShort(entry.durationSeconds ?? 0)}
                            </span>
                            {entry.note && (
                              <span className="text-[10px] text-[var(--text-tertiary)]">
                                — {entry.note}
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] text-[var(--text-tertiary)]">
                            {new Date(entry.startedAt).toLocaleDateString("en-AU", {
                              day: "numeric",
                              month: "short",
                            })}{" "}
                            {new Date(entry.startedAt).toLocaleTimeString("en-AU", {
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Inherited Project Documents */}
            {selectedTask.projectId && (() => {
              const proj = projectMap.get(selectedTask.projectId!);
              if (!proj?.documents?.length) return null;
              return (
                <div className="border-t border-[var(--border-subtle)] pt-4">
                  <h3 className="mb-2 text-[10px] tracking-[0.2em] text-[var(--text-tertiary)]">
                    PROJECT DOCS ({proj.documents.length})
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {proj.documents.map((doc, i) => (
                      <a
                        key={i}
                        href={doc.url.startsWith("http") ? doc.url : `/docs?file=${encodeURIComponent(doc.url)}`}
                        target={doc.url.startsWith("http") ? "_blank" : undefined}
                        rel={doc.url.startsWith("http") ? "noopener noreferrer" : undefined}
                        className="flex items-center gap-1.5 rounded-lg border border-neo/10 bg-neo/5 px-2.5 py-1 text-[10px] text-neo/60 transition-colors hover:border-neo/20 hover:text-neo/80"
                      >
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                        {doc.name}
                      </a>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Task Documents */}
            <div className="border-t border-[var(--border-subtle)] pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[10px] tracking-[0.2em] text-[var(--text-tertiary)] uppercase">Documents</h3>
                <button
                  onClick={() => setShowNewDocForm((v) => !v)}
                  className="text-[10px] text-neo/50 hover:text-neo/80 transition-colors"
                >
                  {showNewDocForm ? "cancel" : "+ new doc"}
                </button>
              </div>

              {showNewDocForm && (
                <div className="mb-3 rounded-lg border border-neo/20 bg-neo/5 p-3 space-y-2">
                  <input
                    type="text"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    placeholder="Document title"
                    className="w-full bg-transparent border border-[var(--border-medium)] rounded px-2 py-1.5 text-xs focus:outline-none focus:border-neo/40"
                  />
                  <textarea
                    value={newDocContent}
                    onChange={(e) => setNewDocContent(e.target.value)}
                    placeholder="Optional initial content (markdown)..."
                    className="w-full bg-transparent border border-[var(--border-medium)] rounded px-2 py-1.5 text-xs font-mono h-20 resize-none focus:outline-none focus:border-neo/40"
                  />
                  <button
                    onClick={() => createTaskDoc(selectedTask!.id, selectedTask!.projectId ?? null)}
                    disabled={creatingDoc || !newDocTitle.trim()}
                    className="w-full text-xs py-1.5 rounded bg-neo/20 hover:bg-neo/30 text-neo disabled:opacity-40 transition-colors"
                  >
                    {creatingDoc ? "Creating…" : "Create Document"}
                  </button>
                </div>
              )}

              {loadingTaskDocs ? (
                <p className="text-xs text-[var(--text-tertiary)] italic">Loading…</p>
              ) : taskDocs.length === 0 ? (
                <p className="text-xs text-[var(--text-tertiary)] italic">No documents linked to this task.</p>
              ) : (
                <div className="space-y-2">
                  {taskDocs.map((doc) => (
                    <div key={doc.id} className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
                      <button
                        onClick={() => {
                          if (activeDocId === doc.id) {
                            setActiveDocId(null);
                            setDocEditMode(false);
                          } else {
                            setActiveDocId(doc.id);
                            setDocEditTitle(doc.title);
                            setDocEditContent(doc.content);
                            setDocEditMode(false);
                          }
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[var(--bg-surface)] transition-colors"
                      >
                        <span className="text-xs font-medium truncate">{doc.title}</span>
                        <span className="text-[10px] text-[var(--text-tertiary)] shrink-0 ml-2">
                          {activeDocId === doc.id ? "▲" : "▼"}
                        </span>
                      </button>

                      {activeDocId === doc.id && (
                        <div className="border-t border-[var(--border-subtle)]">
                          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
                            {docEditMode ? (
                              <>
                                <button
                                  onClick={() => setDocEditMode(false)}
                                  className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                                >cancel</button>
                                <button
                                  onClick={() => saveTaskDoc(doc.id)}
                                  disabled={savingDoc}
                                  className="text-[10px] text-neo/60 hover:text-neo/80 disabled:opacity-40"
                                >{savingDoc ? "saving…" : "save"}</button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => setDocEditMode(true)}
                                  className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                                >edit</button>
                                <button
                                  onClick={() => deleteTaskDoc(doc.id)}
                                  className="text-[10px] text-red-400/40 hover:text-red-400/70 ml-auto"
                                >delete</button>
                              </>
                            )}
                          </div>
                          <div className="p-3">
                            {docEditMode ? (
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  value={docEditTitle}
                                  onChange={(e) => setDocEditTitle(e.target.value)}
                                  className="w-full bg-transparent border border-[var(--border-medium)] rounded px-2 py-1 text-xs focus:outline-none focus:border-neo/40"
                                />
                                <textarea
                                  value={docEditContent}
                                  onChange={(e) => setDocEditContent(e.target.value)}
                                  className="w-full bg-transparent border border-[var(--border-medium)] rounded px-2 py-1.5 text-xs font-mono h-48 resize-none focus:outline-none focus:border-neo/40"
                                />
                              </div>
                            ) : (
                              <div className="prose prose-invert prose-xs max-w-none text-xs [&>*]:text-[var(--text-primary)] [&>h1]:text-[var(--text-primary)] [&>h2]:text-[var(--text-primary)] [&>h3]:text-[var(--text-primary)]">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Comment Thread */}
            <div className="border-t border-[var(--border-subtle)] pt-4">
              <h3 className="mb-3 text-[10px] tracking-[0.2em] text-[var(--text-tertiary)] uppercase">
                AUDIT TRAIL ({comments.length})
              </h3>

              <div className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && postComment()}
                  placeholder="Add a comment..."
                  className="flex-1 rounded-lg border border-[var(--border-medium)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-neo/30"
                />
                <button
                  onClick={postComment}
                  disabled={!newComment.trim()}
                  className="rounded-lg border border-neo/20 bg-neo/10 px-3 py-2 text-[10px] tracking-wider text-neo transition-all hover:bg-neo/20 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  POST
                </button>
              </div>

              <div className="min-h-[120px] flex-1 space-y-2 overflow-y-auto">
                {loadingComments ? (
                  <p className="text-[10px] text-[var(--text-tertiary)]">Loading...</p>
                ) : comments.length === 0 ? (
                  <p className="text-[10px] text-[var(--text-tertiary)] italic">No comments yet</p>
                ) : (
                  comments.map((c) => {
                    const commentAgent = c.agentId ? agentMap.get(c.agentId) : null;
                    return (
                      <div key={c.id} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span
                            className="font-mono text-[9px] font-bold tracking-wider"
                            style={{ color: commentAgent?.color || "#666" }}
                          >
                            {commentAgent ? `${commentAgent.emoji} ${commentAgent.callsign}` : c.agentId || "Unknown"}
                          </span>
                          <span className="text-[8px] text-[var(--text-tertiary)]">
                            {new Date(c.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="prose-sm prose-invert max-w-none text-[11px] leading-relaxed text-[var(--text-secondary)] [&_h1]:text-[12px] [&_h1]:font-bold [&_h1]:text-[var(--text-secondary)] [&_h1]:mt-1 [&_h1]:mb-1 [&_h2]:text-[11px] [&_h2]:font-bold [&_h2]:text-[var(--text-secondary)] [&_h2]:mt-1 [&_h2]:mb-1 [&_h3]:text-[11px] [&_h3]:font-bold [&_h3]:text-[var(--text-secondary)] [&_h3]:mt-1 [&_h3]:mb-0.5 [&_strong]:text-[var(--text-secondary)] [&_table]:text-[9px] [&_table]:border-collapse [&_th]:border [&_th]:border-[var(--border-medium)] [&_th]:px-2 [&_th]:py-0.5 [&_th]:text-[var(--text-tertiary)] [&_td]:border [&_td]:border-[var(--border-subtle)] [&_td]:px-2 [&_td]:py-0.5 [&_p]:my-0.5 [&_ul]:my-0.5 [&_li]:my-0 [&_code]:text-neo/60 [&_code]:text-[10px] [&_hr]:border-[var(--border-subtle)] [&_hr]:my-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{c.content}</ReactMarkdown>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Horizontal scroll container for tablet/mobile */}
      <div className="overflow-x-auto pb-2 -mx-6 px-6">
        <div className="flex gap-3 min-w-max">
        {visibleColumns.map((col) => {
          const colTasks = boardTasks
            .filter((t) => t.status === col.key)
            .sort((a, b) => (a.sortIndex || 0) - (b.sortIndex || 0));
          const isOver = dragOverColumn === col.key;

          return (
            <div
              key={col.key}
              data-column-id={col.key}
              className={`glass-card w-[280px] min-w-[280px] shrink-0 min-h-[300px] p-3 transition-all duration-200 ${
                isOver ? "drag-over" : ""
              } ${col.key === "backlog" ? "opacity-75" : ""}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: columnColors[col.key] }}
                  />
                  <span className="text-[10px] tracking-wider text-[var(--text-secondary)]">
                    {col.label}
                  </span>
                </div>
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full text-[9px]"
                  style={{
                    backgroundColor: `${columnColors[col.key]}20`,
                    color: columnColors[col.key],
                  }}
                >
                  {colTasks.length}
                </span>
              </div>

              <div className="space-y-2">
                {colTasks.map((task) => {
                  const isDragging = draggedTaskId === task.id;
                  const isDragOver = dragOverTaskId === task.id && !isDragging;

                  return (
                    <div
                      key={task.id}
                      data-task-id={task.id}
                      onPointerDown={(e) => handlePointerDown(e, task.id)}
                      onClick={() => {
                        // Only open detail if we weren't dragging
                        if (!dragRef.current?.isDragging) openTaskDetail(task);
                      }}
                      className={`cursor-pointer rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5 transition-all duration-200 hover:border-[var(--border-medium)] hover:bg-[var(--bg-surface-hover)] ${
                        isDragging ? "opacity-40" : ""
                      } ${isDragOver ? "border-neo/50 bg-neo/5 ring-1 ring-neo/30" : ""}`}
                      style={{ touchAction: "none" }}
                    >
                      {task.projectId && projectMap.get(task.projectId) && (() => {
                        const project = projectMap.get(task.projectId)!;
                        const projectColor = project.color || "#00f0ff";
                        return (
                          <div className="mb-1.5">
                            <span 
                              className="rounded-full border px-1.5 py-0.5 text-[8px] tracking-wider"
                              style={{ 
                                borderColor: `${projectColor}30`,
                                backgroundColor: `${projectColor}15`,
                                color: projectColor,
                              }}
                            >
                              {project.name.toUpperCase()}
                            </span>
                          </div>
                        );
                      })()}

                      <div className="mb-2 flex items-start justify-between">
                        <div className="flex items-start gap-2">
                          <button
                            onClick={(e) => copyShortId(e, task)}
                            className="mt-0.5 shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1 py-0.5 font-mono text-[8px] tracking-wider text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-medium)] hover:text-[var(--text-secondary)]"
                            title="Copy task ID"
                          >
                            {copiedTaskId === task.id ? "Copied!" : formatShortId(task.shortId)}
                          </button>
                          <p className="text-xs font-medium text-[var(--text-primary)] leading-snug">
                            {task.title}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${priorityStyles[task.priority] || ""}`}
                          >
                            {task.priority}
                          </span>
                          {task.humanAssignee && (
                            <span className="flex items-center gap-0.5 rounded border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-[8px] tracking-wider text-red-400/70">
                              👤 {task.humanAssignee}
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  const previousTasks = boardTasks;
                                  setBoardTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, humanAssignee: null } : t));
                                  try {
                                    const res = await fetch(`/api/tasks/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ humanAssignee: null }) });
                                    if (!res.ok) throw new Error();
                                  } catch { setBoardTasks(previousTasks); }
                                }}
                                className="ml-0.5 text-red-400/50 hover:text-red-400"
                                title="Remove human assignee"
                              >✕</button>
                            </span>
                          )}
                        </div>
                        {(task.branch || task.prUrl) && (
                          <div className="flex items-center gap-1">
                            {task.branch && !task.prUrl && (
                              <span className="rounded border border-[var(--border-medium)] px-1.5 py-0.5 font-mono text-[8px] tracking-wider text-[var(--text-tertiary)]">
                                ⎇ {task.branch.replace(/^task\/[a-f0-9]+-/, '').slice(0, 20)}
                              </span>
                            )}
                            {task.prUrl && (
                              <a
                                href={task.prUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className={`rounded px-1.5 py-0.5 text-[8px] tracking-wider transition-colors hover:opacity-80 ${
                                  task.prStatus === "merged"
                                    ? "border border-green-400/20 text-green-400/60"
                                    : task.prStatus === "changes_requested"
                                    ? "border border-orange-400/20 text-orange-400/60"
                                    : "border border-neo/20 text-neo/60"
                                }`}
                              >
                                {task.prStatus === "merged" ? "✓ MERGED" : task.prStatus === "changes_requested" ? "⟳ CHANGES" : "PR ↗"}
                              </a>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {task.status !== "done" && (
                          <button
                            onClick={async () => {
                              const previousTasks = boardTasks;
                              setBoardTasks((prev) =>
                                prev.map((t) =>
                                  t.id === task.id ? { ...t, status: "done" as TaskStatus } : t
                                )
                              );
                              try {
                                const res = await fetch(`/api/tasks/${task.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ status: "done" }),
                                });
                                if (!res.ok) throw new Error();
                              } catch {
                                setBoardTasks(previousTasks);
                              }
                            }}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[var(--border-medium)] text-[var(--text-tertiary)] transition-all hover:border-green-400/30 hover:text-green-400"
                            title="Mark as done"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                          </button>
                        )}
                         {task.status !== "done" && !task.humanAssignee && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const previousTasks = boardTasks;
                              setBoardTasks((prev) =>
                                prev.map((t) =>
                                  t.id === task.id
                                    ? { ...t, humanAssignee: "admin" }
                                    : t
                                )
                              );
                              try {
                                const res = await fetch(`/api/tasks/${task.id}`, {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ humanAssignee: "admin" }),
                                });
                                if (!res.ok) throw new Error();
                                // Slack notification handled server-side via PATCH route
                              } catch {
                                setBoardTasks(previousTasks);
                              }
                            }}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-red-400/20 text-red-400/30 transition-all hover:border-red-400/50 hover:text-red-400"
                            title="Assign to human"
                          >
                            👤
                          </button>
                        )}
                        {task.humanAssignee && (() => {
                          const activeEntry = activeTimers.get(task.id);
                          if (activeEntry) {
                            const elapsed = getElapsedSeconds(activeEntry);
                            return (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  stopTimer(task.id, activeEntry.id);
                                }}
                                className="flex h-6 shrink-0 items-center gap-1 rounded border border-red-400/30 bg-red-400/10 px-1.5 text-[8px] tracking-wider text-red-400 transition-all hover:border-red-400/50 hover:bg-red-400/20"
                                title="Stop timer"
                              >
                                <span className="inline-block h-2 w-2 rounded-sm bg-red-400" />
                                {formatDuration(elapsed)}
                              </button>
                            );
                          }
                          return (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startTimer(task.id, task.humanAssignee!);
                              }}
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-green-400/20 text-green-400/30 transition-all hover:border-green-400/50 hover:text-green-400"
                              title="Start timer"
                            >
                              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </button>
                          );
                        })()}
                        <select
                          value={task.assignedAgentId || ""}
                          onChange={async (e) => {
                            const newAgentId = e.target.value || null;
                            const newStatus = task.status; // assigning an agent does NOT auto-queue — use Queue button
                            const previousTasks = boardTasks;
                            setBoardTasks((prev) =>
                              prev.map((t) =>
                                t.id === task.id
                                  ? { ...t, assignedAgentId: newAgentId, status: newStatus }
                                  : t
                              )
                            );
                            try {
                              const res = await fetch(`/api/tasks/${task.id}`, {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ assignedAgentId: newAgentId, status: newStatus }),
                              });
                              if (!res.ok) throw new Error();
                            } catch {
                              setBoardTasks(previousTasks);
                            }
                          }}
                          className="w-full appearance-none rounded-md border border-[var(--border-medium)] bg-[var(--bg-secondary)] px-2 py-1.5 pr-6 text-[9px] tracking-wider outline-none transition-all duration-200 focus:border-neo/40 focus:shadow-[0_0_8px_rgba(0,240,255,0.1)]"
                          style={{
                            color: task.assignedAgentId
                              ? (agentMap.get(task.assignedAgentId)?.color || "rgba(255,255,255,0.5)")
                              : "rgba(255,255,255,0.25)",
                            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.2)' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                            backgroundRepeat: "no-repeat",
                            backgroundPosition: "right 6px center",
                          }}
                        >
                          <option value="" style={{ color: "rgba(255,255,255,0.3)", backgroundColor: "#12121a" }}>⊘ Unassigned</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id} style={{ color: a.color, backgroundColor: "#12121a" }}>
                              {a.emoji} {a.callsign} — {a.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </section>
  );
}
