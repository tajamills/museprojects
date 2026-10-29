import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchWorksheetState,
  saveWorksheetState,
  type WorksheetState,
} from "../api";

/**
 * The Quietly Ready appendix, tracked in the book — built phone-first,
 * like a grocery list: every checklist item is a big tappable row (tap
 * anywhere to tick it), each section shows its own "X of Y done" line,
 * and the worksheets keep their fill-in fields. Progress is saved per
 * reader on the server (owners only — this only mounts when the chapter
 * text loaded, which already requires ownership). The Word download
 * stays available above for readers who want paper.
 *
 * Parsing: the manuscript text is blocks of lines. "Worksheet X —" /
 * "Checklist X —" lines are section heads; lines starting with "•" are
 * field rows (text, [FILL-IN] blanks, and ☐ boxes in manuscript order —
 * some rows put the box after its label, "Go-bag copy: ☐") — except a
 * "•" line that starts with a box, which is really a checklist. Other ☐
 * lines are checklists (a lead-in plus one item per ☐). State keys are
 * index-based ("s{block}-l{line}-i{n}" for the nth box, "...-f{n}" for
 * the nth field) so they survive re-renders and deploys unchanged; the
 * tradeoff is that editing the manuscript text itself can re-key later
 * items in that line.
 */

type FlowPart =
  | { t: "text"; s: string }
  | { t: "field"; key: string }
  | { t: "check"; key: string };

type WsNode =
  | { kind: "para"; flow: FlowPart[] }
  | { kind: "head"; text: string }
  | { kind: "checklist"; lead: FlowPart[] | null; items: { key: string; label: FlowPart[] }[]; checkKeys: string[] }
  | { kind: "row"; flow: FlowPart[]; checkKeys: string[] };

interface WsSection {
  head: string | null;
  nodes: WsNode[];
  checkKeys: string[];
}

interface KeyGen {
  /** Every check key issued, in order — used for section progress. */
  issued: string[];
  check(): string;
  field(): string;
}

function keyGen(block: number, line: number): KeyGen {
  let c = 0;
  let f = 0;
  const issued: string[] = [];
  return {
    issued,
    check: () => {
      const key = `s${block}-l${line}-i${c++}`;
      issued.push(key);
      return key;
    },
    field: () => `s${block}-l${line}-f${f++}`,
  };
}

/** Append text parts to `out`, turning each [FILL-IN] into a field part. */
function textFlow(text: string, kg: KeyGen, out: FlowPart[]): void {
  const pieces = text.split("[FILL-IN]");
  pieces.forEach((piece, idx) => {
    if (piece) out.push({ t: "text", s: piece });
    if (idx < pieces.length - 1) out.push({ t: "field", key: kg.field() });
  });
}

/** A "•" field row: segments split on " · ", boxes in manuscript order. */
function parseRow(body: string, kg: KeyGen): FlowPart[] {
  const out: FlowPart[] = [];
  body.split(" · ").forEach((seg, si) => {
    if (si > 0) out.push({ t: "text", s: " · " });
    const trimmedEnd = seg.trimEnd();
    if (trimmedEnd.endsWith("☐") && !trimmedEnd.slice(0, -1).includes("☐")) {
      // Label-before-box segment ("Go-bag copy: ☐"): label, then the box.
      textFlow(trimmedEnd.slice(0, -1), kg, out);
      out.push({ t: "check", key: kg.check() });
    } else if (seg.includes("☐")) {
      // Box-first: text before the first box is a lead-in; each box is
      // followed by its label text (which may itself hold [FILL-IN]s).
      const pieces = seg.split("☐");
      textFlow(pieces[0], kg, out);
      for (let k = 1; k < pieces.length; k++) {
        out.push({ t: "check", key: kg.check() });
        textFlow(pieces[k], kg, out);
      }
    } else {
      textFlow(seg, kg, out);
    }
  });
  return out;
}

/** A checklist line: lead-in plus one checkbox item per ☐ segment. */
function parseChecklist(line: string, kg: KeyGen): { lead: FlowPart[] | null; items: { key: string; label: FlowPart[] }[] } {
  const pieces = line.split("☐");
  const leadText = pieces[0].trim();
  const lead: FlowPart[] | null = leadText ? [] : null;
  if (lead) textFlow(leadText, kg, lead);
  const items = pieces.slice(1).map((piece) => {
    const key = kg.check();
    const label: FlowPart[] = [];
    textFlow(piece.trim(), kg, label);
    return { key, label };
  });
  return { lead, items };
}

function parseWorksheet(text: string): WsNode[] {
  const nodes: WsNode[] = [];
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  blocks.forEach((block, bi) => {
    const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
    lines.forEach((line, li) => {
      const kg = keyGen(bi, li);
      if (/^(Worksheet|Checklist) [A-Z]\b/.test(line)) {
        nodes.push({ kind: "head", text: line });
        return;
      }
      const isBullet = line.startsWith("•");
      const body = isBullet ? line.replace(/^•\s*/, "") : line;
      // A bullet line that starts with a box ("• ☐ IDs ☐ Insurance …")
      // is a checklist wearing a bullet; other bullet lines are field
      // rows even when they contain boxes mid-sentence.
      if (body.includes("☐") && (!isBullet || body.startsWith("☐"))) {
        nodes.push({ kind: "checklist", ...parseChecklist(body, kg), checkKeys: kg.issued });
      } else if (isBullet) {
        nodes.push({ kind: "row", flow: parseRow(body, kg), checkKeys: kg.issued });
      } else {
        const flow: FlowPart[] = [];
        textFlow(line, kg, flow);
        nodes.push({ kind: "para", flow });
      }
    });
  });
  return nodes;
}

/** Group nodes under their section head; a section's progress counts
 *  every box in it — checklist items and worksheet row boxes alike. */
function groupSections(nodes: WsNode[]): WsSection[] {
  const sections: WsSection[] = [];
  let current: WsSection = { head: null, nodes: [], checkKeys: [] };
  sections.push(current);
  for (const node of nodes) {
    if (node.kind === "head") {
      current = { head: node.text, nodes: [], checkKeys: [] };
      sections.push(current);
    } else {
      current.nodes.push(node);
      if (node.kind === "checklist" || node.kind === "row") {
        current.checkKeys.push(...node.checkKeys);
      }
    }
  }
  return sections.filter((s) => s.head !== null || s.nodes.length > 0);
}

function plainText(parts: FlowPart[]): string {
  return parts
    .filter((p): p is Extract<FlowPart, { t: "text" }> => p.t === "text")
    .map((p) => p.s)
    .join("")
    .trim();
}

export function WorksheetAppendix({ bookId, text }: { bookId: string; text: string }) {
  const sections = useMemo(() => groupSections(parseWorksheet(text)), [text]);
  const [wsState, setWsState] = useState<WorksheetState>(() => ({ checks: {}, values: {} }));
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const stateRef = useRef(wsState);
  stateRef.current = wsState;

  // Load this reader's saved progress once. If they somehow edit before
  // the load lands, their edits win — never clobber local state.
  useEffect(() => {
    let live = true;
    fetchWorksheetState(bookId).then((saved) => {
      if (!live) return;
      if (saved && !dirtyRef.current) setWsState(saved);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [bookId]);

  // Save, debounced, whenever the state changes after the initial load.
  // Local state is never rolled back on failure — the note just says so.
  useEffect(() => {
    if (!loaded || !dirtyRef.current) return;
    const timer = setTimeout(() => {
      saveWorksheetState(bookId, stateRef.current).then((ok) => {
        if (ok) {
          dirtyRef.current = false;
          setNote("Saved");
        } else {
          setNote("Couldn't save — check your connection");
        }
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [wsState, loaded, bookId]);

  const onCheck = (key: string, checked: boolean) => {
    dirtyRef.current = true;
    setNote(null);
    setWsState((s) => {
      const checks = { ...s.checks };
      if (checked) checks[key] = true;
      else delete checks[key];
      return { ...s, checks };
    });
  };

  const onField = (key: string, value: string) => {
    dirtyRef.current = true;
    setNote(null);
    setWsState((s) => {
      const values = { ...s.values };
      if (value) values[key] = value;
      else delete values[key];
      return { ...s, values };
    });
  };

  const renderFlow = (parts: FlowPart[]) =>
    parts.map((p, i) => {
      if (p.t === "text") return <span key={i}>{p.s}</span>;
      if (p.t === "check") {
        return (
          <input
            key={i}
            type="checkbox"
            className="ws-check"
            checked={!!wsState.checks[p.key]}
            onChange={(e) => onCheck(p.key, e.target.checked)}
            aria-label="Mark done"
          />
        );
      }
      return (
        <input
          key={i}
          type="text"
          className="ws-input"
          value={wsState.values[p.key] ?? ""}
          onChange={(e) => onField(p.key, e.target.value)}
          aria-label="Your answer"
        />
      );
    });

  const renderNode = (node: WsNode, i: number) => {
    switch (node.kind) {
      case "para":
        return (
          <p key={i} className="appendix-line">
            {renderFlow(node.flow)}
          </p>
        );
      case "row":
        return (
          <p key={i} className="ws-row">
            <span aria-hidden="true">• </span>
            {renderFlow(node.flow)}
          </p>
        );
      case "checklist":
        return (
          <div key={i}>
            {node.lead ? <p className="appendix-lead">{renderFlow(node.lead)}</p> : null}
            <div className="ws-list">
              {node.items.map((item) => {
                const checked = !!wsState.checks[item.key];
                return (
                  <label key={item.key} className={`ws-item${checked ? " ws-item-done" : ""}`}>
                    <input
                      type="checkbox"
                      className="ws-check"
                      checked={checked}
                      onChange={(e) => onCheck(item.key, e.target.checked)}
                      aria-label={plainText(item.label) || "Mark done"}
                    />
                    <span className="ws-item-label">{renderFlow(item.label)}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="prose appendix-prose ws-appendix">
      <div className="ws-note-slot" aria-live="polite">
        {note ? <p className="ws-note">{note}</p> : null}
      </div>
      {sections.map((section, si) => {
        const done = section.checkKeys.filter((k) => wsState.checks[k]).length;
        return (
          <section key={si} className="ws-section">
            {section.head ? <h3 className="appendix-head">{section.head}</h3> : null}
            {section.checkKeys.length > 0 ? (
              <p className="ws-progress">
                {done} of {section.checkKeys.length} done
              </p>
            ) : null}
            {section.nodes.map(renderNode)}
          </section>
        );
      })}
    </div>
  );
}
