/**
 * A picture's address: a web address (http or https), or a path on the
 * store's own site such as the demo pictures' `/demo/notebook.svg`.
 */
export function isPictureAddress(value: string): boolean {
  if (/^\/(?![/\\])/.test(value)) return !/\s/.test(value);
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
