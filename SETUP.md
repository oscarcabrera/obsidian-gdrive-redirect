# Obsidian Google Drive Sync — Guia de configuracion

Esta guia cubre la configuracion completa para sincronizar tu vault de Obsidian
con Google Drive, tanto en **macOS** como en **iOS**.

> **Nota sobre idioma**: Google Cloud Console traduce la interfaz segun el idioma
> de tu cuenta de Google. En esta guia cada label aparece en ambos idiomas:
> **Ingles** / **Espanol**. Si tu consola esta en espanol, busca el label despues
> de la barra `/`.

---

## Paso 1: Crear proyecto en Google Cloud (una sola vez)

Esto solo se hace una vez. El mismo proyecto sirve para todos tus dispositivos.

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Arriba a la izquierda, junto al logo de Google Cloud, hay un selector de proyecto.
   Click ahi → **New Project** / **Proyecto nuevo**
3. Nombre: `obsidian-sync` (o lo que quieras) → **Create** / **Crear**
4. Espera unos segundos a que se cree. Asegurate de que quede seleccionado
   en el selector de la parte superior

## Paso 2: Habilitar Google Drive API

1. En el menu lateral izquierdo (las tres lineas ☰):
   **APIs & Services** → **Library** /
   **APIs y servicios** → **Biblioteca**
2. En el buscador, escribe `Google Drive API`
3. Click en el resultado **Google Drive API**
4. Click en el boton azul **Enable** / **Habilitar**

## Paso 3: Configurar la pantalla de consentimiento OAuth

Esta pantalla le dice a Google como presentar tu app cuando te pida permiso
para acceder a Drive. La interfaz de Google Cloud para esto tiene varias secciones
separadas. Vamos una por una.

### 3.1 — Entrar a la configuracion

1. En el menu lateral:
   **APIs & Services** → **OAuth consent screen** /
   **APIs y servicios** → **Pantalla de consentimiento de OAuth**

2. Veras una pagina de resumen (**OAuth overview** / **Descripcion general de OAuth**)
   con varias secciones en el menu lateral izquierdo o como pestanas:
   - **Branding** / **Marca**
   - **Audience** / **Audiencia**
   - **Data access** / **Acceso a datos**
   - **Clients** / **Clientes** (a veces esta bajo Credentials)

> **Nota**: Si en vez de esto ves un wizard con pasos numerados (1. App information,
> 2. Scopes, 3. Test users, 4. Summary), es la interfaz anterior. En ese caso sigue
> las instrucciones del recuadro "Interfaz antigua" al final de este paso.

### 3.2 — Branding / Marca

1. Click en **Branding** / **Marca** en el menu lateral
2. Llena los campos obligatorios:
   - **App name** / **Nombre de la aplicacion**: `Obsidian Sync` (o lo que quieras)
   - **User support email** / **Correo electronico de asistencia del usuario**:
     selecciona tu email del dropdown
3. Baja hasta **Developer contact information** / **Datos de contacto del desarrollador**:
   - Ingresa tu email
4. Los demas campos (logo, homepage, privacy policy, terms of service) son opcionales.
   Puedes dejarlos en blanco.
5. Click en **Save** / **Guardar**

### 3.3 — Audience / Audiencia

1. Click en **Audience** / **Audiencia** en el menu lateral
2. En **User type** / **Tipo de usuario**, selecciona **External** / **Externo**
   - "Internal" solo esta disponible si tienes Google Workspace (cuenta de empresa)
   - "External" funciona con cualquier cuenta personal de Gmail
3. En la seccion **Test users** / **Usuarios de prueba**, click en
   **Add users** / **Agregar usuarios**
4. Escribe tu email de Google (el que usaras para acceder a Drive) y confirmalo
5. Click en **Save** / **Guardar**

> **Por que "test users"?** Mientras la app este en modo "Testing" / "Prueba",
> solo los emails que agregaste aqui pueden autenticarse. Como este plugin es
> para uso personal, esto es todo lo que necesitas. No es necesario "publicar"
> la app ni pasar por verificacion de Google.

### 3.4 — Data access / Acceso a datos (scopes)

1. Click en **Data access** / **Acceso a datos** en el menu lateral
2. Click en **Add or Remove Scopes** / **Agregar o quitar permisos**
3. Se abre un panel lateral. En el buscador escribe `drive.file`
4. Marca la casilla de **`../auth/drive.file`**
   (la descripcion dice algo como "See, edit, create, and delete only the specific
   Google Drive files you use with this app")
5. Click en **Update** / **Actualizar**
6. Click en **Save** / **Guardar**

> **Si no encuentras el scope**: asegurate de haber habilitado Google Drive API
> (Paso 2). Los scopes solo aparecen para APIs que estan habilitadas.

### Interfaz antigua (wizard con pasos)

Si ves un wizard con pasos numerados en vez de las secciones separadas:

1. **OAuth consent screen**: Selecciona **External** → **Create**
2. **App information**: Llena nombre (`Obsidian Sync`), email de soporte, email de contacto → **Save and Continue**
3. **Scopes**: Click **Add or Remove Scopes**, busca `drive.file`, marcalo, click **Update** → **Save and Continue**
4. **Test users**: Click **Add Users**, agrega tu email → **Save and Continue**
5. **Summary**: Revisa y click **Back to Dashboard**

---

## Paso 4: Crear credenciales OAuth

Las credenciales son las "llaves" que identifican al plugin cuando se
conecta a Google.

### Navegar a Credentials

1. Menu lateral: **APIs & Services** → **Credentials** /
   **APIs y servicios** → **Credenciales**
2. Click en **Create Credentials** / **Crear credenciales** (boton azul arriba)
3. Selecciona **OAuth client ID** / **ID de cliente de OAuth**

> **Nota**: Si Google te pide configurar la pantalla de consentimiento primero,
> es porque no completaste el Paso 3. Regresa y completalo.

### Si solo usas macOS

Crea una sola credencial:

1. **Application type** / **Tipo de aplicacion**: **Desktop app** / **App de escritorio**
2. **Name** / **Nombre**: `obsidian-mac` (o lo que quieras)
3. Click **Create** / **Crear**
4. Se muestra un dialogo con tu **Client ID** y **Client Secret**.
   **Copialos y guardalos en un lugar seguro** — los necesitaras en Obsidian.
   (Tambien puedes verlos despues en la lista de credenciales)

### Si usas macOS + iOS

Necesitas **dos credenciales** (una para cada plataforma):

**Credencial para macOS (Desktop):**
1. **Create Credentials** → **OAuth client ID**
2. Application type: **Desktop app** / **App de escritorio**
3. Nombre: `obsidian-mac`
4. **Create** → Copia y guarda el **Client ID** y **Client Secret**

**Credencial para iOS (Web):**
1. **Create Credentials** → **OAuth client ID**
2. Application type: **Web application** / **Aplicacion web**
3. Nombre: `obsidian-ios`
4. Baja hasta **Authorized redirect URIs** / **URIs de redireccionamiento autorizados**
5. Click en **Add URI** / **Agregar URI**
6. Ingresa la URL de tu pagina de redirect (la configuras en el Paso 5).
   Ejemplo: `https://tuusuario.github.io/obsidian-gdrive-redirect/`
7. **Create** → Copia y guarda el **Client ID** y **Client Secret**

> **Importante**: El Client ID de Desktop y el de Web son **diferentes**.
> Cada dispositivo usa el suyo. No los mezcles.

---

## Paso 5: Hostear la pagina de redirect (solo si usas iOS)

La pagina de redirect es un archivo HTML estatico que recibe el codigo de
autorizacion de Google y lo reenvia a Obsidian via `obsidian://`. No almacena
ni envia datos a ningun servidor — corre completamente en tu navegador.

### Opcion A: GitHub Pages (recomendado)

1. Crea un repositorio nuevo en GitHub (puede ser publico o privado)
   - Nombre: `obsidian-gdrive-redirect` (o lo que quieras)
2. Copia el archivo `redirect-page/index.html` de este plugin y subelo
   **a la raiz** del repositorio (que quede como `index.html` en el root,
   no dentro de una subcarpeta)
3. Ve a **Settings** → **Pages** del repositorio
4. En **Source**, selecciona **Deploy from a branch**
5. En **Branch**, selecciona `main` y en **Folder** selecciona `/ (root)`
   - GitHub Pages solo permite `/ (root)` o `/docs` como carpeta —
     por eso el `index.html` debe estar en la raiz del repo
6. Click **Save**
7. Espera 1-2 minutos. Tu URL sera:
   ```
   https://tuusuario.github.io/obsidian-gdrive-redirect/
   ```
8. Verifica que la pagina cargue visitandola en tu navegador
   (deberia mostrar "Missing authorization code" — eso es normal)
9. Usa esta URL en dos lugares:
   - **Authorized redirect URI** en Google Cloud (Paso 4, credencial Web)
   - **Redirect page URL** en los settings del plugin en iOS (Paso 7)

> **Importante**: La URL en Google Cloud y en el plugin deben coincidir
> **exactamente**, incluyendo `https://`, el `/` final, y sin espacios.

### Opcion B: Cualquier hosting estatico

Puedes usar Netlify, Vercel, Cloudflare Pages, o cualquier hosting que
sirva archivos HTML estaticos. Solo necesitas subir el `index.html`.
La URL final debe ser HTTPS.

---

## Paso 6: Configurar Obsidian en macOS

### 6.1 — Instalar Obsidian

- **Si aun no tienes Obsidian**: descargalo desde
  [obsidian.md](https://obsidian.md/). Abre el archivo `.dmg` descargado,
  arrastra Obsidian a la carpeta **Aplicaciones** y abrelo.
- **Si ya tienes Obsidian instalado**: simplemente abrelo.

### 6.2 — Crear o abrir tu vault

- **Si es tu primer vault**: al abrir Obsidian, click en
  **Create new vault** / **Crear nuevo vault**. Elige un nombre
  (por ejemplo `MiVault`) y una ubicacion en tu disco.
  Click **Create** / **Crear**.
- **Si ya tienes un vault**: abrelo desde el selector de vaults de Obsidian.

> **Nota**: Recuerda el nombre exacto de tu vault — lo necesitaras si
> configuras iOS despues (Paso 7).

### 6.3 — Instalar y configurar el plugin

1. Copia los archivos del plugin (`main.js`, `manifest.json`, `styles.css`)
   a tu vault en:
   ```
   TU_VAULT/.obsidian/plugins/obsidian-gdrive-sync-redstr/
   ```
2. Abre Obsidian → **Settings** → **Community Plugins**
3. Desactiva **Restricted Mode** / **Modo restringido** si esta activo
4. Busca el plugin en la lista y habilitalo con el toggle
5. Ve a los settings del plugin (icono de engranaje):
   - **Client ID**: pega el Client ID de tipo **Desktop**
   - **Client Secret**: pega el Client Secret de tipo **Desktop**
6. Click **Login with Google**
   - Se abre tu navegador con la pantalla de consentimiento de Google
   - Puede mostrar una advertencia "Google hasn't verified this app" /
     "Google no ha verificado esta aplicacion" — click en
     **Advanced** / **Avanzado** → **Go to Obsidian Sync (unsafe)** /
     **Ir a Obsidian Sync (no seguro)**
     (Esto es normal para apps en modo "Testing")
   - Selecciona tu cuenta
   - Marca la casilla del permiso de Google Drive → **Continue** / **Continuar**
   - Veras "Authorization successful" en el navegador
   - Regresa a Obsidian — deberia decir "Logged in successfully!"
7. Click **Initialize vault**
   - Esto crea la carpeta `obsidian/TU_VAULT/` en Google Drive y sube todos tus archivos
   - Veras un aviso con el progreso
   - Espera a que termine
8. Listo. La sincronizacion es automatica a partir de ahora.

### Verificar que funciono

- Abre [Google Drive](https://drive.google.com)
- Deberas ver una carpeta `obsidian/` con una subcarpeta con el nombre de tu vault
- Dentro estan todos tus archivos

---

## Paso 7: Configurar Obsidian en iOS

> **Prerequisito**: Completa primero los pasos 1-5.
> Tu vault ya debe existir en Google Drive (creado desde macOS en el paso 6).

### 7.1 — Instalar Obsidian

- **Si aun no tienes Obsidian en iOS**: descargalo desde la
  [App Store](https://apps.apple.com/app/obsidian-connected-notes/id1557175442)
  e instalalo.
- **Si ya tienes Obsidian instalado**: simplemente abrelo.

### 7.2 — Crear el vault

1. Al abrir Obsidian, toca **Create new vault** / **Crear nuevo vault**
2. Usa **exactamente el mismo nombre** que tu vault de macOS
   (por ejemplo, si en macOS se llama `MiVault`, aqui tambien debe ser `MiVault`)
3. Toca **Create** / **Crear**

> **Si ya tienes un vault con el mismo nombre**: abrelo directamente
> y continua con el paso 7.3.

### 7.3 — Instalar y configurar el plugin

1. Instala el plugin copiando los archivos al vault.
   Puedes hacerlo desde la app **Archivos** (Files.app) en iOS:
   ```
   En mi iPhone/iPad → Obsidian → TU_VAULT → .obsidian → plugins → obsidian-gdrive-sync-redstr/
   ```
   Copia ahi: `main.js`, `manifest.json`, `styles.css`

   > **Tip**: La carpeta `.obsidian` esta oculta. En Files.app, mantén
   > presionado en el fondo de la carpeta del vault y selecciona
   > "Ver opciones" para mostrar archivos ocultos. O transfiere los archivos
   > desde macOS via AirDrop/iCloud Drive.

2. Cierra y reabre Obsidian para que detecte el plugin
3. Ve a **Settings** → **Community Plugins** → habilita **Google Drive Sync**
4. Ve a los settings del plugin:
   - **Client ID**: pega el Client ID de tipo **Web application**
   - **Client Secret**: pega el Client Secret de tipo **Web application**
   - **Redirect page URL**: pega la URL de tu pagina de GitHub Pages
     (ejemplo: `https://tuusuario.github.io/obsidian-gdrive-redirect/`)
5. Toca **Login with Google**
   - Se abre Safari con la pantalla de consentimiento de Google
   - Puede mostrar la advertencia de app no verificada (igual que en macOS) —
     toca **Avanzado** → **Ir a Obsidian Sync (no seguro)**
   - Selecciona tu cuenta → Acepta los permisos
   - Safari te redirige a tu pagina de GitHub Pages
   - La pagina muestra "Redirecting to Obsidian..." y abre Obsidian automaticamente
   - Si iOS pregunta "Abrir en Obsidian?" → toca **Abrir**
   - Veras "Logged in successfully!" en Obsidian
6. Toca **Initialize vault**
   - Como el vault ya existe en Drive (creado desde macOS),
     el plugin lo detecta y **descarga** todos los archivos
   - Espera a que termine
7. Listo. Ahora ambos dispositivos estan sincronizados.

---

## Uso diario

### Flujo normal

```
macOS: editas nota.md → se sube a Drive (2.5s de delay)
                            ↓
iOS: abre Obsidian → detecta cambio remoto → descarga nota.md
iOS: editas algo → se sube a Drive
                            ↓
macOS: proximo ciclo de sync → descarga los cambios
```

### Sync manual

- **Icono de refresh** en la barra lateral: sincroniza ahora
- **Command palette** (Cmd+P en macOS) → "Google Drive Sync: Sync now"

### Conflictos

Si editas el **mismo archivo** en ambos dispositivos sin sincronizar entre medio:
- El plugin detecta el conflicto
- Te muestra un dialogo con opciones:
  - **Keep local**: tu version sube a Drive, sobrescribiendo la remota
  - **Keep remote**: se descarga la version de Drive, sobrescribiendo la local
  - **Skip**: no hace nada, lo resuelves manualmente despues

### Eliminacion de archivos

- Si borras un archivo en un dispositivo, el plugin pregunta si quieres
  borrarlo tambien del otro lado
- **Nunca** se borra nada automaticamente

---

## Troubleshooting

### "Google hasn't verified this app" al hacer login
Esto es normal. Tu app esta en modo "Testing" y solo la usan tus test users.
Click en **Advanced** / **Avanzado** → **Go to [nombre de tu app]** para continuar.

### "Login failed" en macOS
- Verifica que el Client ID sea de tipo **Desktop app**
- Verifica que tu email este como test user en la pantalla de consentimiento (Paso 3.3)
- Verifica que Google Drive API este habilitada (Paso 2)

### "Login failed" en iOS
- Verifica que el Client ID sea de tipo **Web application** (no Desktop)
- Verifica que la URL de redirect en Google Cloud (Paso 4) coincida **exactamente**
  con tu URL de GitHub Pages (incluyendo `https://` y el `/` final)
- Verifica que la pagina de GitHub Pages este publicada y accesible
  (visitala en Safari para comprobarlo)

### "No refresh_token received"
Esto pasa si ya autorizaste la app antes y Google no emite un token nuevo.
1. Ve a [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
2. Busca tu app ("Obsidian Sync" o el nombre que le pusiste)
3. Click en ella → **Remove Access** / **Quitar acceso**
4. Vuelve a hacer login desde Obsidian

### Los archivos no se sincronizan
- Verifica que el vault tenga el **mismo nombre exacto** en ambos dispositivos
- Abre settings del plugin → toca **Sync now** para forzar una sincronizacion
- Habilita **Enable file logging** y revisa el archivo `gdrive-sync-log.md`
  que aparecera en la raiz de tu vault

### El vault se duplico en Google Drive
- Si inicializaste el vault desde ambos dispositivos por separado,
  pueden haber dos carpetas con el mismo nombre. Borra la duplicada desde Google Drive.
- Solo inicializa desde **un** dispositivo. En el segundo, el plugin
  detecta el vault existente y descarga los archivos.

### No veo la carpeta `.obsidian` en iOS
- En Files.app, mantén presionado en un espacio vacio dentro de la carpeta del vault
- Selecciona **Ver opciones** / **View Options** y activa **Mostrar archivos ocultos**

---

## Seguridad

### Que hace este plugin
- Se comunica **directamente** con Google (`accounts.google.com` y `googleapis.com`)
- Tus tokens **nunca** salen de tu dispositivo excepto a Google
- Usa OAuth2 con PKCE para autenticacion segura
- Usa el scope `drive.file` (solo accede a archivos creados por el plugin)
- Verifica integridad con checksums SHA-256

### Que NO hace este plugin
- **No envia datos a ningun servidor de terceros**
- No almacena tokens en la nube
- No borra archivos automaticamente
- No tiene dependencias runtime externas

### La pagina de redirect (iOS)
- Es HTML estatico que corre **en tu navegador**
- Solo lee el codigo de autorizacion de la URL y redirige a `obsidian://`
- El codigo de autorizacion por si solo es **inutil** sin el `code_verifier`
  PKCE que solo existe en la memoria del plugin en tu dispositivo
- Puedes auditar el codigo: son ~30 lineas de JavaScript
- La hosteas **tu mismo** — nadie mas tiene acceso ni control sobre ella
