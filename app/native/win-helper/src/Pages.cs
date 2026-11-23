// The pages open in the rep's browsers, read from each browser window's address bar through UI Automation: a port of
// the PowerShell reader (main/src/windows/browser-pages.ts), with the same commands and the same answers.
//   front -> the foreground window's process name
//   page  -> "<browser>\t<address>" for the active tab of the window in front
//   read  -> one such line per browser window
// Each answer ends with a "<<END>>" line. The walk skips the page itself (Document controls): only the browser's own
// interface is read. A window's address bar, once found, is kept by window handle and read directly.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Automation;

namespace VocifyHelper {
  static class Pages {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] static extern bool IsHungAppWindow(IntPtr window);

    static readonly string[] Browsers = { "chrome", "msedge", "brave", "opera", "vivaldi", "firefox", "arc" };
    static readonly Dictionary<int, AutomationElement> Bars = new Dictionary<int, AutomationElement>();

    static string ReadBar(AutomationElement bar) {
      try {
        object pattern;
        if (bar.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return ((ValuePattern)pattern).Current.Value;
      } catch (Exception) {
      }
      return null;
    }

    // The text field in the top band of the window that holds an address: not found by its (translated) name.
    static AutomationElement FindBar(AutomationElement window) {
      double top;
      try {
        top = window.Current.BoundingRectangle.Top;
      } catch (Exception) {
        return null;
      }
      TreeWalker walker = TreeWalker.ControlViewWalker;
      Stack<KeyValuePair<AutomationElement, int>> stack = new Stack<KeyValuePair<AutomationElement, int>>();
      stack.Push(new KeyValuePair<AutomationElement, int>(window, 0));
      while (stack.Count > 0) {
        KeyValuePair<AutomationElement, int> item = stack.Pop();
        AutomationElement element = item.Key;
        int depth = item.Value;
        if (depth > 9) continue;
        try {
          ControlType type = element.Current.ControlType;
          if (type == ControlType.Document) continue;
          if (type == ControlType.Edit) {
            if (element.Current.BoundingRectangle.Top - top < 170 && !string.IsNullOrEmpty(ReadBar(element))) return element;
            continue;
          }
          AutomationElement child = walker.GetFirstChild(element);
          while (child != null) {
            stack.Push(new KeyValuePair<AutomationElement, int>(child, depth + 1));
            child = walker.GetNextSibling(child);
          }
        } catch (Exception) {
          // An element that went away while it was read: the rest of the window is still walked.
        }
      }
      return null;
    }

    static string Address(AutomationElement window) {
      int handle;
      try {
        handle = window.Current.NativeWindowHandle;
      } catch (Exception) {
        return null;
      }
      AutomationElement bar;
      if (Bars.TryGetValue(handle, out bar)) {
        string value = ReadBar(bar);
        if (!string.IsNullOrEmpty(value)) return value;
        Bars.Remove(handle);
      }
      bar = FindBar(window);
      if (bar == null) return null;
      if (Bars.Count >= 50) Bars.Clear();
      Bars[handle] = bar;
      return ReadBar(bar);
    }

    static void Front(TextWriter output, bool page) {
      IntPtr window = GetForegroundWindow();
      if (window == IntPtr.Zero) return;
      uint owner;
      GetWindowThreadProcessId(window, out owner);
      string name;
      try {
        using (Process process = Process.GetProcessById((int)owner)) name = process.ProcessName;
      } catch (Exception) {
        return;
      }
      if (!page) {
        output.WriteLine(name);
        return;
      }
      if (IsHungAppWindow(window)) return;
      string address = null;
      try {
        address = Address(AutomationElement.FromHandle(window));
      } catch (Exception) {
      }
      if (!string.IsNullOrEmpty(address)) output.WriteLine(name + "\t" + address);
    }

    static void ReadAll(TextWriter output) {
      Dictionary<int, string> browsers = new Dictionary<int, string>();
      foreach (string browser in Browsers) {
        Process[] found;
        try {
          found = Process.GetProcessesByName(browser);
        } catch (Exception) {
          continue;
        }
        foreach (Process process in found) {
          browsers[process.Id] = process.ProcessName;
          process.Dispose();
        }
      }
      if (browsers.Count == 0) return;
      Condition windows = new OrCondition(
        new PropertyCondition(AutomationElement.ClassNameProperty, "Chrome_WidgetWin_1"),
        new PropertyCondition(AutomationElement.ClassNameProperty, "MozillaWindowClass"));
      AutomationElementCollection all;
      try {
        all = AutomationElement.RootElement.FindAll(TreeScope.Children, windows);
      } catch (Exception) {
        return;
      }
      foreach (AutomationElement window in all) {
        try {
          string name;
          if (!browsers.TryGetValue(window.Current.ProcessId, out name)) continue;
          if (IsHungAppWindow(new IntPtr(window.Current.NativeWindowHandle))) continue;
          string address = Address(window);
          if (!string.IsNullOrEmpty(address)) output.WriteLine(name + "\t" + address);
        } catch (Exception) {
        }
      }
    }

    public static void Loop(TextReader input, TextWriter output) {
      string line;
      while ((line = input.ReadLine()) != null) {
        line = line.Trim();
        try {
          if (line == "front") Front(output, false);
          else if (line == "page") Front(output, true);
          else if (line == "read") ReadAll(output);
        } catch (Exception) {
          // The answer is empty: the app reads that as "nothing known", as it does for the PowerShell reader.
        }
        output.WriteLine("<<END>>");
        output.Flush();
      }
    }
  }
}
