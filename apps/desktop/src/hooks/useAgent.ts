import { useCallback } from "react";
import { useChatStore } from "../stores/chatStore";
import { useSessionStore } from "../stores/sessionStore";
import * as commands from "../lib/tauri-commands";
import type {
  AssistantActionType,
  UserEventType,
} from "../lib/tauri-commands";

interface UseAgentReturn {
  sendMessage: (text: string) => Promise<void>;
  sendConfirmation: (
    messageId: string,
    actionLabel?: string,
    actionType?: AssistantActionType,
  ) => Promise<void>;
  sendEvent: (eventType: UserEventType, payload?: string) => Promise<void>;
  cancelProcessing: () => Promise<void>;
  isProcessing: boolean;
}

/** Strip "Agent error: " prefix from backend errors since we already show friendly messages. */
function cleanError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Agent error:\s*/i, "");
}

export function useAgent(): UseAgentReturn {
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const markActionTaken = useChatStore((s) => s.markActionTaken);
  const sessionId = useSessionStore((s) => s.sessionId);
  const processingSessionId = useSessionStore((s) => s.processingSessionId);
  const setProcessingSession = useSessionStore((s) => s.setProcessingSession);
  const setChanges = useSessionStore((s) => s.setChanges);
  const changes = useSessionStore((s) => s.changes);

  // Only show processing indicator when the current session matches the processing one.
  const isProcessing = processingSessionId !== null && processingSessionId === sessionId;

  /** Shared post-response handler: sync changes and link to latest message.
   *  Only runs if the user is still viewing the session that produced the
   *  response — otherwise the change list (and its link to a "last assistant
   *  message") would be written against whichever session the user has since
   *  switched to. */
  const syncChanges = useCallback(
    async (originSessionId: string, prevChangeIds: Set<string>) => {
      try {
        const sid = useSessionStore.getState().sessionId;
        if (!sid || sid !== originSessionId) return;
        const updatedChanges = await commands.getChanges(originSessionId);
        if (useSessionStore.getState().sessionId !== originSessionId) return;
        setChanges(updatedChanges);
        const newChangeIds = updatedChanges
          .filter((c) => !prevChangeIds.has(c.id))
          .map((c) => c.id);
        if (newChangeIds.length > 0) {
          const latestMsgs = useChatStore.getState().messages;
          const lastAssistant = latestMsgs[latestMsgs.length - 1];
          if (lastAssistant?.role === "assistant") {
            updateMessage(lastAssistant.id, { changeIds: newChangeIds });
          }
        }
      } catch {
        // best-effort
      }
    },
    [setChanges, updateMessage],
  );

  /** True iff the user is still viewing the session that initiated the
   *  pending request. If they switched threads mid-flight, the in-flight
   *  response must NOT be written into the current chat store — that would
   *  graft a foreign reply onto whatever thread they navigated to. The
   *  server has already journaled the message; switching back to the
   *  origin session reloads it from disk. */
  const stillViewing = useCallback((originSessionId: string): boolean => {
    return useSessionStore.getState().sessionId === originSessionId;
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !sessionId) return;
      // Snapshot the session this message belongs to. All post-await
      // store writes (assistant reply, error system message, change sync)
      // are gated on the user still viewing this session. See `stillViewing`.
      const originSessionId = sessionId;

      const prevChangeIds = new Set(changes.map((c) => c.id));

      addMessage({ role: "user", content: trimmed });
      setProcessingSession(originSessionId);

      try {
        const result = await commands.sendMessageV2(originSessionId, trimmed);
        if (stillViewing(originSessionId)) {
          addMessage({
            role: "assistant",
            content: result.text,
            assistantUi: result.assistant_ui,
          });
        } else {
          // Reply belongs to a thread the user has navigated away from.
          // The server has journaled it; surface a sidebar dot instead of
          // grafting it onto whichever thread is currently visible.
          useSessionStore.getState().markSessionUnread(originSessionId);
        }
        await syncChanges(originSessionId, prevChangeIds);
      } catch (err) {
        console.error("Agent communication error:", err);
        if (stillViewing(originSessionId)) {
          addMessage({
            role: "system",
            content: cleanError(err),
          });
        } else {
          useSessionStore.getState().markSessionUnread(originSessionId);
        }
      } finally {
        // Only clear the processing flag if it still belongs to this send.
        // A concurrent send in another session may have replaced it.
        if (useSessionStore.getState().processingSessionId === originSessionId) {
          setProcessingSession(null);
        }
      }
    },
    [sessionId, addMessage, setProcessingSession, changes, syncChanges, stillViewing],
  );

  const sendConfirmation = useCallback(
    async (
      messageId: string,
      actionLabel?: string,
      actionType?: AssistantActionType,
    ) => {
      if (!sessionId) return;
      void actionType; // first-fix modal trigger removed — first issue runs uninterrupted

      const originSessionId = sessionId;
      const prevChangeIds = new Set(changes.map((c) => c.id));

      const confirmText = actionLabel || "Go ahead";
      markActionTaken(messageId);
      addMessage({
        role: "user",
        content: confirmText,
      });
      setProcessingSession(originSessionId);

      try {
        const result = await commands.sendMessageV2(
          originSessionId,
          confirmText,
          true,
        );
        if (stillViewing(originSessionId)) {
          addMessage({
            role: "assistant",
            content: result.text,
            assistantUi: result.assistant_ui,
          });
        } else {
          useSessionStore.getState().markSessionUnread(originSessionId);
        }
        await syncChanges(originSessionId, prevChangeIds);
      } catch (err) {
        console.error("Agent communication error:", err);
        if (stillViewing(originSessionId)) {
          addMessage({
            role: "system",
            content: cleanError(err),
          });
        } else {
          useSessionStore.getState().markSessionUnread(originSessionId);
        }
      } finally {
        if (useSessionStore.getState().processingSessionId === originSessionId) {
          setProcessingSession(null);
        }
      }
    },
    [sessionId, addMessage, markActionTaken, setProcessingSession, changes, syncChanges, stillViewing],
  );

  const sendEvent = useCallback(
    async (eventType: UserEventType, payload?: string) => {
      if (!sessionId) return;

      const originSessionId = sessionId;

      // Show the user's answer in the chat — transparency: what user said = what LLM sees
      if (eventType === "USER_ANSWER_QUESTION" && payload) {
        try {
          const parsed = JSON.parse(payload);
          const answer = parsed.answer || parsed.answers?.toString() || "";
          if (answer) {
            addMessage({ role: "user", content: answer });
          }
        } catch { /* best-effort */ }
      }

      setProcessingSession(originSessionId);
      try {
        const result = await commands.sendUserEvent(
          originSessionId,
          eventType,
          payload,
        );
        if (stillViewing(originSessionId)) {
          addMessage({
            role: "assistant",
            content: result.text,
            assistantUi: result.assistant_ui,
          });
        } else {
          useSessionStore.getState().markSessionUnread(originSessionId);
        }
      } catch (err) {
        console.error("Agent communication error:", err);
        if (stillViewing(originSessionId)) {
          addMessage({
            role: "system",
            content: cleanError(err),
          });
        } else {
          useSessionStore.getState().markSessionUnread(originSessionId);
        }
      } finally {
        if (useSessionStore.getState().processingSessionId === originSessionId) {
          setProcessingSession(null);
        }
      }
    },
    [sessionId, addMessage, setProcessingSession, stillViewing],
  );

  const cancelProcessing = useCallback(async () => {
    try {
      await commands.cancelProcessing();
    } catch (err) {
      console.error("Failed to cancel:", err);
      throw err;
    }
  }, []);

  return { sendMessage, sendConfirmation, sendEvent, cancelProcessing, isProcessing };
}
