import { useEffect, useRef } from "react";
import { setMood } from "../lib/jelly";

/**
 * Keeps Karsa's mood in step with the AI agent:
 *  - an approval waiting for the human  -> worried
 *  - the AI is working, no text yet      -> thinking
 *  - text is arriving                    -> speaking
 *  - an answer just finished             -> happy for a moment
 */
export function useJellyMoodSync(isStreaming: boolean, lastAssistantText: string, pendingApprovals: number) {
  const wasStreaming = useRef(false);

  useEffect(() => {
    if (pendingApprovals > 0) {
      setMood("worried");
      return;
    }
    if (isStreaming) {
      setMood(lastAssistantText ? "speaking" : "thinking");
    } else if (wasStreaming.current) {
      setMood(lastAssistantText.startsWith("⚠️") ? "worried" : "happy", 2600);
    } else {
      setMood("idle");
    }
    wasStreaming.current = isStreaming;
  }, [isStreaming, lastAssistantText, pendingApprovals]);
}
