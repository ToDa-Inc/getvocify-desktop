// The audio sessions and the microphone-use record, read through Windows Core Audio and the registry.
// This is the same C# the PowerShell readers compile at every launch (main/src/windows/audio-sessions.ts): keep the two
// in step until the PowerShell readers are retired. C# 5, so the .NET Framework's own compiler builds it.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

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

    // Every COM object read here is released at once: the reader runs every 500 ms for a whole call, and leaving them to
    // the garbage collector kept every device, manager and session of every pass alive until it ran.
    static void Release(object value) {
      if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
    }

    // The process's name and executable path ("?" and "" when Windows does not say, e.g. another user's process).
    static void Describe(uint pid, out string name, out string path) {
      name = "?";
      path = "";
      if (pid == 0) {
        name = "system-sounds";
        return;
      }
      try {
        using (System.Diagnostics.Process process = System.Diagnostics.Process.GetProcessById((int)pid)) {
          name = process.ProcessName;
          try {
            path = process.MainModule.FileName;
          } catch (Exception) {
            path = "";
          }
        }
      } catch (Exception) {
        name = "?";
      }
    }

    // Sessions whose stream is running (AudioSessionStateActive = 1) on every active endpoint of one data flow
    // (0 render, 1 capture).
    public static string Active(int dataFlow) {
      List<string> items = new List<string>();
      IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
      IMMDeviceCollection devices = null;
      try {
        if (enumerator.EnumAudioEndpoints(dataFlow, 1, out devices) != 0) return "[]";
        int count;
        devices.GetCount(out count);
        for (int d = 0; d < count; d++) {
          IMMDevice device = null;
          object manager = null;
          IAudioSessionEnumerator sessions = null;
          try {
            if (devices.Item(d, out device) != 0) continue;
            Guid iid = typeof(IAudioSessionManager2).GUID;
            if (device.Activate(ref iid, 23, IntPtr.Zero, out manager) != 0) continue;
            if (((IAudioSessionManager2)manager).GetSessionEnumerator(out sessions) != 0) continue;
            int n;
            sessions.GetCount(out n);
            for (int i = 0; i < n; i++) {
              IAudioSessionControl2 session = null;
              try {
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
                string name;
                string path;
                Describe(pid, out name, out path);
                items.Add("{\"pid\":" + pid + ",\"app\":\"" + Json(name) + "\",\"path\":\"" + Json(path) + "\",\"id\":\"" + Json(id) + "\"}");
              } finally {
                Release(session);
              }
            }
          } finally {
            Release(sessions);
            Release(manager);
            Release(device);
          }
        }
      } finally {
        Release(devices);
        Release(enumerator);
      }
      items.Sort(StringComparer.Ordinal);
      return "[" + string.Join(",", items.ToArray()) + "]";
    }

    // The microphone-use record (the consent store): every key with a use, read in process as 'reg query /s' lists it.
    // 'k' is the key below the microphone key (NonPackaged\<path with # for \>, or a package name); 's' and 'e' are the
    // start and stop times, FILETIME ticks as text (past the exact range of a JSON number).
    static string Ticks(object value) {
      return value is long ? ((long)value).ToString() : "0";
    }

    static void ConsentWalk(RegistryKey key, string relative, List<string> items, int depth) {
      if (relative.Length > 0) {
        object start = key.GetValue("LastUsedTimeStart");
        object stop = key.GetValue("LastUsedTimeStop");
        if (start != null || stop != null) {
          items.Add("{\"k\":\"" + Json(relative) + "\",\"s\":\"" + Ticks(start) + "\",\"e\":\"" + Ticks(stop) + "\"}");
        }
      }
      if (depth >= 4) return;
      foreach (string name in key.GetSubKeyNames()) {
        using (RegistryKey child = key.OpenSubKey(name)) {
          if (child != null) ConsentWalk(child, relative.Length == 0 ? name : relative + "\\" + name, items, depth + 1);
        }
      }
    }

    public static string Consent() {
      List<string> items = new List<string>();
      using (RegistryKey root = Registry.CurrentUser.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone")) {
        if (root != null) ConsentWalk(root, "", items, 0);
      }
      return "[" + string.Join(",", items.ToArray()) + "]";
    }
  }
}
