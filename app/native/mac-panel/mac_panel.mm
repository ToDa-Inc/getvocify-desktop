// The island must never activate Vocify when it is clicked: activating the app brings its main window (the dashboard)
// forward and takes the keyboard from the rep's call. Electron's `type: 'panel'` is an NSWindow subclass, on which
// macOS ignores NSWindowStyleMaskNonactivatingPanel ("NSWindow does not support nonactivating panel styleMask"), so the
// window is asked directly not to activate its app (what a real non-activating NSPanel does underneath). The selector is
// private: it is only called when the window answers to it, so a macOS without it keeps today's behaviour.
#import <AppKit/AppKit.h>
#import <objc/message.h>
#include <napi.h>

static NSWindow* WindowFromHandle(const Napi::CallbackInfo& info) {
  if (info.Length() < 1 || !info[0].IsBuffer()) return nil;
  auto handle = info[0].As<Napi::Buffer<char>>();
  if (handle.Length() < sizeof(void*)) return nil;
  // Electron's handle is the window's NSView*, as raw bytes.
  void* raw = *reinterpret_cast<void**>(handle.Data());
  NSView* view = (__bridge NSView*)raw;
  return view.window;
}

// preventActivation(window.getNativeWindowHandle()) -> true when the window now never activates the app.
static Napi::Value PreventActivation(const Napi::CallbackInfo& info) {
  NSWindow* window = WindowFromHandle(info);
  SEL prevent = NSSelectorFromString(@"_setPreventsActivation:");
  if (window == nil || ![window respondsToSelector:prevent]) return Napi::Boolean::New(info.Env(), false);
  ((void (*)(id, SEL, BOOL))objc_msgSend)(window, prevent, YES);
  return Napi::Boolean::New(info.Env(), true);
}

// isActive() -> whether Vocify is the active app (for checks: a click on the island must leave it false).
static Napi::Value IsActive(const Napi::CallbackInfo& info) {
  return Napi::Boolean::New(info.Env(), [NSApp isActive]);
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("preventActivation", Napi::Function::New(env, PreventActivation));
  exports.Set("isActive", Napi::Function::New(env, IsActive));
  return exports;
}

NODE_API_MODULE(mac_panel, Init)
