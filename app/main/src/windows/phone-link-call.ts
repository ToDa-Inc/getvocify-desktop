/**
 * Phone Link's Call button, pressed for the rep after Vocify opened the call (a `tel:` link only loads the number into
 * Phone Link's dialer). Read through Windows UI Automation by Phone Link's own automation ids, which do not change with
 * the language: `AccumulatorTextBlock` (the number in the dialer) and `ButtonCall`. It presses only when the dialer
 * shows exactly the digits Vocify sent and Call is enabled; anything else and the rep presses Call as before.
 * Measured on Phone Link with an iPhone (2026-10-13): from a fresh Phone Link the dialer showed "+34 612 34 56 78"
 * and Call was enabled; its keypad buttons ignore UI Automation presses, so nothing is typed.
 */

/** What the script printed: pressed, or why not. */
export type PhoneLinkCall = "called" | "not_ready" | "failed";

/** The digits a dialer has to show for Call to be pressed ("+34 612 34 56 78" → "34612345678"). */
export function dialedDigits(number: string): string {
  return number.replace(/\D/g, "");
}

/** The PowerShell that waits up to `seconds` for the number in Phone Link's dialer, then presses Call. */
export function phoneLinkCallScript(number: string, seconds = 10): string {
  const want = dialedDigits(number);
  if (!want) throw new Error("no digits to dial");
  return [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes",
    "$A=[System.Windows.Automation.AutomationElement]; $S=[System.Windows.Automation.TreeScope]; $T=[System.Windows.Automation.Condition]::TrueCondition",
    "function Id($w,$id){ $w.FindFirst($S::Descendants,(New-Object System.Windows.Automation.PropertyCondition($A::AutomationIdProperty,$id))) }",
    `$want='${want}'`,
    `$until=(Get-Date).AddSeconds(${seconds})`,
    "while((Get-Date) -lt $until){",
    "  Start-Sleep -Milliseconds 300",
    "  try {",
    "    $w=$A::RootElement.FindAll($S::Children,$T) | ? { (Get-Process -Id $_.Current.ProcessId -EA SilentlyContinue).ProcessName -eq 'PhoneExperienceHost' } | Select -First 1",
    "    if(-not $w){ continue }",
    "    $call=Id $w 'ButtonCall'; $shown=Id $w 'AccumulatorTextBlock'",
    "    if(-not $call -or -not $shown -or -not $call.Current.IsEnabled){ continue }",
    "    if(($shown.Current.Name -replace '\\D','') -ne $want){ continue }",
    "    $call.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()",
    "    'called'; exit 0",
    "  } catch { continue }",
    "}",
    "'not_ready'",
  ].join("\n");
}

/** The script's answer, from its output. */
export function parsePhoneLinkCall(output: string): PhoneLinkCall {
  const last = output.trim().split(/\r?\n/).pop()?.trim();
  return last === "called" ? "called" : last === "not_ready" ? "not_ready" : "failed";
}
