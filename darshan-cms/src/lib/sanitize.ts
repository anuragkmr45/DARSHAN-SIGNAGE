// Minimal sanitizer to strip scripts/styles and dangerous attributes before using any raw HTML.
export const sanitizeHtml = (input: string): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(input, "text/html");

  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  doc.querySelectorAll<HTMLElement>("[onload],[onclick],[onerror],[style]").forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      if (attr.name.startsWith("on") || attr.name === "style") {
        el.removeAttribute(attr.name);
      }
    });
  });

  return doc.body.innerHTML;
};
