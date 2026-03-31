"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface OutputLine {
  id: number;
  timestamp: string;
  text: string;
  stream: "stdout" | "stderr";
}

interface AgentOutputViewerProps {
  /** Agent callsign to stream output from */
  callsign: string;
  /** Max height of the viewer in pixels */
  maxHeight?: number;
}

/**
 * Terminal-style output viewer for agent stdout/stderr.
 * Connects via SSE for live streaming, falls back to polling.
 * Always renders with a dark terminal background regardless of theme.
 */
export function AgentOutputViewer({ callsign, maxHeight = 500 }: AgentOutputViewerProps) {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lineIdRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLines = useCallback((newLines: OutputLine[]) => {
    setLines((prev) => {
      const combined = [...prev, ...newLines];
      // Keep last 2000 lines to prevent memory bloat
      return combined.length > 2000 ? combined.slice(-2000) : combined;
    });
  }, []);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // Handle scroll to detect if user scrolled up
  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);
  }

  // Connect via SSE, fall back to polling
  useEffect(() => {
    let cancelled = false;

    function connectSSE() {
      try {
        const es = new EventSource(`/api/agents/${callsign}/output/stream`);
        eventSourceRef.current = es;

        es.onopen = () => {
          if (!cancelled) {
            setConnected(true);
            setError(null);
          }
        };

        es.onmessage = (event) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(event.data) as {
              text: string;
              stream: "stdout" | "stderr";
              timestamp?: string;
            };
            lineIdRef.current += 1;
            addLines([{
              id: lineIdRef.current,
              timestamp: data.timestamp || new Date().toISOString(),
              text: data.text,
              stream: data.stream,
            }]);
          } catch {
            // Non-JSON message, treat as stdout
            lineIdRef.current += 1;
            addLines([{
              id: lineIdRef.current,
              timestamp: new Date().toISOString(),
              text: event.data,
              stream: "stdout",
            }]);
          }
        };

        es.onerror = () => {
          es.close();
          if (!cancelled) {
            setConnected(false);
            startPolling();
          }
        };
      } catch {
        if (!cancelled) startPolling();
      }
    }

    function startPolling() {
      if (pollIntervalRef.current) return;

      async function poll() {
        try {
          const res = await fetch(`/api/agents/${callsign}/output?lines=100`);
          if (res.ok) {
            const data = await res.json();
            const outputLines: OutputLine[] = (
              data.lines as Array<{ text: string; stream: "stdout" | "stderr"; timestamp?: string }>
            ).map((l) => {
              lineIdRef.current += 1;
              return {
                id: lineIdRef.current,
                timestamp: l.timestamp || new Date().toISOString(),
                text: l.text,
                stream: l.stream,
              };
            });
            if (!cancelled && outputLines.length > 0) {
              setLines(outputLines);
            }
          }
        } catch {
          // Polling failure is not critical
        }
      }

      poll();
      pollIntervalRef.current = setInterval(poll, 3000);
    }

    connectSSE();

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [callsign, addLines]);

  function handleClear() {
    setLines([]);
    lineIdRef.current = 0;
  }

  async function handleCopy() {
    const text = lines.map((l) => l.text).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API not available
    }
  }

  function formatTime(ts: string): string {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return "--:--:--";
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-[#2d333b] overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between bg-[#161b22] px-3 py-2 border-b border-[#2d333b]">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-[#555]"}`} />
          <span className="font-mono text-[10px] tracking-wider text-[#8b949e]">
            {connected ? "LIVE" : "POLLING"}
          </span>
          <span className="font-mono text-[10px] text-[#484f58]">
            {lines.length} lines
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`rounded px-2 py-1 font-mono text-[10px] tracking-wider transition-colors ${
              autoScroll
                ? "bg-[#1f6feb]/20 text-[#58a6ff]"
                : "text-[#8b949e] hover:text-[#c9d1d9]"
            }`}
          >
            AUTO-SCROLL {autoScroll ? "ON" : "OFF"}
          </button>
          <button
            onClick={handleCopy}
            className="rounded px-2 py-1 font-mono text-[10px] tracking-wider text-[#8b949e] transition-colors hover:text-[#c9d1d9]"
          >
            COPY
          </button>
          <button
            onClick={handleClear}
            className="rounded px-2 py-1 font-mono text-[10px] tracking-wider text-[#8b949e] transition-colors hover:text-[#c9d1d9]"
          >
            CLEAR
          </button>
        </div>
      </div>

      {/* Terminal output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="overflow-y-auto bg-[#0d1117] font-mono text-[12px] leading-[1.6]"
        style={{ maxHeight: `${maxHeight}px` }}
      >
        {lines.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-[#484f58]">
            <span className="text-[11px]">No output yet. Start the agent to see output here.</span>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line) => (
                <tr
                  key={line.id}
                  className="hover:bg-[#161b22] group"
                >
                  <td className="select-none whitespace-nowrap px-2 py-0 text-right align-top text-[11px] text-[#484f58] w-[1%]">
                    {line.id}
                  </td>
                  <td className="select-none whitespace-nowrap px-2 py-0 align-top text-[10px] text-[#484f58] w-[1%]">
                    {formatTime(line.timestamp)}
                  </td>
                  <td
                    className={`whitespace-pre-wrap break-all px-2 py-0 ${
                      line.stream === "stderr" ? "text-[#f97583]" : "text-[#c9d1d9]"
                    }`}
                  >
                    {line.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Error bar */}
      {error && (
        <div className="bg-[#3d1014] px-3 py-1.5 text-[11px] text-[#f97583] border-t border-[#f9758330]">
          {error}
        </div>
      )}
    </div>
  );
}
