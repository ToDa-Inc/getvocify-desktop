import AppKit
import SwiftUI
import WebKit
import VocifyCore

private let shellBackground = NSColor(
    red: 0xf7 / 255,
    green: 0xf4 / 255,
    blue: 0xee / 255,
    alpha: 1
)

private func isAppHost(_ host: String?) -> Bool {
    let h = (host ?? "").lowercased()
    return h == "127.0.0.1" || h == "localhost"
}

private func isTrustedMediaHost(_ host: String) -> Bool {
    let h = host.lowercased()
    return isAppHost(h) || h == "getvocify.com" || h.hasSuffix(".getvocify.com")
}

final class DashboardUIDelegate: NSObject, WKUIDelegate {
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(isTrustedMediaHost(origin.host) ? .grant : .deny)
    }

    /// `target=_blank` and `window.open` go to the default browser.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" || url.scheme == "http" || url.scheme == "mailto" {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
}

final class DashboardNavigationDelegate: NSObject, WKNavigationDelegate {
    /// The dashboard runs on the embedded origin; anything else (HubSpot OAuth, docs, booking) opens in the browser.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url,
              navigationAction.targetFrame?.isMainFrame ?? true,
              !isAppHost(url.host),
              ["http", "https", "mailto"].contains(url.scheme ?? ""),
              webView.url.map({ isAppHost($0.host) }) ?? false
        else {
            decisionHandler(.allow)
            return
        }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }
}

/// Owns the one web view for the app's lifetime so closing the window never tears down a live meeting.
@MainActor
final class BridgeHolder: ObservableObject {
    let bridge = DesktopBridge()
    let uiDelegate = DashboardUIDelegate()
    let navigationDelegate = DashboardNavigationDelegate()
    private let server = EmbeddedDashboardServer(
        root: EmbeddedDashboardServer.bundledWebRoot()
            ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
    )
    private var cachedWebView: WKWebView?

    var webView: WKWebView {
        if let cachedWebView { return cachedWebView }
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        if let source = DesktopBridge.bridgeScriptSource() {
            config.userContentController.addUserScript(
                WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "vocify")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.translatesAutoresizingMaskIntoConstraints = false
        webView.setValue(false, forKey: "drawsBackground")
        webView.uiDelegate = uiDelegate
        webView.navigationDelegate = navigationDelegate
        bridge.mainWebView = webView
        webView.load(URLRequest(url: entryURL()))
        OverlayPanelController.shared.prepareWebOverlay(bridge: bridge, uiDelegate: uiDelegate)
        cachedWebView = webView
        return webView
    }

    private func entryURL() -> URL {
        if let raw = ProcessInfo.processInfo.environment["VOCIFY_WEB_ORIGIN"], !raw.isEmpty {
            return LiveURL.dashboardEntry(webOrigin: raw)
        }
        if EmbeddedDashboardServer.bundledWebRoot() != nil {
            do {
                try server.start()
                if let base = server.baseURL {
                    return base.appendingPathComponent("dashboard/record")
                }
            } catch {
                fputs("EmbeddedDashboardServer: \(error)\n", stderr)
            }
        }
        return LiveURL.dashboardEntry()
    }
}

struct WebDashboardView: NSViewRepresentable {
    @ObservedObject var bridgeHolder: BridgeHolder

    func makeNSView(context: Context) -> NSView {
        let container = NSView(frame: .zero)
        container.wantsLayer = true
        container.layer?.backgroundColor = shellBackground.cgColor

        let webView = bridgeHolder.webView
        webView.removeFromSuperview()
        container.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
        ])
        return container
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}
