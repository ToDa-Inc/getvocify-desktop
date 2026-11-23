// vocify-win-helper.exe: what the Windows app needs from the system, in one small program instead of the PowerShell
// readers (which take tens of MB each, seconds to start on a slow PC, and compile their C# at every launch).
//   capture   apps holding the microphone ("CAPTURE [...]", on change) and the microphone-use record ("CONSENT [...]")
//   sessions  apps playing sound ("SESSIONS [...]", on change)
//   pages     the browsers' address bars, asked on stdin (see Pages.cs)
//   version   prints the protocol version and exits
// Optional "--parent <pid>": the helper exits when that process is gone, so it never outlives the app.
// The lines are the ones the PowerShell readers print, so the app reads either the same way.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

namespace VocifyHelper {
  static class Program {
    const string Version = "1";

    static string OneLine(string text) {
      return (text ?? "").Replace("\r", " ").Replace("\n", " ");
    }

    static void WatchParent(string[] args) {
      int pid = 0;
      for (int i = 0; i + 1 < args.Length; i++) {
        if (args[i] == "--parent") int.TryParse(args[i + 1], out pid);
      }
      if (pid <= 0) return;
      Thread watcher = new Thread(delegate() {
        while (true) {
          Thread.Sleep(5000);
          try {
            using (Process parent = Process.GetProcessById(pid)) {
              if (parent.HasExited) Environment.Exit(0);
            }
          } catch (Exception) {
            Environment.Exit(0);
          }
        }
      });
      watcher.IsBackground = true;
      watcher.Start();
    }

    // Sessions on change (every 500 ms); with the capture flow, the microphone-use record once a second, printed when it
    // changes and every ten seconds so the app knows the helper lives.
    static void Sessions(TextWriter output, int flow, string prefix) {
      string last = null;
      string lastConsent = null;
      int iteration = 0;
      while (true) {
        string now;
        try {
          now = prefix + " " + VocifyAudio.Sessions.Active(flow);
        } catch (Exception error) {
          now = "ERROR " + OneLine(error.Message);
        }
        if (now != last) {
          output.WriteLine(now);
          output.Flush();
          last = now;
        }
        if (flow == 1) {
          iteration++;
          if (iteration % 2 == 0) {
            string consent;
            try {
              consent = "CONSENT " + VocifyAudio.Sessions.Consent();
            } catch (Exception error) {
              consent = "CONSENT_ERROR " + OneLine(error.Message);
            }
            if (consent != lastConsent || iteration % 20 == 0) {
              output.WriteLine(consent);
              output.Flush();
              lastConsent = consent;
            }
          }
        }
        Thread.Sleep(500);
      }
    }

    static int Main(string[] args) {
      string command = args.Length > 0 ? args[0] : "";
      // UTF-8 without a byte-order mark: the app reads lines, and a mark would be part of the first one.
      UTF8Encoding utf8 = new UTF8Encoding(false);
      TextWriter output = new StreamWriter(Console.OpenStandardOutput(), utf8);
      try {
        if (command == "version") {
          output.WriteLine("vocify-win-helper " + Version);
          output.Flush();
          return 0;
        }
        WatchParent(args);
        if (command == "capture") Sessions(output, 1, "CAPTURE");
        else if (command == "sessions") Sessions(output, 0, "SESSIONS");
        else if (command == "pages") Pages.Loop(new StreamReader(Console.OpenStandardInput(), utf8), output);
        else return 2;
        return 0;
      } catch (IOException) {
        // The app closed the pipe: nothing is left to tell.
        return 0;
      }
    }
  }
}
