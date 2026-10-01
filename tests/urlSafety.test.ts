import { describe, expect, it } from 'vitest'
import { externalUrlBlockReason, isOpenableUrl } from '../src/shared/urlSafety'

describe('externalUrlBlockReason', () => {
  it('opens the web and mail links a screen assistant actually needs', () => {
    expect(externalUrlBlockReason('https://docs.new')).toBeNull()
    expect(externalUrlBlockReason('http://127.0.0.1:11434')).toBeNull()
    expect(externalUrlBlockReason('https://www.google.com/search?q=weather')).toBeNull()
    expect(externalUrlBlockReason('mailto:someone@example.com')).toBeNull()
  })

  it('refuses schemes the OS shell could turn into a program or a file read', () => {
    expect(externalUrlBlockReason('file:///C:/Windows/System32/cmd.exe')).toBeTruthy()
    expect(externalUrlBlockReason('file://host.example/share/doc.lnk')).toBeTruthy()
    expect(externalUrlBlockReason('search-ms:query=x')).toBeTruthy()
    expect(externalUrlBlockReason('ms-msdt:/id PCWDiagnostic')).toBeTruthy()
    expect(externalUrlBlockReason('javascript:alert(1)')).toBeTruthy()
    expect(externalUrlBlockReason('data:text/html,<h1>x')).toBeTruthy()
    expect(externalUrlBlockReason('vbscript:msgbox')).toBeTruthy()
  })

  it('refuses a bare word or UNC path that is not a web address at all', () => {
    expect(externalUrlBlockReason('chatgpt')).toBeTruthy()
    expect(externalUrlBlockReason('\\\\host\\share')).toBeTruthy()
    expect(externalUrlBlockReason('')).toBeTruthy()
  })

  it('names the scheme in the reason, so the user and the model see why', () => {
    expect(externalUrlBlockReason('file:///C:/x')).toMatch(/file:/)
    expect(isOpenableUrl('https://example.com')).toBe(true)
    expect(isOpenableUrl('file:///C:/x')).toBe(false)
  })
})
