# Vocify para Mac

App nativa que muestra el dashboard de Vocify (mismo sidebar, memos, ajustes) y graba reuniones de Zoom, Meet o Teams sin bot: tu micrófono como **You** y el audio del sistema como **Them**. Habla con **https://api.getvocify.com/api/v1**.

## Construir y abrir

Necesita el repo del dashboard en `~/getvocify` (o `GETVOCIFY_ROOT=/ruta`).

```bash
cd apps/macos
bash scripts/build-app.sh
open Vocify.app
```

`build-app.sh` compila el dashboard contra producción y lo mete dentro de la app, así que no depende de lo desplegado en app.getvocify.com. `VOCIFY_API_URL` apunta a otro backend (p. ej. staging).

DMG sin firmar (**clic derecho → Abrir** la primera vez):

```bash
bash apps/macos/scripts/package-dmg.sh
open dist/Vocify-macos.dmg
```

## Grabar una reunión

1. Entra con tu cuenta de Vocify.
2. **New Memo → Record meeting**, o **⌘R** desde cualquier pantalla (menú **Meeting**).
3. La primera vez macOS pide **Micrófono** y **Grabación de pantalla y audio del sistema**. Tras conceder la segunda, **cierra y vuelve a abrir Vocify** (macOS lo exige).
4. Durante la llamada queda una pastilla flotante con el tiempo y la última frase. Puedes navegar por el dashboard; la grabación sigue y hay un botón **Stop** en la cabecera.
5. **Stop** (en la pastilla, la cabecera o ⌘R) termina la transcripción y abre el memo para revisar y aprobar en el CRM.

Cerrar la ventana no corta la grabación; salir de la app con una grabación en curso pide confirmación.

Cada build nuevo se firma ad hoc, así que macOS puede volver a pedir los permisos tras recompilar.

## Desarrollo

- Dashboard en caliente: `npm run dev` en `~/getvocify`, luego `VOCIFY_WEB_ORIGIN=http://localhost:8080 Vocify.app/Contents/MacOS/Vocify`.
- Comprobaciones del núcleo: `cd apps/macos && swift run VocifyCoreChecks`.
- CI (`.github/workflows/desktop-installers.yml`) necesita el secreto `GETVOCIFY_REPO_TOKEN` para clonar el dashboard.

## Windows

`apps/windows/VocifyCompanion` es una app WPF (.NET 8):

```bash
dotnet publish apps/windows/VocifyCompanion/VocifyCompanion.csproj -c Release -r win-x64 --self-contained -o dist/windows
```

## Arrancar

```bash
npm start
# o
./scripts/dev-desktop.sh
```

Abre **Vocify.app** (dashboard embebido). El Electron antiguo (`renderer/`) ya no se usa en Mac.
