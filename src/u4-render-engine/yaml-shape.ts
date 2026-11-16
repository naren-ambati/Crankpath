// YamlShape (U4; B2 review pass 4, M1): the pre-reads judge the values crankpath's YAML reader
// returns, and kustomize decodes the same text with another library (go-yaml through
// sigs.k8s.io/yaml). Where the two may disagree, a judged value is not the value kustomize uses:
// `!!binary` is decoded by kustomize and kept as base64 text by the reader, a tag on a key can
// turn it into a field name, and an escape or a line break in a quoted or plain scalar is folded
// by rules the libraries need not share. So a kustomization or configuration file holding any
// tag (including `!!str`), a directive (`%TAG`, `%YAML`), or a quoted or plain scalar with an escape or a
// line break, is refused whole before kustomize runs. Block scalars (`|`, `>`) are kept: both
// libraries take their lines as written. The text is read by token (the reader already bounded
// it), so a `!` or `&` inside a value or a comment is not a tag.

import { CST, Lexer } from "yaml";

export interface YamlShapeProblem {
  readonly kind: "tag" | "style";
  /** The token as written (repo text). */
  readonly token: string;
}

/** The first tag, or quoted or plain scalar that may decode otherwise, in `text`; null when none. */
export function yamlShapeProblem(text: string): YamlShapeProblem | null {
  let block = false;
  let scalarText = false;
  for (const token of new Lexer().lex(text)) {
    if (scalarText) {
      // the text after a scalar marker: a block scalar's lines (kept), else a plain scalar
      scalarText = false;
      const wasBlock = block;
      block = false;
      if (wasBlock) continue;
      if (CST.tokenType(token) === null && token.includes("\n")) return { kind: "style", token };
      if (CST.tokenType(token) === null) continue;
    }
    const type = CST.tokenType(token);
    if (type === "tag" || type === "directive-line") return { kind: "tag", token };
    if (type === "block-scalar-header") block = true;
    else if (type === "scalar") scalarText = true;
    else if (type === "double-quoted-scalar" && (token.includes("\\") || token.includes("\n"))) {
      return { kind: "style", token };
    } else if (type === "single-quoted-scalar" && token.includes("\n")) return { kind: "style", token };
  }
  return null;
}
