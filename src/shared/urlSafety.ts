/**
 * What Argus is willing to hand to the operating system to "open".
 *
 * Agent Mode's open_url and the built-in workflows both end in
 * `shell.openExternal(url)`, and the URL is chosen by the model - which can be
 * steered by text on a web page. openExternal does not just open web pages: it
 * hands the string to the Windows shell, which also launches local programs
 * (`file:///C:/Windows/System32/cmd.exe`), reaches out over the network for a
 * UNC path (`file://host/share`, which leaks an NTLM handshake), and fires
 * protocol handlers that have been used to run code (`search-ms:`, `ms-msdt:`).
 *
 * So the rule is an allow-list, not a block-list: only the three schemes a
 * screen assistant has any business opening get through, and everything else is
 * refused by name. Kept free of Electron so it can be tested directly and used
 * on both sides of the process boundary.
 */

/** The only schemes Argus will open. http(s) for pages, mailto for a draft. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

function shorten(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 70 ? `${oneLine.slice(0, 70)}…` : oneLine
}

/**
 * Why this address must not be opened, or null when it is safe to.
 *
 * The reason is written for the user, because it is shown to them (as a blocked
 * step) and fed back to the model (as the result of the call) verbatim.
 */
export function externalUrlBlockReason(raw: string): string | null {
  const url = (raw ?? '').trim()
  if (!url) return 'There is no address to open.'

  // A scheme is letters/digits/+/-/. up to the first colon. No colon at all
  // means it is not a URL - a bare word, or a "\\host\share" UNC path, both of
  // which the shell would interpret in ways the user did not ask for.
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url)
  if (!match) {
    return `"${shorten(url)}" is not a web address (it has no https://), so Argus will not open it.`
  }

  const scheme = `${match[1]!.toLowerCase()}:`
  if (!ALLOWED_SCHEMES.has(scheme)) {
    return `Argus only opens http, https and mailto links. It will not open a "${match[1]!.toLowerCase()}:" link ("${shorten(url)}"), which could run a program or reach a file on your machine.`
  }

  return null
}

/** True when this address is safe to hand to the OS. */
export function isOpenableUrl(raw: string): boolean {
  return externalUrlBlockReason(raw) === null
}
