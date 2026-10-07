{
  "targets": [
    {
      "target_name": "mac_panel",
      "sources": ["mac_panel.mm"],
      "include_dirs": ["<!(node -p \"require('path').dirname(require.resolve('node-addon-api/package.json'))\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
      "xcode_settings": {
        "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-fobjc-arc"],
        "MACOSX_DEPLOYMENT_TARGET": "14.0"
      },
      "link_settings": { "libraries": ["-framework AppKit"] }
    }
  ]
}
