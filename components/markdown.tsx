import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Problem statements are author-supplied markdown. react-markdown never
 * renders raw HTML (no rehype-raw), so statements cannot inject scripts.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown text-sm leading-6">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
