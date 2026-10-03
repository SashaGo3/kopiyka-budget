/** The parsed message tree turned into the runtime's compact form (see runtime/index.ts). */
import type { Msg, Part } from "../runtime";
import type { Node } from "./parse";

export function compile(ast: Node[]): Msg {
  const parts: Part[] = [];
  for (const n of ast) {
    switch (n.t) {
      case "text":
        if (typeof parts[parts.length - 1] === "string") parts[parts.length - 1] += n.v;
        else parts.push(n.v);
        break;
      case "arg": parts.push([0, n.name]); break;
      case "pound": parts.push([1]); break;
      case "plural": parts.push([2, n.name, Object.fromEntries(Object.entries(n.cases).map(([k, v]) => [k, compile(v)]))]); break;
      case "select": parts.push([3, n.name, Object.fromEntries(Object.entries(n.cases).map(([k, v]) => [k, compile(v)]))]); break;
      case "tag": parts.push([4, n.name, compile(n.children)]); break;
    }
  }
  if (parts.length === 0) return "";
  if (parts.length === 1 && typeof parts[0] === "string") return parts[0];
  return parts;
}
