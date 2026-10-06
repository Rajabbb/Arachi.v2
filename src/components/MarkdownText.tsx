import type { AnchorHTMLAttributes } from "react";
import Markdown from "markdown-to-jsx/react";

// Links from the agent always open in a new tab without access to this window.
function SafeLink(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

const options = {
  // Raw HTML in the model's reply is shown as text, never rendered.
  disableParsingRawHTML: true,
  forceBlock: true,
  overrides: { a: { component: SafeLink } },
};

/** Renders an assistant reply as markdown (bold, lists, links, line breaks). */
export default function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown options={options}>{text}</Markdown>
    </div>
  );
}
