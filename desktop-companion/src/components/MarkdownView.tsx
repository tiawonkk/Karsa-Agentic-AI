import React from "react";

interface MarkdownViewProps {
  content: string;
  className?: string;
}

/**
 * Lightweight, zero-dependency Markdown renderer for Karsa chat bubbles.
 * Parses bold (**bold**), italic (*italic*), inline code (`code`), lists (1., -), and paragraphs.
 */
export const MarkdownView: React.FC<MarkdownViewProps> = ({ content, className = "" }) => {
  if (!content) return null;

  // Split into lines for block-level parsing
  const lines = content.split("\n");
  const renderedElements: React.ReactNode[] = [];
  let currentListItems: React.ReactNode[] = [];
  let currentListType: "ul" | "ol" | null = null;

  const flushList = () => {
    if (currentListItems.length > 0 && currentListType) {
      if (currentListType === "ol") {
        renderedElements.push(
          <ol key={`ol-${renderedElements.length}`} className="my-1.5 space-y-1 pl-4 list-decimal text-neutral-200">
            {currentListItems}
          </ol>
        );
      } else {
        renderedElements.push(
          <ul key={`ul-${renderedElements.length}`} className="my-1.5 space-y-1 pl-4 list-disc text-neutral-200">
            {currentListItems}
          </ul>
        );
      }
      currentListItems = [];
      currentListType = null;
    }
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trimEnd();

    // Empty line -> flush list and add spacer
    if (!line.trim()) {
      flushList();
      renderedElements.push(<div key={`spacer-${idx}`} className="h-1.5" />);
      return;
    }

    // Numbered list: "1. ", "2. ", etc.
    const orderedMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      if (currentListType && currentListType !== "ol") flushList();
      currentListType = "ol";
      currentListItems.push(
        <li key={`li-${idx}`} className="leading-relaxed">
          {renderInlineMarkdown(orderedMatch[2])}
        </li>
      );
      return;
    }

    // Unordered list: "- ", "* "
    const unorderedMatch = line.match(/^[-*]\s+(.*)$/);
    if (unorderedMatch) {
      if (currentListType && currentListType !== "ul") flushList();
      currentListType = "ul";
      currentListItems.push(
        <li key={`li-${idx}`} className="leading-relaxed">
          {renderInlineMarkdown(unorderedMatch[1])}
        </li>
      );
      return;
    }

    // Regular line / paragraph
    flushList();

    // Check for Markdown headings
    if (line.startsWith("### ")) {
      renderedElements.push(
        <h4 key={`h4-${idx}`} className="font-semibold text-[#FAF9F6] text-[13px] mt-2 mb-1">
          {renderInlineMarkdown(line.slice(4))}
        </h4>
      );
      return;
    }
    if (line.startsWith("## ")) {
      renderedElements.push(
        <h3 key={`h3-${idx}`} className="font-editorial text-lg text-[#FAF9F6] mt-2.5 mb-1">
          {renderInlineMarkdown(line.slice(3))}
        </h3>
      );
      return;
    }

    // Regular paragraph line
    renderedElements.push(
      <p key={`p-${idx}`} className="leading-relaxed my-0.5">
        {renderInlineMarkdown(line)}
      </p>
    );
  });

  flushList();

  return <div className={`text-xs ${className}`}>{renderedElements}</div>;
};

/**
 * Parses inline tokens: **bold**, *italic*, `code`, and plain text.
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  // Regex matching:
  // 1. Bold: \*\*(.*?)\*\*
  // 2. Inline Code: `(.*?)`
  // 3. Italic: \*(.*?)\* or _(.*?)_
  const tokenRegex = /(\*\*(?:[^*]|\\\*)+\*\*|`(?:[^`]|\\`)+`|\*(?:[^*]|\\\*)+\*|_(?:[^_]|\\_)+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.substring(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      tokens.push(
        <strong key={`b-${match.index}`} className="font-semibold text-[#FAF9F6]">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      tokens.push(
        <code
          key={`c-${match.index}`}
          className="font-mono bg-white/10 px-1 py-0.5 rounded text-[11px] text-[#D95D39] border border-white/5"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (
      (token.startsWith("*") && token.endsWith("*")) ||
      (token.startsWith("_") && token.endsWith("_"))
    ) {
      tokens.push(
        <em key={`i-${match.index}`} className="italic text-neutral-300">
          {token.slice(1, -1)}
        </em>
      );
    } else {
      tokens.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    tokens.push(text.substring(lastIndex));
  }

  return tokens.length > 0 ? tokens : [text];
}
