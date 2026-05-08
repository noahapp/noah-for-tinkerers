import { useCallback } from "react";
import { useChatStore } from "../stores/chatStore";
import { useSessionStore } from "../stores/sessionStore";
import { isPaywalled, useConsumerStore } from "../stores/consumerStore";
import * as commands from "../lib/tauri-commands";
import type {
  AssistantActionType,
  UserEventType,
} from "../lib/tauri-commands";
import { recordAssistantUiShape } from "../lib/spaShapeTelemetry";

/**
 * Trial-modal trigger model:
 *
 * The user's *first* issue runs uninterrupted — we don't pop a modal
 * during their first taste of the product. The trigger is "next issue":
 * the first time they send a message in a session-id different from the
 * one we recorded as the first issue. Time-based triggers (trial date
 * passed, hidden cap-hit) are handled separately and not gated by this
 * flag.
 *
 * Reset by dev-reset-auth --fresh.
 */
const FIRST_ISSUE_SESSION_KEY = "noah.firstIssueSessionId";
const SECOND_ISSUE_MODAL_SHOWN_KEY = "noah.secondIssueModalShown";

/** Returns true if this is the first message for what we should treat
 *  as a second-or-later issue (different sessionId from the first). */
function maybeOpenSecondIssueModal(currentSessionId: string): void {
  const consumer = useConsumerStore.getState();
  const ent = consumer.entitlement;
  if (!ent || ent.status !== "trialing") return;
  try {
    if (localStorage.getItem(SECOND_ISSUE_MODAL_SHOWN_KEY) === "1") return;
    const firstSession = localStorage.getItem(FIRST_ISSUE_SESSION_KEY);
    if (!firstSession) {
      // First-ever message — record this session, do NOT show modal.
      localStorage.setItem(FIRST_ISSUE_SESSION_KEY, currentSessionId);
      return;
    }
    if (firstSession === currentSessionId) return; // still on issue #1
    localStorage.setItem(SECOND_ISSUE_MODAL_SHOWN_KEY, "1");
    consumer.openSubscribeModal("second_issue");
  } catch {
    // localStorage disabled — modal flags reset every app process; acceptable.
  }
}

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

      // Consumer path: check entitlement before sending.
      // Paywalled → open modal, abort.
      // Trial not yet started (ent null OR status='none') → start it.
      // We call notifyIssueStarted even when ent is null because MainApp's
      // refreshEntitlement() is async and may still be in flight when the
      // seed auto-sends on fresh install. Server is idempotent — it only
      // sets trial_started_at on the first call, so eager calls are safe.
      const consumer = useConsumerStore.getState();
      const ent = consumer.entitlement;
      if (ent && isPaywalled(ent)) {
        const variant = ent.status === "active" ? "cap_hit" : "paywall";
        consumer.openSubscribeModal(variant);
        return;
      }
      // Hidden trial-quota cap (≥ usage_limit while still trialing).
      // Server-side denyReason returns "trial_quota"; mirror that here so
      // the modal pops with the cap-hit variant ("you've hit your trial
      // quota") without ever telling the user the specific number.
      if (
        ent &&
        ent.status === "trialing" &&
        ent.usage_used >= ent.usage_limit
      ) {
        consumer.openSubscribeModal("cap_hit");
        return;
      }
      if (!ent || ent.status === "none") {
        try {
          const started = await commands.consumerNotifyIssueStarted();
          if (started) consumer.setEntitlement(started);
        } catch {
          // non-fatal — trial start is best-effort; server is authoritative
        }
      }
      // After ensuring trial is started, evaluate second-issue trigger
      // *now* so that the first-issue session-id is recorded against
      // the very first message, not later.
      maybeOpenSecondIssueModal(sessionId);

      const prevChangeIds = new Set(changes.map((c) => c.id));

      addMessage({ role: "user", content: trimmed });
      setProcessingSession(originSessionId);

      try {
        const result = await commands.sendMessageV2(originSessionId, trimmed);
        recordAssistantUiShape(result.assistant_ui);
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
        // 402 from the LLM proxy means paywall; 429 means usage cap.
        // These global modal triggers fire regardless of which thread is
        // currently visible — the user needs to know about billing/quota
        // even if they navigated away.
        const msg = err instanceof Error ? err.message : String(err);
        if (/\b402\b/.test(msg)) {
          useConsumerStore.getState().openSubscribeModal("paywall");
          useConsumerStore.getState().refresh();
        } else if (/\b429\b/.test(msg)) {
          useConsumerStore.getState().openSubscribeModal("cap_hit");
          useConsumerStore.getState().refresh();
        }
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
        recordAssistantUiShape(result.assistant_ui);
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
        recordAssistantUiShape(result.assistant_ui);
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
