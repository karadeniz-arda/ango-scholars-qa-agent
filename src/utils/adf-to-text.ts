export function adfToText(node: any): string {
  if (!node) return "";

  if (typeof node === "string") {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map(adfToText).join("");
  }

  if (node.type === "text") {
    return node.text || "";
  }

  const content = node.content ? adfToText(node.content) : "";

  switch (node.type) {
    case "doc":
      return content.trim();

    case "paragraph":
      return content.trim() + "\n";

    case "heading":
      return "\n" + content.trim() + "\n";

    case "bulletList":
      return content + "\n";

    case "orderedList":
      return content + "\n";

    case "listItem":
      return "- " + content.trim().replace(/\n/g, "\n  ") + "\n";

    case "hardBreak":
      return "\n";

    default:
      return content;
  }
}