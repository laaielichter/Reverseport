# Android and iOS packages, property lists and Steam files

`re_archive` lists an `.apk` or `.ipa` like any ZIP and adds a summary of what the package declares. `re_save` reads
Apple property lists and Steam's text files. Nothing extra needs to be installed.

| File                                 | Tool         | What is read                                                                                                                                                |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.apk`                               | `re_archive` | The binary `AndroidManifest.xml` decoded: package, versions, SDK levels, permissions, activities with the launcher, flags such as `debuggable`; native ABIs |
| `resources.arsc` inside the `.apk`   | `re_archive` | Labels and the version name resolved through it; `resourceStrings` lists string resources                                                                   |
| `.ipa`                               | `re_archive` | `Info.plist`: bundle id, version, minimum OS, URL schemes, permission texts, frameworks                                                                     |
| Apple property list (binary and XML) | `re_save`    | Every field with type and sample, for example Unity PlayerPrefs on macOS                                                                                    |
| Steam VDF/ACF text                   | `re_save`    | Every field, and for `appmanifest_*.acf` a summary (app id, name, install folder, build id, size)                                                           |

## Example: an `.apk`

A small package built for this page with the writers from `port/test/helpers.mjs` (a binary manifest, a resource
table and placeholder libraries):

```bash
reverseport archive ./game.apk
```

The `android` block of the result, trimmed:

```json
{
  "format": "zip",
  "android": {
    "package": "com.example.game",
    "versionCode": 42,
    "versionName": "1.4.2",
    "minSdk": 24,
    "targetSdk": 34,
    "application": {
      "label": "Example Gäme ☃",
      "icon": "res/mipmap/ic_launcher.png"
    },
    "flags": {
      "debuggable": true,
      "allowBackup": false,
      "usesCleartextTraffic": true
    },
    "permissions": [
      "android.permission.INTERNET",
      "android.permission.VIBRATE"
    ],
    "launcherActivity": "com.example.game.MainActivity",
    "counts": {
      "activities": 2,
      "services": 1,
      "receivers": 1,
      "providers": 1
    },
    "engineMetaData": { "unity.build-id": "abc-123 <\"&>" },
    "nativeLibs": {
      "abis": ["arm64-v8a", "armeabi-v7a"],
      "libraries": ["libil2cpp.so", "libunity.so"]
    }
  }
}
```

`--manifest` adds the whole decoded manifest as XML text; `--resource-strings 50` lists that many string resources.

## Example: an `.ipa`

```bash
reverseport archive ./game.ipa
```

```json
{
  "ios": {
    "app": "Payload/Game.app",
    "bundleId": "com.example.game",
    "displayName": "Example Game",
    "version": "1.4.2",
    "build": "42",
    "minimumOS": "13.0",
    "urlSchemes": ["examplegame", "fb1234"],
    "permissions": {
      "NSCameraUsageDescription": "Scan codes",
      "NSMicrophoneUsageDescription": "Voice chat"
    },
    "allowsArbitraryLoads": true,
    "frameworks": ["UnityFramework"]
  }
}
```

`--manifest` adds the whole `Info.plist`.

## Example: a Steam app manifest

```bash
reverseport save ./appmanifest_620.acf
```

```json
{
  "container": "vdf",
  "layers": ["vdf"],
  "steam": {
    "kind": "steam-appmanifest",
    "appid": 620,
    "name": "Portal 2",
    "installdir": "Portal 2",
    "buildid": "1234567",
    "size": 12345678901
  }
}
```

## Limits

- This is what the package declares, not what the code does. For classes, decompiled methods and references use
  the deep-analysis engine with JADX or Apktool ([Android guide](guides/android/android-analysis.md)); for signing,
  see [APK signature schemes](apk-signature.md).
- Engine files inside the package are read by their own tools: `libil2cpp.so` with `re_binary`,
  `global-metadata.dat` with `re_il2cpp`, `data.unity3d` with `re_archive`.
- Encrypted entries are reported, never decrypted.
