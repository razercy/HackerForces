"use client";

import { cpp } from "@codemirror/lang-cpp";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap, type KeyBinding, type ViewUpdate } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { basicSetup } from "codemirror";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type CodeEditorHandle = { getValue: () => string; setValue: (value: string) => void; focus: () => void };

type Props = {
  /** Read once on mount; the editor owns its document afterwards. */
  initialValue: () => string;
  onChange?: (value: string) => void;
  /** Every view update (transactions with userEvent annotations, focus changes). Used for telemetry. */
  onUpdate?: (update: ViewUpdate) => void;
  /** Extra shortcuts (e.g. run / submit). Take precedence over defaults. */
  keyBindings?: KeyBinding[];
  extensions?: Extension[];
  ariaLabel: string;
};

const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  ".cm-scroller": { fontFamily: "var(--font-mono), ui-monospace, monospace" },
});

/**
 * Thin CodeMirror 6 wrapper. Deliberately not a controlled component: React
 * never re-renders the document, which keeps typing latency independent of
 * React and gives later telemetry direct access to editor transactions.
 */
export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor(
  { initialValue, onChange, onUpdate, keyBindings = [], extensions = [], ariaLabel },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Latest callbacks without recreating the editor.
  const onChangeRef = useRef(onChange);
  const onUpdateRef = useRef(onUpdate);
  const keysRef = useRef(keyBindings);
  useEffect(() => {
    onChangeRef.current = onChange;
    onUpdateRef.current = onUpdate;
    keysRef.current = keyBindings;
  });

  useImperativeHandle(ref, () => ({
    getValue: () => view.current?.state.doc.toString() ?? "",
    setValue: (value) => {
      const v = view.current;
      if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, userEvent: "set" });
    },
    focus: () => view.current?.focus(),
  }));

  useEffect(() => {
    if (!host.current) return;
    const theme = new Compartment();
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const forwardingKeys: KeyBinding[] = keysRef.current.map((k, i) => ({
      ...k,
      run: (v) => keysRef.current[i]?.run?.(v) ?? false,
    }));

    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initialValue(),
        extensions: [
          Prec.highest(keymap.of(forwardingKeys)),
          basicSetup,
          // Tab indents; press Escape then Tab to move focus out (CodeMirror's focus-escape convention).
          keymap.of([indentWithTab]),
          cpp(),
          baseTheme,
          theme.of(dark.matches ? oneDark : []),
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          EditorView.updateListener.of((u) => {
            onUpdateRef.current?.(u);
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
          ...extensions,
        ],
      }),
    });
    view.current = v;

    const onScheme = () => v.dispatch({ effects: theme.reconfigure(dark.matches ? oneDark : []) });
    dark.addEventListener("change", onScheme);
    return () => {
      dark.removeEventListener("change", onScheme);
      v.destroy();
      view.current = null;
    };
    // The editor is created once per mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="h-full min-h-[24rem] overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700" />;
});
