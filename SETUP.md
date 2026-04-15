# Obsidian Google Drive Sync — Guia de configuracion

Esta guia cubre la configuracion completa para sincronizar tu vault de Obsidian
con Google Drive, tanto en **macOS** como en **iOS**.

---

## Paso 1: Crear proyecto en Google Cloud (una sola vez)

Esto solo se hace una vez. El mismo proyecto sirve para todos tus dispositivos.

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Click en **Select a project** (arriba a la izquierda) → **New Project**
3. Nombre: `obsidian-sync` (o lo que quieras) → **Create**
4. Asegurate de que el proyecto quede seleccionado arriba a la izquierda

## Paso 2: Habilitar Google Drive API

1. En el menu lateral: **APIs & Services** → **Library**
2. Busca **Google Drive API**
3. Click en el resultado → **Enable**

## Paso 3: Configurar la pantalla de consentimiento OAuth

1. Menu lateral: **APIs & Services** → **OAuth consent screen**
2. Selecciona **External** → **Create**
3. Llena los campos obligatorios:
   - App name: `Obsidian Sync` (o lo que quieras)
   - User support email: tu email
   - Developer contact: tu email
4. Click **Save and Continue**
5. En **Scopes**: click **Add or Remove Scopes**
   - Busca `drive.file` y marcalo
   - Click **Update** → **Save and Continue**
6. En **Test users**: click **Add Users**
   - Agrega tu email de Google (el que usaras para Drive)
   - **Save and Continue**
7. Click **Back to Dashboard**

> **Nota**: Mientras la app este en modo "Testing", solo los emails que
> agregaste como test users pueden autenticarse. Esto es suficiente para uso personal.

## Paso 4: Crear credenciales OAuth

Necesitas crear **una o dos credenciales** dependiendo de que dispositivos uses:

### Solo macOS

1. Menu lateral: **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Desktop app**
4. Nombre: `obsidian-mac` (o lo que quieras)
5. Click **Create**
6. Copia el **Client ID** y **Client Secret** — los necesitaras en Obsidian

### macOS + iOS

Necesitas **dos credenciales** (una Desktop, una Web):

**Credencial Desktop (para macOS):**
1. **Create Credentials** → **OAuth client ID**
2. Application type: **Desktop app**
3. Nombre: `obsidian-mac`
4. Click **Create**
5. Guarda el **Client ID** y **Client Secret**

**Credencial Web (para iOS):**
1. **Create Credentials** → **OAuth client ID**
2. Application type: **Web application**
3. Nombre: `obsidian-ios`
4. En **Authorized redirect URIs**, click **Add URI**
5. Ingresa la URL de tu pagina de redirect (ver Paso 5)
   - Ejemplo: `https://tuusuario.github.io/obsidian-gdrive-redirect/`
6. Click **Create**
7. Guarda el **Client ID** y **Client Secret**

> **Importante**: el Client ID de Desktop y el de Web son **diferentes**.
> En macOS usas el de Desktop, en iOS usas el de Web.

---

## Paso 5: Hostear la pagina de redirect (solo si usas iOS)

La pagina de redirect es un archivo HTML estatico que recibe el codigo de
autorizacion de Google y lo reenvia a Obsidian via `obsidian://`. No almacena
ni envia datos a ningun servidor.

### Opcion A: GitHub Pages (recomendado)

1. Crea un repositorio nuevo en GitHub (puede ser privado)
   - Nombre: `obsidian-gdrive-redirect` (o lo que quieras)
2. Sube el archivo `redirect-page/index.html` de este plugin al repositorio
3. Ve a **Settings** → **Pages**
4. Source: **Deploy from a branch** → Branch: `main` → Folder: `/ (root)` o `/docs`
5. Click **Save**
6. Espera 1-2 minutos. Tu URL sera:
   ```
   https://tuusuario.github.io/obsidian-gdrive-redirect/
   ```
7. Usa esta URL como:
   - **Authorized redirect URI** en Google Cloud (Paso 4)
   - **Redirect page URL** en el plugin de Obsidian en iOS

### Opcion B: Cualquier hosting estatico

Puedes usar Netlify, Vercel, Cloudflare Pages, o cualquier hosting que
sirva archivos HTML estaticos. Solo necesitas subir el `index.html`.

---

## Paso 6: Configurar Obsidian en macOS

1. Copia los archivos del plugin (`main.js`, `manifest.json`, `styles.css`)
   a tu vault en:
   ```
   TU_VAULT/.obsidian/plugins/obsidian-gdrive-sync-redstr/
   ```
2. Abre Obsidian → **Settings** → **Community Plugins**
3. Habilita **Google Drive Sync**
4. Ve a los settings del plugin:
   - **Client ID**: pega el Client ID de tipo **Desktop**
   - **Client Secret**: pega el Client Secret de tipo **Desktop**
5. Click **Login with Google**
   - Se abre tu navegador con la pantalla de consentimiento de Google
   - Selecciona tu cuenta → **Allow**
   - Veras "Authorization successful" en el navegador
   - Regresa a Obsidian
6. Click **Initialize vault**
   - Esto crea la carpeta en Google Drive y sube todos tus archivos
   - Espera a que termine
7. Listo. La sincronizacion es automatica a partir de ahora.

### Verificar que funciono

- Abre [Google Drive](https://drive.google.com)
- Deberas ver una carpeta `obsidian/` con una subcarpeta con el nombre de tu vault
- Dentro estan todos tus archivos

---

## Paso 7: Configurar Obsidian en iOS

> **Prerequisito**: Completa primero los pasos 1-5.
> Tu vault ya debe existir en Google Drive (creado desde macOS).

1. Instala Obsidian en tu iPhone/iPad desde la App Store
2. Crea un vault nuevo con **exactamente el mismo nombre** que en macOS
3. Instala el plugin (copia los archivos al vault via Files.app o similar):
   ```
   TU_VAULT/.obsidian/plugins/obsidian-gdrive-sync-redstr/
   ```
4. Abre Obsidian → **Settings** → **Community Plugins**
5. Habilita **Google Drive Sync**
6. Ve a los settings del plugin:
   - **Client ID**: pega el Client ID de tipo **Web application**
   - **Client Secret**: pega el Client Secret de tipo **Web application**
   - **Redirect page URL**: pega la URL de tu pagina de GitHub Pages
     (ejemplo: `https://tuusuario.github.io/obsidian-gdrive-redirect/`)
7. Toca **Login with Google**
   - Se abre Safari con la pantalla de consentimiento de Google
   - Selecciona tu cuenta → **Allow**
   - Safari te redirige a tu pagina de GitHub Pages
   - La pagina te redirige automaticamente a Obsidian
   - iOS pregunta "Abrir en Obsidian?" → toca **Abrir**
   - Veras "Logged in successfully!" en Obsidian
8. Toca **Initialize vault**
   - Como el vault ya existe en Drive (creado desde macOS),
     el plugin lo detecta y **descarga** todos los archivos
9. Listo. Ahora ambos dispositivos estan sincronizados.

---

## Uso diario

### Flujo normal

- Editas en macOS → se sube a Drive automaticamente (2.5 segundos de delay)
- Abres en iOS → el plugin descarga los cambios recientes
- Editas en iOS → se sube a Drive
- Abres en macOS → descarga los cambios de iOS

### Sync manual

- **Ribbon icon** (icono de refresh en la barra lateral): sincroniza ahora
- **Command palette** → "Google Drive Sync: Sync now"

### Conflictos

Si editas el **mismo archivo** en ambos dispositivos sin sincronizar entre medio:
- El plugin detecta el conflicto
- Te muestra un dialogo con opciones:
  - **Keep local**: sube tu version local a Drive
  - **Keep remote**: descarga la version de Drive
  - **Skip**: no hace nada, lo resuelves manualmente

### Eliminacion de archivos

- Si borras un archivo en un dispositivo, el plugin pregunta si quieres
  borrarlo tambien del otro lado
- Nunca se borra nada automaticamente

---

## Troubleshooting

### "Login failed" en macOS
- Verifica que el Client ID sea de tipo **Desktop app**
- Verifica que tu email este como test user en la pantalla de consentimiento

### "Login failed" en iOS
- Verifica que el Client ID sea de tipo **Web application**
- Verifica que la URL de redirect en Google Cloud coincida exactamente con
  tu URL de GitHub Pages (incluyendo el `/` final)
- Verifica que la pagina de GitHub Pages este publicada y accesible

### "No refresh_token received"
- Ve a [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
- Busca tu app ("Obsidian Sync") y revoca el acceso
- Vuelve a hacer login desde Obsidian

### Los archivos no se sincronizan
- Verifica que el vault tenga el **mismo nombre** en ambos dispositivos
- Abre settings → "Sync now" para forzar una sincronizacion
- Habilita "Enable file logging" y revisa `gdrive-sync-log.md`

### El vault se duplico en Google Drive
- Si inicializaste el vault desde ambos dispositivos por separado,
  puede haber dos carpetas. Borra la duplicada desde Google Drive.
- Solo inicializa desde **un** dispositivo. En el segundo, el plugin
  detecta el vault existente y descarga los archivos.

---

## Seguridad

### Que hace este plugin
- Se comunica **directamente** con Google (accounts.google.com y googleapis.com)
- Tus tokens **nunca** salen de tu dispositivo excepto a Google
- Usa OAuth2 con PKCE para autenticacion segura
- Usa el scope `drive.file` (solo accede a archivos creados por el plugin)
- Verifica integridad con checksums SHA-256

### Que NO hace este plugin
- No envia datos a **ningun** servidor de terceros
- No almacena tokens en la nube
- No borra archivos automaticamente
- No tiene dependencias runtime externas

### La pagina de redirect (iOS)
- Es HTML estatico que corre **en tu navegador**
- Solo lee el codigo de autorizacion de la URL y redirige a `obsidian://`
- El codigo de autorizacion por si solo es inutil sin el `code_verifier`
  PKCE que solo existe en la memoria del plugin
- Puedes auditar el codigo: son ~30 lineas de JavaScript
