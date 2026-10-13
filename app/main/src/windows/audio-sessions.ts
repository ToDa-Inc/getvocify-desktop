/**
 * The audio sessions playing sound on this PC, read through Windows Core Audio (IAudioSessionManager2 on every active
 * output device, IAudioSessionControl2::GetState and GetProcessId): one long-lived PowerShell that prints
 * `SESSIONS [{"pid":..,"app":"..","id":".."}]` whenever the set of active sessions changes (checked every 500 ms).
 * `id` is the session instance identifier, so two sessions of one app are told apart. Parsed by call-audio-session.ts.
 * The C# is C# 5: Windows PowerShell 5.1 compiles Add-Type code with it. CI runs it on Windows (test/windows-real.mjs).
 */
export const AUDIO_SESSIONS_SCRIPT = String.raw`$ErrorActionPreference = 'Stop'
Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace VocifyAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator { [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices); }

  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection { [PreserveSig] int GetCount(out int count); [PreserveSig] int Item(int index, out IMMDevice device); }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance); }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(IntPtr groupingParam, int flags, out IntPtr control);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr groupingParam, int flags, out IntPtr volume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator enumerator);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator { [PreserveSig] int GetCount(out int count); [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session); }

  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName(out IntPtr name);
    [PreserveSig] int SetDisplayName(IntPtr name, IntPtr eventContext);
    [PreserveSig] int GetIconPath(out IntPtr path);
    [PreserveSig] int SetIconPath(IntPtr path, IntPtr eventContext);
    [PreserveSig] int GetGroupingParam(out Guid groupingParam);
    [PreserveSig] int SetGroupingParam(ref Guid groupingParam, IntPtr eventContext);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int GetSessionIdentifier(out IntPtr id);
    [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
    [PreserveSig] int GetProcessId(out uint pid);
  }

  public static class Sessions {
    static string Json(string value) {
      StringBuilder b = new StringBuilder();
      foreach (char c in value ?? "") {
        if (c < ' ') continue;
        if (c == '\\' || c == '"') b.Append('\\');
        b.Append(c);
      }
      return b.ToString();
    }

    // Sessions whose stream is running (AudioSessionStateActive = 1) on every active output device.
    public static string Active() {
      List<string> items = new List<string>();
      IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
      IMMDeviceCollection devices;
      if (enumerator.EnumAudioEndpoints(0, 1, out devices) != 0) return "[]";
      int count;
      devices.GetCount(out count);
      for (int d = 0; d < count; d++) {
        IMMDevice device;
        if (devices.Item(d, out device) != 0) continue;
        Guid iid = typeof(IAudioSessionManager2).GUID;
        object manager;
        if (device.Activate(ref iid, 23, IntPtr.Zero, out manager) != 0) continue;
        IAudioSessionEnumerator sessions;
        if (((IAudioSessionManager2)manager).GetSessionEnumerator(out sessions) != 0) continue;
        int n;
        sessions.GetCount(out n);
        for (int i = 0; i < n; i++) {
          IAudioSessionControl2 session;
          if (sessions.GetSession(i, out session) != 0) continue;
          int state;
          if (session.GetState(out state) != 0 || state != 1) continue;
          uint pid = 0;
          session.GetProcessId(out pid);
          string id = "";
          IntPtr raw;
          if (session.GetSessionInstanceIdentifier(out raw) == 0 && raw != IntPtr.Zero) {
            id = Marshal.PtrToStringUni(raw);
            Marshal.FreeCoTaskMem(raw);
          }
          string app = pid == 0 ? "system-sounds" : "?";
          try { if (pid != 0) app = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch (Exception) {}
          items.Add("{\"pid\":" + pid + ",\"app\":\"" + Json(app) + "\",\"id\":\"" + Json(id) + "\"}");
        }
      }
      items.Sort(StringComparer.Ordinal);
      return "[" + string.Join(",", items.ToArray()) + "]";
    }
  }
}
'@
$last = $null
while ($true) {
  try { $now = 'SESSIONS ' + [VocifyAudio.Sessions]::Active() } catch { $now = 'ERROR ' + $_.Exception.Message }
  if ($now -ne $last) { [Console]::Out.WriteLine($now); [Console]::Out.Flush(); $last = $now }
  Start-Sleep -Milliseconds 500
}
`;
