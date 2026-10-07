import { CrmPages } from "../../../core/crmPages.ts";

/**
 * The pages open in the rep's browsers on Windows, read from each browser window's address bar through UI Automation.
 * No extension and no permission prompt. Like the Mac's AppleScript read, it sees the active tab of every window, so a
 * CRM record in a window of its own (or the HubSpot calling popup) is found, while a CRM tab hidden behind another tab
 * of the same window is not. Only CRM links leave this file; any other page is reduced to the call app it is.
 */

/**
 * PowerShell (Windows PowerShell 5.1 is always present). It walks only each browser window's own interface and skips the
 * page (Document controls), so reading the address bar never touches page content. The address bar is the text field in
 * the top band of the window, not found by its (translated) name.
 */
/** Shared by both scripts: UI Automation set-up, and the address bar of one browser window (the walk skips the page). */
const UIA_SETUP = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
function Find-Address($w) {
  $top = $w.Current.BoundingRectangle.Top
  $stack = New-Object System.Collections.Stack
  $stack.Push(@($w, 0))
  $found = $null
  while ($stack.Count -gt 0 -and -not $found) {
    $item = $stack.Pop(); $el = $item[0]; $depth = $item[1]
    if ($depth -gt 9) { continue }
    $type = $el.Current.ControlType
    if ($type -eq $CT::Document) { continue }
    if ($type -eq $CT::Edit) {
      if (($el.Current.BoundingRectangle.Top - $top) -lt 170) {
        $pattern = $null
        if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
          $value = $pattern.Current.Value
          if ($value) { $found = $value }
        }
      }
      continue
    }
    $child = $walker.GetFirstChild($el)
    while ($child) { $stack.Push(@($child, ($depth + 1))); $child = $walker.GetNextSibling($child) }
  }
  return $found
}
`;

export const READ_PAGES_SCRIPT = String.raw`
${UIA_SETUP}
$browsers = @{}
Get-Process -Name chrome,msedge,brave,opera,vivaldi,firefox,arc | ForEach-Object { $browsers[$_.Id] = $_.ProcessName }
$chromium = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'Chrome_WidgetWin_1')
$firefox = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'MozillaWindowClass')
$either = New-Object System.Windows.Automation.OrCondition($chromium, $firefox)
$windows = $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $either)
foreach ($w in $windows) {
  if (-not $browsers.ContainsKey($w.Current.ProcessId)) { continue }
  $found = Find-Address $w
  if ($found) { Write-Output ($browsers[$w.Current.ProcessId] + [char]9 + $found) }
}
`;

/** `-EncodedCommand` takes the script as UTF-16LE base64, which needs no quoting. */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** The address bar's text as a URL. Browsers hide `https://` in the address bar, so a bare host and path gets it back. */
export function normalizeAddress(raw: string): string | null {
  const value = raw.trim();
  if (value.length === 0 || /\s/.test(value)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(value)) return `https://${value}`;
  return null;
}

export type BrowserPage = { browser: string; url: string };

/** The script's output, one `browser<TAB>address` line per window, as pages with their URLs restored. */
export function parsePageOutput(output: string): BrowserPage[] {
  const pages: BrowserPage[] = [];
  for (const line of output.split(/\r?\n/)) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const url = normalizeAddress(line.slice(tab + 1));
    if (url) pages.push({ browser: line.slice(0, tab).trim().toLowerCase(), url });
  }
  return pages;
}

/** Only the CRM links, as the dashboard expects them (`call:pages`). */
export function crmUrlsOf(pages: BrowserPage[]): string[] {
  return CrmPages.crmURLs(pages.map((p) => p.url).join("\n"));
}

export type PageReader = { read(): Promise<BrowserPage[]> };

/** A reader that runs the script when asked, never more often than `minGapMs`, and gives the last answer meanwhile. */
export function createPageReader(run: (script: string) => Promise<string>, now: () => number, minGapMs = 1500): PageReader {
  let last: { at: number; pages: BrowserPage[] } | null = null;
  let inflight: Promise<BrowserPage[]> | null = null;
  return {
    async read() {
      if (inflight) return inflight;
      if (last && now() - last.at < minGapMs) return last.pages;
      inflight = run(READ_PAGES_SCRIPT)
        .then((output) => parsePageOutput(output))
        .catch(() => [] as BrowserPage[])
        .then((pages) => {
          last = { at: now(), pages };
          return pages;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}

/** The browsers the CRM watcher reads when one of them is in front (Windows process names, as `front` answers). */
export const WATCHED_BROWSERS = new Set(["chrome", "msedge", "brave", "opera", "vivaldi", "firefox", "arc"]);

/**
 * The long-lived reader behind the CRM watcher (see page-reader-process.ts): `front` answers the foreground window's
 * process name, `page` its `browser<TAB>address` (the active tab of the window in front, as the Chrome extension follows
 * the focused tab), `read` the same lines as READ_PAGES_SCRIPT; each answer ends with an `<<END>>` line.
 */
export const READER_LOOP_SCRIPT = String.raw`
${UIA_SETUP}
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class VocifyForeground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
"@
function Read-Pages {
${READ_PAGES_SCRIPT}
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if ($line -eq 'front' -or $line -eq 'page') {
    $window = [VocifyForeground]::GetForegroundWindow()
    [uint32]$owner = 0
    [void][VocifyForeground]::GetWindowThreadProcessId($window, [ref]$owner)
    $process = Get-Process -Id $owner
    if ($process -and $line -eq 'front') { Write-Output $process.ProcessName }
    if ($process -and $line -eq 'page') {
      $address = Find-Address ($AE::FromHandle($window))
      if ($address) { Write-Output ($process.ProcessName + [char]9 + $address) }
    }
  } elseif ($line -eq 'read') {
    Read-Pages
  }
  Write-Output '<<END>>'
  [Console]::Out.Flush()
}
`;
