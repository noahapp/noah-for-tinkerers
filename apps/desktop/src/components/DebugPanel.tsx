import { useState, useRef, useEffect, useCallback } from "react";
import { useDebugStore, type DebugEvent } from "../stores/debugStore";

const BADGE_COLORS: Record<string, string> = {
  llm_request: "bg-accent-blue/15 text-accent-blue",
  llm_response: "bg-accent-blue/15 text-accent-blue",
  tool_call: "bg-accent-purple/15 text-accent-purple",
  tool_result: "bg-accent-green/15 text-accent-green",
  tool_denied: "bg-accent-amber/15 text-accent-amber",
  error: "bg-accent-red/15 text-accent-red",
};

function EventRow({ event }: { event: DebugEvent }) {
  const [expanded, setExpanded] = useState(false);

  const time = new Date(event.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const badgeClass =
    BADGE_COLORS[event.event_type] ?? "bg-bg-tertiary text-text-secondary";

  return (
    <div className="border-b border-border-primary last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-bg-tertiary/50 transition-colors cursor-pointer"
      >
        <span className="text-micro font-mono text-text-muted flex-shrink-0 tabular-nums">
          {time}
        </span>
        <span
          className={`px-1.5 py-0.5 rounded text-micro font-mono flex-shrink-0 ${badgeClass}`}
        >
          {event.event_type}
        </span>
        <span className="text-xs text-text-secondary truncate">
          {event.summary}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`flex-shrink-0 text-text-muted transition-transform ${
            expanded ? "rotate-90" : ""
          }`}
        >
          <path
            d="M3 1.5L7 5L3 8.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {expanded && (
        <pre className="px-3 py-2 mx-3 mb-2 rounded bg-bg-primary text-micro text-text-secondary font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
          {JSON.stringify(event.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 240;
const MAX_HEIGHT = 600;

export function DebugPanel() {
  const isOpen = useDebugStore((s) => s.isOpen);
  const events = useDebugStore((s) => s.events);
  const clear = useDebugStore((s) => s.clear);
  const setOpen = useDebugStore((s) => s.setOpen);

  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const listRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  // Auto-scroll to bottom when new events arrive.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events.length]);

  // Drag-to-resize handler.
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = height;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = startY.current - ev.clientY;
        setHeight(
          Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startH.current + delta)),
        );
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [height],
  );

  if (!isOpen) return null;

  return (
    <div
      className="flex flex-col bg-bg-secondary border-t border-border-primary"
      style={{ height, flexShrink: 0 }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        className="h-1 cursor-ns-resize bg-border-primary hover:bg-accent-blue/40 transition-colors"
      />

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-primary select-none">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-primary">
            Debug
          </span>
          {events.length > 0 && (
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-full bg-bg-tertiary text-micro text-text-muted font-mono">
              {events.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clear}
            title="Clear log"
            className="px-2 py-0.5 rounded text-micro text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
          >
            Clear
          </button>
          <button
            onClick={() => setOpen(false)}
            title="Close debug panel"
            className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Event list */}
      <div ref={listRef} className="flex-1 overflow-y-auto overflow-x-hidden">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-xs">
            Waiting for events...
          </div>
        ) : (
          events.map((event, i) => <EventRow key={i} event={event} />)
        )}
      </div>
    </div>
  );
}
