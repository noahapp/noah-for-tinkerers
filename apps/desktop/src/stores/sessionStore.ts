import { create } from "zustand";
import type {
  ApprovalRequest,
  ChangeEntry,
  SessionRecord,
} from "../lib/tauri-commands";

type ActiveView = "chat" | "knowledge" | "diagnostics" | "settings" | "health";
export type SessionMode = "default" | "learn";

interface SessionState {
  sessionId: string | null;
  isActive: boolean;
  /** Session mode: "default" for normal chat, "learn" for knowledge-creation flow. */
  sessionMode: SessionMode;
  /** Session ID currently being processed by the LLM (null if idle). */
  processingSessionId: string | null;
  /** When true, both RUN_STEP actions and NeedsApproval modals auto-proceed. */
  autoConfirm: boolean;
  changes: ChangeEntry[];
  pendingApproval: ApprovalRequest | null;
  changeLogOpen: boolean;
  historyOpen: boolean;
  knowledgeOpen: boolean;
  sidebarOpen: boolean;
  activeView: ActiveView;
  pastSessions: SessionRecord[];
  /** Session IDs that received a reply while the user was viewing a
   *  different thread. Sidebar surfaces these as a small unread dot.
   *  Cleared the next time the user opens that session. */
  unreadSessionIds: string[];

  setSession: (id: string) => void;
  setSessionMode: (mode: SessionMode) => void;
  endSession: () => void;
  setProcessingSession: (id: string | null) => void;
  setAutoConfirm: (on: boolean) => void;
  addChange: (change: ChangeEntry) => void;
  markChangeUndone: (changeId: string) => void;
  setChanges: (changes: ChangeEntry[]) => void;
  setPendingApproval: (req: ApprovalRequest | null) => void;
  toggleChangeLog: () => void;
  setChangeLogOpen: (open: boolean) => void;
  toggleHistory: () => void;
  setHistoryOpen: (open: boolean) => void;
  toggleKnowledge: () => void;
  setKnowledgeOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActiveView: (view: ActiveView) => void;
  setPastSessions: (sessions: SessionRecord[]) => void;
  /** Add a session to the top of pastSessions (optimistic insert). */
  prependSession: (session: SessionRecord) => void;
  /** Mark a session as having unread activity (a response arrived while the
   *  user was viewing a different thread). No-op if already unread or if
   *  this is the currently-viewed session. */
  markSessionUnread: (id: string) => void;
  /** Clear the unread badge for a session (called on switch). */
  markSessionRead: (id: string) => void;
}

// Helper: close all side panels.
const allPanelsClosed = {
  changeLogOpen: false,
  historyOpen: false,
  knowledgeOpen: false,
};

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  isActive: false,
  sessionMode: "default",
  processingSessionId: null,
  autoConfirm: false,
  changes: [],
  pendingApproval: null,
  changeLogOpen: false,
  historyOpen: false,
  knowledgeOpen: false,
  sidebarOpen: true,
  activeView: "chat",
  pastSessions: [],
  unreadSessionIds: [],

  setSession: (id) =>
    set((state) => ({
      sessionId: id,
      isActive: true,
      sessionMode: "default",
      autoConfirm: false,
      changes: [],
      pendingApproval: null,
      // Opening a session implicitly marks it read.
      unreadSessionIds: state.unreadSessionIds.filter((s) => s !== id),
    })),

  setSessionMode: (mode) => set({ sessionMode: mode }),

  endSession: () =>
    set({
      isActive: false,
      sessionMode: "default",
      autoConfirm: false,
      pendingApproval: null,
    }),

  setProcessingSession: (id) => set({ processingSessionId: id }),

  setAutoConfirm: (on) => set({ autoConfirm: on }),

  addChange: (change) =>
    set((state) => ({
      changes: [...state.changes, change],
    })),

  markChangeUndone: (changeId) =>
    set((state) => ({
      changes: state.changes.map((c) =>
        c.id === changeId ? { ...c, undone: true } : c,
      ),
    })),

  setChanges: (changes) => set({ changes }),

  setPendingApproval: (req) => set({ pendingApproval: req }),

  // Panels are mutually exclusive — opening one closes the others.
  toggleChangeLog: () =>
    set((state) => ({
      ...allPanelsClosed,
      changeLogOpen: !state.changeLogOpen,
    })),

  setChangeLogOpen: (open) =>
    set(open ? { ...allPanelsClosed, changeLogOpen: true } : { changeLogOpen: false }),

  toggleHistory: () =>
    set((state) => ({
      ...allPanelsClosed,
      historyOpen: !state.historyOpen,
    })),

  setHistoryOpen: (open) =>
    set(open ? { ...allPanelsClosed, historyOpen: true } : { historyOpen: false }),

  toggleKnowledge: () =>
    set((state) => ({
      ...allPanelsClosed,
      knowledgeOpen: !state.knowledgeOpen,
    })),

  setKnowledgeOpen: (open) =>
    set(open ? { ...allPanelsClosed, knowledgeOpen: true } : { knowledgeOpen: false }),

  toggleSidebar: () =>
    set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setActiveView: (view) => set({ activeView: view }),

  setPastSessions: (sessions) => set({ pastSessions: sessions }),

  prependSession: (session) =>
    set((state) => ({
      pastSessions: [session, ...state.pastSessions.filter((s) => s.id !== session.id)],
    })),

  markSessionUnread: (id) =>
    set((state) => {
      // Don't badge the session the user is currently viewing.
      if (state.sessionId === id) return {};
      if (state.unreadSessionIds.includes(id)) return {};
      return { unreadSessionIds: [...state.unreadSessionIds, id] };
    }),

  markSessionRead: (id) =>
    set((state) => ({
      unreadSessionIds: state.unreadSessionIds.filter((s) => s !== id),
    })),
}));
