# PRD: Mis Historias NSFW (colección privada)

- Estado: plan de producto para la versión NSFW oculta
- Fecha: 2026-08-21
- Ámbito: solo colección `private` / modo privado
- Colección normal (SFW): **intacta**. No cambia motor, formatos, UI, datos ni estilo.
- Fuentes: Empty Spaces `CONTEXT.md`, `tasks/prd-empty-spaces.md`, `docs/adr/` (solo decisiones de producto)
- Runtime existente: Nuxt, SQLite, LM Studio / Chrome LLM / SwarmUI (crear assets). No se adopta Convex, workers cloud, auth federada ni hosting.
- Decisiones cerradas: legado privado en solo lectura; portadas explícitas visibles directamente únicamente dentro del Hub NSFW autenticado.

Este documento es la fuente de verdad del recorte. Si Empty Spaces y este PRD discrepan, gana este PRD. Las definiciones canónicas se copian aquí para no depender del otro repo.

---

## Resumen, problema y objetivos

Mis Historias NSFW convierte la colección privada oculta en un producto multiusuario local para crear, jugar, leer, bifurcar y compartir dentro de la instalación historias adultas generadas por IA. Conserva la aplicación SFW actual sin cambios y adopta de Empty Spaces únicamente funcionalidad, motor narrativo y lenguaje visual.

Problemas: castellano traducido o repetitivo; chats sin estructura; novelas visuales que son otra vista del chat; escenas precipitadas; pérdida de memoria, límites y agencia; assets aislados; configuración larga; re-rolls destructivos.

Objetivos:

1. Llegar al primer beat en menos de 90 segundos en el flujo rápido.
2. Ofrecer Chat, Novela Visual e Historia como contratos realmente distintos.
3. Mantener agencia, continuidad, planificación y causalidad durante historias largas.
4. Hacer nativos re-roll, rama, continuación y secuela sin destruir el original.
5. Permitir que usuarios creados por un Administrador compartan recursos dentro del Hub local.
6. Presentar la parte NSFW con un shell oscuro, cinematográfico y editorial.
7. Mantener aislamiento funcional, visual y de datos respecto a SFW.

Principios: una escena avanza una unidad; el usuario controla al protagonista salvo autorización explícita; el contenido adulto no sustituye trama ni causalidad; más calidad no significa siempre más prosa; cada alteración aceptada sincroniza estado; las operaciones destructivas aparentes son recuperables; avanzado no domina el primer contacto.

### Usuarios

- **Jugador rápido**: premisa, pocos ajustes e historia breve.
- **Jugador narrativo**: historias largas, memoria, secretos, relaciones y conflicto.
- **Aficionado a VN**: composición audiovisual, backlog, saves, auto, skip leído y elecciones.
- **Creador**: Personajes, Sprites, Lugares y Experiences reutilizables.
- **Lector/comunidad local**: descubre, guarda, sigue, comenta, valora y bifurca.
- **Administrador**: crea, edita y desactiva usuarios; administra taxonomía y visibilidad editorial. No opera infraestructura.

---

## 0. Recorte

### 0.1 Dentro

Motor narrativo, tres formatos, Studio, Biblioteca, Community Hub local, usuarios NSFW, estilo visual Empty Spaces, taxonomía adulta, Experiences, memoria, ramas, pipelines Quick/Quality adaptados a LM Studio.

### 0.2 Fuera (Empty Spaces, no se implementa)

- Nombre de producto Empty Spaces, SEO, landing, marketing, capturas públicas, emails.
- Invitaciones, atestación de edad, OAuth, Better Auth, fusión/enlace de identidades, recuperación por email.
- Licencia de plataforma, selectores de derechos, share-forward legal, cuarentena legal de derivados, Marketplace.
- Hosting, Docker, VPS, S3, SaladCloud, Convex, workers, leases, colas pull, GPU personal como worker, emergency stop de infra.
- Consola operativa de jobs/costes/observabilidad cloud, evals como gate de *release de modelo Gemma*, manifests de GGUF/Heretic.
- TTS/audiolibro real, generación visual *durante* la sesión, export Ren’Py/`.rpy`, apps nativas, DMs, feed social.
- Borrado legal GDPR como flujo de cuenta (Privacy Erasure). El archivo de Biblioteca sí entra.
- Políticas legales, age assurance, hard blocks jurídicos, Editorial Override, inspección administrativa de historias, auditoría de seguridad y distribución pública en internet. El Hub es entre usuarios autenticados de *esta* instalación local.
- Controles de seguridad u operación de Empty Spaces ajenos al login local mínimo: MFA, proveedor de identidad, kill switches, matrices de release, moderación legal y runbooks.

### 0.3 Principio de aislamiento

| | Colección normal | Colección privada (NSFW) |
|---|---|---|
| Código de player | El actual (chat lineal + `visualMode`) | Players **nuevos**, no un toggle sobre el SFW |
| Estilo | Tokens actuales (azul / dark azul) | Lenguaje visual Empty Spaces (cinemático, editorial, oscuro) |
| Auth | Ninguna | Usuarios con username/password |
| Datos | Scope `normal` | Scope `private`; no se mezclan |
| Entrada | App abierta | Sigue **oculta**; tras entrar, login NSFW |

La rutina de datos de prueba **sigue sin tocar** la colección privada.

---

## 1. Vocabulario canónico

Usar estos nombres en UI, modelo de datos y prompts. Lo de “Avoid” no se usa como sinónimo.

### 1.1 Catálogo y propiedad

**Character (Personaje)**  
Identidad adulta reutilizable: nombre por defecto, rasgos físicos/anatómicos, tendencias de personalidad, límites, preferencias, dirección de voz y media compatible. **No** impone biografía canónica. Cada Story Session crea una historia contextual y un rol dramático.  
_Avoid_: biografía fija, persona de una sola historia, Character Sprite.

**Story Characterization (Caracterización)**  
Biografía, circunstancias, objetivos, secretos, rol y setup relacional de *esa* sesión, generados o editados al entrar el Personaje en la historia.  
_Avoid_: identidad del personaje, canon inmutable.

**Character Override**  
Cambio local a la sesión (nombre, énfasis de personalidad, preferencias, límites). **Nunca** muta el Personaje fuente. Puede guardarse explícitamente como Character Clone privado.  
_Avoid_: edición de la fuente, derivado automático.

**Character Clone**  
Personaje privado reutilizable creado desde un Override, con procedencia del fuente. Seguir personalizándolo en privado. Publicarlo al Hub es un acto explícito aparte.  
_Avoid_: override de sesión, personaje fuente.

**Self-insert Profile**  
Perfil persistente privado del protagonista, reutilizable entre sesiones. Cada sesión puede añadir Caracterización encima **sin** publicar el perfil.  
Hoy: `userName` / `protagonistPreferences` privados. Pasa a entidad de perfil.

**Relationship Hook**  
Sugerencia opcional en un Personaje o Experience. La sesión puede sustituirla por la relación que mejor sirva, salvo que el usuario **preserve** relaciones elegidas.  
_Avoid_: relación canónica, estado actual de relación.

**Experience Slot**  
Rol tipado en una Experience: fijo, reemplazable con restricciones, opcional, o aportado por el jugador. Guarda función narrativa, defaults, compatibilidad y si hay que preservar relaciones.  
_Avoid_: referencia hard-codeada a un personaje, placeholder de prompt.

**Adult Content Profile**  
Hasta **5 Primary Interests**, cualquier número de **Exclusions**, y el resto de la taxonomía aprobada como **Contextual Interests**. Los principales deben **recurrir y enfatizarse** sin ser hegemónicos ni forzarse juntos en la misma escena. Exclusions **nunca** aparecen. Contextuales solo si narrativamente encajan.  
_Avoid_: un solo fetiche, acto combinado obligatorio, lista de prompt sin estructura.

**Taxonomy Proposal**  
Término creado por un usuario. Usable en privado de inmediato. Queda pendiente de revisión silenciosa del Administrador. Aprobado → taxonomía compartida del Hub. Rechazado → lista Discarded (no se vuelve a ofrecer; el Admin puede promoverlo después).  
_Avoid_: tag público inmediato, ticket de moderación visible al usuario.

**Community Catalog**  
Colección compartida **dentro de esta instalación NSFW** donde se publican assets para que otros usuarios locales los añadan y reutilicen.  
_Avoid_: Marketplace, tienda, internet público.

**Community Hub**  
Descubrimiento principal: Stories, Experiences, Characters y Places publicados, con búsqueda, tabs por tipo, colecciones, tendencias y recientes. Sustituye un “Explorar” genérico.  
_Avoid_: dataset crudo, feed social, Marketplace.

**Library**  
Colección versionada de un usuario: editorial/comunitario/privado, sesiones en curso y terminadas, Published Stories guardadas. Las cards de historia también pueden aparecer en Inicio.  
_Avoid_: Catalog, “mis archivos”, Marketplace.

**Marketplace**  
Fuera de alcance.  
_Avoid_: Community Catalog.

**Derivative (genealogía de producto)**  
Recurso publicado que incorpora o parte de publicaciones previas y añade contribución nueva. Se guarda procedencia de fuentes y versiones **como dato de producto**, sin licencia legal ni share-forward jurídico.  
_Avoid_: copia, original independiente, licencia.

### 1.2 Identidad NSFW (adaptada)

**User Account**  
Registro durable en SQLite (solo scope privado). Lo crea un Administrador con **username + password**. El usuario no se auto-registra.  
_Avoid_: OAuth, email, una cuenta por método de login.

**Administrator**  
Rol que crea, edita y desactiva usuarios, y opera taxonomía, Hub y reportes de la instalación. Se autentica con el mismo flujo username/password. Autorización por **id inmutable** de usuario, no por comparar el username en el cliente.  
_Avoid_: email hardcodeado, login admin distinto, comprobación de username en el frontend como única defensa.

**Public Creator Identity**  
Username (el que otorga el Admin) y avatar elegido en el producto para atribución en el Hub. El avatar **no** se copia de datos de sistema. Cambiar password no cambia la identidad pública.  
_Avoid_: email, nombre real, SSO.

**Private Story Notice**  
Texto compacto en toda Story Session privada: «Esta historia es privada: no es visible para otros usuarios y no se publicará sin tu autorización.»  
_Avoid_: “nadie puede acceder”, cifrado extremo a extremo.

### 1.3 Narrativa

**Narrative Format**  
Contrato inmutable al crear la sesión: **Chat**, **Visual Novel** o **Story**. Densidad de diálogo/narración, longitud de turno, pacing, cues de assets y comportamiento de UI forman parte del formato. **No** es un tema visual sobre la misma prosa.  
_Avoid_: mode, theme, view.

Contratos iniciales:

- **Chat**: turnos más cortos, máxima densidad de diálogo, un avatar por intervención, narrador conciso. 40–150 palabras orientativas por beat.
- **Visual Novel**: unidades dramáticas dominadas por diálogo, acciones cortas, cues explícitos de expresión, composición y sonido. 60–220 palabras, divididas en unidades de pantalla.
- **Story**: prosa continua, más descripción e interioridad, con diálogo sustancial que avanza hechos (no exposiciones largas). 200–600 palabras orientativas por beat.

El formato **no se cambia** dentro de la sesión/rama. El `visualMode` boolean del SFW **no existe** aquí.

**Erotic Escalation Control**  
Acción contextual que pide al motor una escena adulta inmediata o cercana, coherente con consentimiento/perfil, personajes, lugar, pacing y continuidad. Las opciones se adaptan a la escena; no copian un template.  
Control inicial: icono de **corazón en llamas** junto al compositor. Tras usarlo, desaparece o se deshabilita hasta que ocurre la escena; el texto deshabilitado indica que la escena se acerca.  
_Avoid_: acto instantáneo garantizado, escena calcada, override incontrolado del plan.

**Generation Profile**  
Estrategia de calidad/latencia de la *siguiente* generación, cambiable sin cambiar la verdad narrativa:

- **Quick**: una llamada principal a LM Studio (plan breve dentro del envelope) + validación determinista.
- **Quality**: planner → writer → critic/revision → extracción/validación de estado. Usa el mismo runtime local y puede elegir otro modelo configurado en LM Studio, más contexto o más pases. Los pases extra no reescriben la prosa final salvo el revisionista explícito. Modelos/reglas de utilidad no escriben literatura.

Ambos leen y actualizan el mismo Story Plan y World State.

**Narrative Model Selection**  
Modelo narrativo elegido independientemente del Narrative Format y del Generation Profile. Puede seleccionarse al crear la historia y cambiarse para la siguiente generación sin alterar la verdad ya aceptada. Cada Generation Attempt registra modelo, identificador real de LM Studio y configuración usada.

Modelos iniciales que la aplicación debe permitir configurar, seleccionar y comparar:

1. **Gemma-4-26B-A4B StyleTune V2 + Heretic**
2. **Gemma-4-31B StyleTune Heretic ARA**
3. **G4-Dark-Soul-26B-A4B**

El nombre mostrado es un alias de producto configurable y se enlaza al identificador que exponga LM Studio. Un modelo no disponible aparece como no disponible y no se sustituye silenciosamente. Re-roll puede elegir otro modelo y producir una alternativa desde el mismo estado padre para comparar resultados de forma justa.

**Interaction Policy**  
Cuándo se pausa para el usuario (cambiable si el formato lo admite):

- **Pause**: Hablar, Actuar o pedir que elija la IA.
- **Lite Choices**: opciones de intención contextual + input libre.
- **Automatic Checkpoints**: avanza sin pausa hasta checkpoint, decisión, fin de arco, final, bloqueo, error o pausa manual.
- **Non-interactive**: narración planificada, con pausa y continuación.

Los modos SFW `continue` / `auto` se absorben aquí (continue ≈ Pause sin diálogo de protagonista; auto ≈ Automatic o Non-interactive según se elija).

**Interaction Composer**  
Superficie del formato para dirigir el siguiente beat. Distingue Speak y Act, mezcla sugerencias e input libre, y trata las acciones con prominencia distinta.  
- Story: texto abierto y acciones amplias.  
- Visual Novel: varias respuestas sugeridas en primer plano + respuesta abierta.  
- Chat: turnos conversacionales.  
_Avoid_: lista uniforme de botones, format, command bar fija.

**Suggested Interaction**  
Opción Speak o Act generada, con intención semántica, prominencia y estilo visual opcional. Es conveniencia, no el conjunto legal completo; nunca elimina el input libre donde el formato lo permite.  
_Avoid_: script de ramas fijas, botones de igual peso.

**Visual Novel Layout**  
Composición **landscape** en desktop, tablet y móvil para el formato VN. El resto de superficies móviles NSFW usan **portrait** art-directed. No se estira un único layout.  
_Avoid_: portrait estirado, reader genérico.

**Story Plan**  
Estructura mutable a futuro, compartida por Quick y Quality. Las interacciones aceptadas pueden revisar beats futuros **sin** reescribir historia aceptada.  
_Avoid_: guion fijo, transcripción.

**Story Bible**  
Registro versionado y corregible de verdad establecida: personajes, relaciones, lugares, objetos, eventos, estado físico/emocional. Superficie secundaria discreta. Secretos que el protagonista no conoce permanecen ocultos al usuario ordinario; el Administrador puede revelarlos con un toggle **explícito**.  
_Avoid_: Story Plan, transcript crudo, panel debug siempre visible.

**Director View**  
Editor opcional del Story Plan. Debe decir que el plan es **una posibilidad**, no un guion prometido. Acciones y generaciones aceptadas pueden revisarlo.

**Re-roll Alternative**  
Candidato no destructivo desde el mismo estado padre. No aporta estado hasta seleccionarse. El usuario puede descartarlo.  
_Avoid_: retry que pisa, nuevo paso de historia.

**Story Branch**  
Nueva sesión/rama privada desde un beat aceptado, con snapshot de estado y ancestría. La fuente no cambia.  
_Avoid_: rewind, copy-paste, re-roll.

**Experience**  
Plantilla rejugable: premisa, slots, variables, reglas, Adult Content Profile, semillas de plan, posibles condiciones de cierre.  
_Avoid_: Story Session, transcript publicado, tag de fetiche.

**Story Session**  
Ejecución privada de una Experience o setup custom: beats aceptados, alternativas, plan mutable, Bible, World State, pins exactos de versión de assets.  
_Avoid_: Experience, Published Story.

**Published Story**  
Snapshot inmutable y legible de un camino aceptado. No hay historial de versiones visible: retirar lo quita del Hub; republicar crea un snapshot interno nuevo. Puede sembrar una rama privada sin volver mutable lo publicado.  
**Serial Story**: Episodios públicos inmutables que extienden la obra sin mutar episodios previos; se puede ramificar desde cualquier beat publicado.

**Comment**  
Respuesta pública a un listing del Hub. Puede ocultarse editorialmente por el Administrador. No forma parte de la narrativa ni de la genealogía de assets.  
_Avoid_: Quality Feedback, mensaje privado, beat.

**Native Share**  
En local: copiar ruta canónica interna del recurso publicado, o share sheet del OS si existe. Las sesiones privadas **nunca** generan URL resoluble para otros.  
_Avoid_: publicar, invitar colaborador, feed.

**Runtime Visual Asset**  
Imagen generada *durante* el play. **Fuera de alcance.** SwarmUI sigue para crear sprites/fondos en Studio, no para componer la escena on-the-fly.  
_Avoid_: asset de catálogo.

**Character Sprite**  
Visual Asset versionado, fondo transparente, **exactamente un** Personaje. Es la apariencia completa de ese momento: forma, cuerpo, validación aparente-adulto, peinado, ropa, pose, expresión, acción, encuadre, orientación, explicitud. Escenas multi-personaje = composición en cliente de sprites sueltos sobre un fondo. **No** hay entidad Appearance intermedia ni asset precompuesto de grupo.  
_Avoid_: composición de grupo, fondo, identidad del personaje.

**Scene CG**  
Imagen de escena completa, precatalogada y versionada para momentos especiales de Novela Visual. No sustituye la composición normal de Place + Sprites y nunca se genera durante el play. Su aparición alimenta la galería.

**Place (Lugar)**  
Localización reutilizable del tamaño de una escena, con descripción y **un** fondo versionado. Habitaciones, exteriores, mazmorras, etc. son Places distintos. **No** hay Zone ni grafo de navegación.  
_Avoid_: Zone, nodo de mapa, lugar multi-fondo.

**Setting / Era**  
Ambientación general y periodo. Contexto de Places, no un mapa.

**Narrative Beat**  
Unidad aceptada de avance. La longitud visible depende del formato. Los presets de duración hablan de rangos de beats y tiempo estimado, no de un recuento de palabras universal.  
_Avoid_: llamada al modelo, párrafo, cuota fija.

**Generation Envelope**  
Resultado estructurado validado de una generación: unidades visibles, atribución de diálogo, Speech Annotations, cues visuales y de sonido, choices contextuales, delta de World State, patch de Story Plan. El stream es **provisional** hasta que el envelope completo pasa validación y se acepta.  
_Avoid_: blob de prosa, stream parcial aceptado.

**Generation Attempt**  
Propuesta provisional del siguiente beat. Varios intentos hermanos pueden existir (re-roll). Solo el aceptado cambia estado.

**Accepted Beat**  
Intento elegido que altera World State / Bible / Plan.

**Edited Beat**  
Beat aceptado cuya prosa el usuario ha editado. Edición estilística conserva el snapshot. Edición factual exige sincronizar Bible y World State antes de publicar o ramificar.

**Speech Annotation**  
Metadatos de prosodia **no visibles**: speaker, emoción, intensidad, ritmo, pausas, énfasis, pronunciación. Nunca se pintan en el reader. Preparan TTS futuro; no hay audio generado ahora. Voces futuras: sintéticas ficticias, nunca clones de personas reales.  
_Avoid_: markup visible, audio generado, voz clonada.

**Audio Affordance**  
Acciones visibles pero no disponibles: «Escuchar escena» y «Crear audiolibro», con «Próximamente». Discretas, no simulan generación.

**VN Save**  
Punto de reanudación asociado a un Accepted Beat. El autosave mantiene el último beat aceptado; los saves manuales permiten nombrar puntos adicionales. Nunca incluyen chunks provisionales.

### 1.4 Operación de producto (local)

**Progressive Editor**  
Creación corta, muy sugerida, para llegar rápido a jugar. Defaults preseleccionados o sugeridos por IA. Avanzado en disclosure. Preview de cambios generados antes de aplicar.

**Library Removal**  
Oculta de la Biblioteca activa, retención indefinida, restaurable. No es borrado.

**Feedback Entry Point**  
Acción persistente en superficies autenticadas NSFW: reportar bug o proponer mejora. Incluye ruta y contexto técnico si el usuario lo permite; el texto lo controla el usuario.

**Quality Feedback**  
Rating opcional de una generación, checkpoint o historia terminada. En play: acción discreta, no modal. Al completar: encuesta más amplia. No bloquea la sesión. Un rating no implica consentimiento de entrenamiento.

**Generation Usage Record**  
Registro inmutable por intento: perfil Quick/Quality, modelo, tokens (input visible, contexto/instrucciones, planificación, output, revisión/validación), latencia, resultado. Visible por intento, paso, historia y cuenta. Re-rolls, fallos y descartes conservan registro. La app es local/gratuita: se muestra coste estimado si hay tarifa configurada, o “sin cobro”.

**Stop reason**  
El envelope declara por qué paró: intervención natural, checkpoint, final, bloqueo, error.

---

## 2. Estilo visual (Empty Spaces, solo NSFW)

Lenguaje **oscuro, cinemático, editorial**: premium, legible, discreto.

- Shell global (nav, Inicio, Hub, Biblioteca, Studio, perfil, admin): **un** sistema. No skin anime de plataforma. No estética de sitio pornográfico en el chrome.
- Imagen explícita: solo en regiones de contenido controladas (player, fichas autenticadas, Studio), **nunca** en navegación permanente.
- El player **puede** tomar acentos, atmósfera y tratamiento de escena de la Experience actual; controles y a11y permanecen familiares.
- Tokens actuales `.private-scope` (rosa) se **reemplazan** por la paleta editorial oscura. La colección normal no usa estos tokens.
- Un sistema de primitives/tokens; no un design system distinto por formato.
- Contraste WCAG AA en texto y controles; foco visible; teclado; `prefers-reduced-motion`; alt text útil (en Hub, no spoilers explícitos en listados si se puede evitar).
- Móvil genérico: portrait. VN: landscape recomendado + aviso de rotación + fallback portrait usable.
- Tipografía y ritmo de lectura pensados para prosa larga (Story) y caja de diálogo (VN/Chat), no para cards de chat SFW reutilizadas.

---

## 3. Usuarios y administración

Solo scope privado. SFW sigue sin cuentas.

### 3.1 Flujo

1. El modo privado sigue **oculto** (el mismo patrón actual de trigger).
2. Si no hay ningún usuario: primer arranque NSFW pide crear el **Administrador** (username + password). Eso es el bootstrap; después el id de ese usuario queda como admin.
3. Si hay usuarios: pantalla de login username/password.
4. Usuario desactivado: no entra; mensaje genérico de credenciales inválidas (no revelar si el user existe).
5. Logout vuelve a la pantalla de login NSFW, no a la colección normal. Salir del modo privado (control actual) cierra sesión NSFW y vuelve a SFW.

### 3.2 Administrador

Puede:

- Crear usuario: username único, password inicial, rol (`user` | `admin`), activo.
- Editar: username, reset de password, rol, avatar/display si aplica.
- Desactivar / reactivar. No hay borrado físico de cuenta en este recorte (evita huérfanos). Los contenidos del usuario desactivado permanecen; no son jugables por él.
- Listar usuarios y estado (activo, último acceso).
- Gestionar taxonomía, propuestas y Discarded.
- Ver bugs y sugerencias del producto.
- Ocultar o restaurar listings del Hub por motivos editoriales. **Sin** moderación legal, auditoría ni cuarentena.

No hay: invitaciones, email, OAuth, MFA, atestación de edad, inspección de historias privadas, revelación administrativa de secretos, consola de workers ni emergency stop.

### 3.3 Autorización de datos

- Cada Story Session, draft de Studio y Library Entry tiene `ownerUserId`.
- El Hub muestra Publications visibles a todos los usuarios NSFW de la instalación.
- Un usuario no lee sesiones ni drafts de otro.

Password: hash en servidor (nunca texto plano, nunca al cliente). Sesión por cookie/token httpOnly local. Esto es auth de producto, no el paquete de “controles de seguridad” de Empty Spaces (age, hosting eligibility, IDOR matrix cloud, etc.).

---

## 4. Arquitectura de información NSFW

### 4.1 Nav escritorio

Inicio · Community Hub · Crear historia · Biblioteca · Avatar/perfil  
Admin (solo rol admin).

### 4.2 Nav móvil

Barra inferior: Inicio · Comunidad · Crear · Biblioteca.  
Perfil/ajustes/admin desde el avatar.

### 4.3 Inicio

- Continuar historia como CTA principal.
- Recientes.
- Experiences y recursos recomendados.
- Novedades de producto (si hay).
- Sin feed social.

### 4.4 Biblioteca

Secciones: En curso · Terminadas · Guardadas · Experiences · Personajes · Lugares · Colecciones · Archivados.  
Filtros: formato, estado, privacidad (privado vs publicado), origen (creado / añadido / derivado / guardado), tags, creador, fecha, favorito.

Acciones: Quitar = archivar reversible; Restaurar. Borrar dato de Library no es erasure legal.

### 4.5 Studio (pestañas)

Personajes · Lugares · Experiences · Publicaciones · Media.  
Cada editor: draft, preview, validación, publicar. Sin selector de licencia.

### 4.6 Community Hub

Tabs: Experiences, Historias (y Series), Personajes, Lugares, Creadores, Colecciones.  
Búsqueda, facetas, ranking local, novedades, colecciones editoriales del Administrador y colecciones de usuarios. La ficha de un creador muestra sus historias y recursos. Sin DMs, muros ni feed.

El Hub solo existe tras entrar en la parte oculta y autenticarse. Dentro de ese límite, las portadas explícitas se muestran directamente, sin blur ni censura. Ninguna portada o metadato NSFW aparece en el shell SFW, login o rutas no autenticadas.

### 4.7 Ficha de catálogo

Portada; pitch sin spoilers; creador; tags; rating; procedencia de producto; compatibilidad; estado; CTA Play / Read / Branch / Add según tipo; comentarios cuando aplique.

### 4.8 Perfil

Identidad pública (username, avatar); preferencias narrativas y de UI; Self-insert; uso de tokens; bugs/sugerencias; cambio de password (el Admin también puede resetear).  
Sin email, SSO ni export GDPR.

### 4.9 Consola admin (producto)

Usuarios · Taxonomía/Discarded · Publicaciones/ocultar · Bugs/sugerencias · Generaciones (intentos, modelo, perfil, latencia y resultado, sin prosa privada) · (opcional) uso agregado.  
Sin: jobs, workers, costes GPU, evals Gemma, emergency stop, invitaciones.

---

## 5. Modelo conceptual

- Character: identidad y defaults; sin bio canónica.
- Character Sprite: una imagen, un personaje, transparente, tags completos del momento.
- Story Characterization: por sesión.
- Character Clone: copia privada explícita.
- Setting / Era: contexto de Places.
- Place: escena + un fondo.
- Experience: plantilla con slots, perfil adulto, plan seeds, finales.
- Story Session / Story Branch / Generation Attempt / Accepted Beat.
- Published Story / Serial Story (episodios inmutables).
- Story Bible / Story Plan / World State.
- Generation Envelope.
- Library Entry: referencia de posesión, no duplicado físico del asset publicado.
- Publication: snapshot inmutable interno; retirar y republicar = nuevo snapshot; sin historial visible.

Invariantes:

- Una generación activa por rama; sesiones distintas pueden generar en paralelo.
- Resultado stale (input/revisión viejos) **nunca** se acepta.
- Fork no muta el original y comparte ancestros sin duplicar prosa innecesariamente.
- Head de rama solo avanza con envelope válido aceptado.

---

## 6. Configuración narrativa

### 6.1 Formato — Chat (se reconstruye)

No reutilizar `MessageBubble` / historial SFW como implementación.

Escritura:

- Intervenciones breves; máxima densidad de diálogo.
- Narrador conciso; no párrafos de novela.
- 40–150 palabras castellanas por beat; parar antes en un punto natural de intervención.
- Cada intervención de personaje lleva **avatar/sprite** válido.
- Diálogo atribuido a `actorId` del envelope; el UI no parsea `Nombre [tag]:` como verdad.

UI:

- Columna de turnos conversacionales, avatar por intervención, narración secundaria.
- Compositor: input corto, acciones rápidas Speak/Act, sugerencias ligeras, corazón de escalada.
- Historial y controles secundarios (Bible, Director, usage, backlog ligero) siempre accesibles sin tapar el hilo.
- Portrait en móvil.
- Streaming provisional; stop deja texto copiable **no aceptado**.

### 6.2 Formato — Novela Visual (se reconstruye)

No es `visualMode` encima del chat. Es un player nuevo, web-native inspirado en Ren’Py, **sin** ejecutar ni exportar `.rpy`.

Escritura:

- Diálogo dominante; acción/narración en bloques cortos.
- 60–220 palabras por beat, en **unidades de pantalla**.
- Cues explícitos: expresión, composición (slots izq/centro/der), sonido.

Renderer (capas, estado visual derivado del envelope, no canónico):

1. Fondo del Place  
2. Overlay/ambiente opcional  
3. Sprites individuales transparentes por slots y profundidad  
4. Transition layer  
5. Caja de diálogo + nombre  
6. Choices / controles  

Selección de sprite: `spriteQuery` (required / preferred / excluded). Determinista.

1. Nunca viola excluded ni personaje.  
2. Relaja preferred por pesos.  
3. Fallback neutral.  
4. **No inventa** asset.

Facetas de tag del Sprite: forma/cuerpo, framing (cara/busto/cuerpo), ropa, pose, expresión, acción, dirección/mirada, explicitud, compatibilidad de escena. Cada sprite declara el conjunto **completo** aplicable a ese momento.

UI obligatoria:

- Backlog siempre accesible; usa **Accepted Beats**, nunca chunks provisionales.
- Autosave en cada Accepted Beat y saves manuales nombrados; reanudar nunca restaura texto provisional.
- Auto: espera según longitud, puntuación y preferencia.
- Skip: **solo** texto ya leído por el usuario en esa rama. Cambio de rama: lo nuevo no está leído; ancestros sí.
- Velocidad de texto, transiciones, volumen, fullscreen, accesibilidad.
- Teclado, touch y controles visibles.
- Landscape prioritario en móvil + aviso de rotar; portrait fallback funcional.
- Checkpoints y elecciones integradas en la caja, no un chat aparte.
- Galería de CG/assets **ya vistos** en la sesión/rama.
- Reduced motion: transiciones por opacity/transform atenuadas.

Fuera: voz, lip-sync, gen visual on-the-fly, export .rpy.

### 6.3 Formato — Historia (Story)

- Más prosa, interioridad y descripción.
- Diálogo sustancial para avanzar la trama (no solo exponer).
- 200–600 palabras orientativas; parar en decisión natural.
- Compositor: input amplio, Speak/Act, sugerencias secundarias, escalada.
- Tipografía de lectura larga; no burbujas de chat.

### 6.4 Perfil de generación

Quick y Quality, intercambiables, misma Bible/estado/plan. Ver §1.3 y §8.

### 6.5 Perspectiva

- Primera persona dirigida al usuario/protagonista.
- Tercera interactiva: el usuario decide por el protagonista.
- Tercera narrativa sin interacción (encaja con Non-interactive).

### 6.6 Tono

Romántico/erótico · Neutral (equilibrio) · Hardcore (explícito, directo, no vulgar de forma gratuita).  
Ajusta vocabulario, distancia, explicitud, figuras, interioridad y diálogo. No es un slider de “intensidad”.

### 6.7 Duración experimental (mostrar como expectativa)

| Preset | Beats | Notas |
|---|---|---|
| Encuentro rápido | 12–20 | Intro breve, escalada rápida; ~mitad de beats en la escena adulta central |
| Corta | 30–60 | |
| Media | 80–160 | |
| Larga | 180–350 | |
| Abierta | — | |

Ajustable tras uso real.

### 6.8 Taxonomía (facetas independientes)

Género · Ambientación · Premisa/trope · Contenido adulto · Dinámica relacional · Tono · Pacing/cadencia.

### 6.9 Adult Content Profile

Como en §1.1. Términos privados → Taxonomy Proposal silenciosa. Discarded no se reofrece.

### 6.10 Matriz de Interaction Policy

| Formato | Pause | Lite Choices | Automatic Checkpoints | Non-interactive |
|---|---:|---:|---:|---:|
| Chat | Sí | Sí | Sí | No |
| Visual Novel | Sí | Sí | Sí | Sí |
| Story | Sí | Sí | Sí | Sí |

La política puede cambiarse durante la sesión entre las opciones compatibles. El formato sigue siendo inmutable. En Automatic Checkpoints siempre existen Pausa manual, error recuperable, final, decisión crítica y fin de arco como condiciones de parada.

---

## 7. Flujos

### 7.1 Crear historia (3 pasos, Progressive Editor)

1. Experience o «Desde cero».  
2. Protagonista (Self-insert o slot de jugador), reparto, Adult Content Profile.  
3. Duración, formato (inmutable), perspectiva, tono, política de interacción, perfil Quick/Quality inicial → Iniciar.

En el paso 3 también se elige el modelo narrativo inicial entre los modelos configurados y disponibles.

Máximo razonable preseleccionado. Avanzado en disclosure. Antes de play: generar Caracterización, contexto, Story Plan y **resumen sin spoilers** (inspeccionable). Se puede descartar el plan sugerido y editar el Director View (posibilidad mutable).

También: época preconstruida o propia; cambiar nombres en la historia; personalidad/preferencias o delegar en la IA; bloquear relaciones a preservar (si no, la historia inventa las que convengan).

### 7.2 Interactuar

Compositor según formato (§6). Corazón en llamas según §1.3. Speak / Act / «elige la IA». Sugerencias de prominencia distinta + input libre.

El prefijo tipo «IA:» en el texto **no** cambia el system prompt; los comandos de producto van por controles tipados.

### 7.3 Aceptar, re-roll, editar, fallar

- Stream provisional. Aceptación solo con envelope válido.
- Re-roll: intento hermano; originales navegables; cada uno con usage propio; solo el elegido acepta; hojas descartables.
- Editar prosa: revisión; si es factual, proponer y confirmar sync de Bible/estado.
- Fallo: elimina provisional, **no** altera estado, reintenta **una** vez. Luego: Retry, cambiar a Quick, editar instrucción, Report.
- Stop streaming: copiable, no aceptado.

### 7.4 Bifurcar

Desde cualquier beat aceptado: «Crear otra versión». Rama con ancestros compartidos, nombre/fecha; original intacto. Se puede alterar acción, reparto, plan o perfil permitido y seguir.

### 7.5 Terminar

Finalizar · Seguir libremente · Crear secuela.  
Automático puede llegar a un final. Secuela = nueva sesión ligada, contexto propio. Continuar no borra el final registrado.

### 7.6 Publicar (Hub local, sin licencia)

1. El dueño elige recurso o snapshot.  
2. Ve qué se compartirá (metadatos, tags, extracto). **Sin** contrato de licencia.  
3. Autoriza explícitamente.  
4. Validación **estructural** (schema, tags, cobertura de assets, Characterización no filtrada si debe ser privada).  
5. Si valida, queda visible automáticamente en el Hub, sin cola manual.  
6. Retirada voluntaria: no se puede Add de nuevo; copias/derivados ya en Libraries ajenas no se rompen.  
7. Republicar = nuevo snapshot interno; no hay UI de historial de versiones.  
8. Series: episodios inmutables que extienden sin mutar lo anterior.

### 7.7 Archivar

Quitar de Biblioteca = archivo reversible. Restaurar. Distinto de borrar cuenta (no hay erasure GDPR).

---

## 8. Motor

### 8.1 Contrato editorial (castellano de España)

Escribir **directamente** en castellano de España (no pipeline de traducción). El texto debe:

- adaptar vocabulario, longitud, diálogo y elaboración al formato;
- construir deseo con situación, expectativa, reacción, sentidos, subtexto y agencia;
- personajes diferenciados y relaciones causalmente creíbles;
- equilibrar claridad y evocación;
- evitar clichés, eufemismos repetidos, metáforas involuntariamente cómicas, sinónimos forzados;
- no resumir lo que debe dramatizarse;
- no usar párrafos largos cuando el formato pide intercambio (Chat/VN);
- no confundir explicitud con rudeza;
- no añadir moralejas, disculpas ni comentarios del modelo;
- no copiar frases/estructuras distintivas de fuentes de inspiración.

Reglas de agencia y pacing:

- No decidir acciones, pensamientos o elecciones del protagonista controlado por el usuario (salvo política que lo permita: Auto / Non-interactive / «elige la IA»).
- No precipitar relación o escena solo porque el contenido adulto esté permitido.
- Mantener objetivo, tono y cadencia de la escena.
- Adulto = central y recurrente, respetando la progresión elegida (duración, tono, corazón).
- Una escena avanza **una** unidad; no resuelve el arco de golpe.
- “Más calidad” no es siempre más prosa.

### 8.2 Generation Envelope (JSON validado)

Sustituye el protocolo de líneas y corchetes como **verdad**. El parser SFW no se reutiliza como fuente de estado.

Campos (schemaVersion 1):

- `language`: `es-ES`
- `format`: `chat` | `visual_novel` | `story`
- `visibleUnits[]`: `narration` | `dialogue` (dialogue lleva `actorId`, `text`, `spriteQuery?`, `speech?`)
- `soundCues[]`: `assetId` + índice de unidad
- `visualCues[]`: composición de Place/Sprites o `sceneCgAssetId` precatalogado
- `choices[]`: Suggested Interactions
- `stateDelta[]` / `planPatch[]`: operaciones tipadas, no prosa
- `stopReason`

Reglas:

- `actorId`, `assetId` y `sceneCgAssetId` deben existir en el bundle permitido.
- `spriteQuery` selecciona tags, no las inventa.
- `speech` no se renderiza.
- `visibleUnits` como texto escapado; no HTML ejecutable.
- No persistir chain-of-thought. Plan/crítica = artefactos operativos breves.
- La UI **nunca** interpreta texto libre como comando o ID.

Streaming: confirmar input de inmediato; chunks provisionales ~100–250 ms o unidad semántica.

Máquina de intento (adaptada, sin cola cloud):  
`requested → streaming → validating → ready → accepted`  
Terminales: `failed | cancelled | stale | discarded`.

### 8.3 Bundle y contexto

No se manda el chat entero indefinido. Bundle:

- escena actual;
- presentes y Characterizations;
- relaciones y estados;
- hechos de Bible por entidad, recencia e importancia;
- secretos solo si el narrador debe conocerlos;
- resumen por arcos;
- 8–20 intercambios recientes dentro de presupuesto;
- plan próximo (no todo el plan);
- assets compatibles.

Truncado **nunca** quita: exclusions, presentes, escena actual, acción del usuario.

Precedencia de prompt:

1. Schema del envelope  
2. Contrato del formato  
3. Agencia y stopping  
4. Skills editoriales versionadas  
5. Experience y preferencias de sesión  
6. Escena y plan relevante  
7. Bible seleccionada  
8. Resumen  
9. Contexto reciente  
10. Acción del usuario  

El usuario cambia la ficción, no el schema.

Presupuesto de contexto: usar `historyBudget` existente como tope; reparo orientativo 10% schema / 15% format-skills / 25% state-bible-plan / 15% resumen / 25% reciente / 10% margen. Ajustar a LM Studio real.

### 8.4 Quick vs Quality (LM Studio)

**Quick:** una llamada; plan breve *dentro* del envelope; validación determinista; si delta inválido, retry corto o fallo.

**Quality:** usa el mismo runtime local y puede emplear otro modelo configurado, más contexto o más pases sin crear otra verdad narrativa.

1. Planner: beat intent, checklist de continuidad, stop target  
2. Writer: envelope  
3. Critic: puntúa los seis grupos del §12 y lista fixes  
4. Revision: reescribe solo si no cumple umbrales  
5. Extractor/validator: estado, IDs, constraints  

Utilidad/reglas: clasificar, recuperar, elegir assets, validar. **No** reescriben prosa final.

Quick/Quality y modelo son ejes independientes: cualquier modelo compatible puede ejecutar ambos perfiles. El selector cambia el modelo del siguiente intento, nunca el de beats aceptados. La comparación entre modelos crea intentos hermanos con el mismo parent beat, input, Bible, Plan, World State y pins de assets.

### 8.5 Skills versionadas (registradas por generación)

Voz de España · Diálogo y subtexto · Escena y causalidad · Personaje y relación · Pacing interactivo · Sensualidad · Explicitud · Continuidad · Control de agencia · Anticliché y variedad · Contrato Chat · Contrato Novela Visual · Contrato Historia · Anotación de voz · Final, continuación y secuela.

Cada skill: id, versión, propósito, formatos compatibles, texto, incompatibilidades, changelog. El PromptBundle de la sesión fija versiones.

### 8.6 Memoria

World State, Bible versionada (procedencia de cada hecho), resumen, contexto reciente, estado de escena: **separados**.  
Detectar contradicciones y permitir corregir el hecho canónico.  
Nueva caracterización por historia; Clone explícito desde override.

Director View opcional, sin spoilers extra sin gesto del usuario.

---

## 9. Assets y Studio

- Character: identidad estable, sin bio canónica.
- Sprite: un personaje, transparente, tags completos; preview avisa tags faltantes/incompatibles.
- Scene CG: escena completa precatalogada, versionada, con preview y compatibilidad; nunca runtime.
- Place: una escena, un fondo versionado; Setting/Era seleccionables o creables; sin Zone.
- Experience: premisa, slots, variables, reglas, perfil adulto, plan seeds, finales; preview de cobertura de sprites/fondos.
- Media: metadatos en SQLite, binarios como ahora (filesystem/SQLite blobs). SwarmUI solo en Studio.
- Draft / preview / validar / publicar. Recursos privados no publicados.
- Durante play: **solo** assets existentes de la sesión (pins de versión).

Sonidos actuales se mapean a `soundCues` del envelope.

---

## 10. Biblioteca, Hub, feedback

- Add a Biblioteca = referencia + versión/procedencia de producto.
- Follow de creadores (username de esta instalación).
- Colecciones de usuario.
- Comentarios: texto, con ocultación editorial posterior por el Administrador.
- Ratings 1–5 con dimensiones escritura, personajes, pacing, fidelidad. Una valoración editable por usuario y recurso. Solo si hubo uso/lectura suficiente. **Sin** reseña libre.
- Thumbs por generación; 1–5 opcional en checkpoints (~máx. 1 cada 10 interacciones); encuesta al final.
- Bug/sugerencia siempre visible y asociado a contexto técnico mínimo controlado por el usuario.
- Usage visible por intento/paso/historia/cuenta; re-rolls y fallos incluidos.

No se importa el sistema legal o de moderación de Empty Spaces. El motor aplica Exclusions y Adult Content Profile. El Administrador puede ocultar listings como función editorial. No hay publicación a internet.

---

## 11. Requisitos funcionales (NSFW)

Numeración propia. Trazan el PRD Empty Spaces recortado.

### Cuenta

- N-001 Login username/password en modo privado.
- N-002 Admin crea usuario (username único, password, rol).
- N-003 Admin edita usuario y resetea password.
- N-004 Admin desactiva/reactiva; desactivado no entra.
- N-005 Autorización por id de usuario en servidor.
- N-006 Identidad pública = username + avatar de producto.
- N-007 Aviso de historia privada visible en toda sesión no publicada.
- N-008 Bootstrap del primer admin si no hay usuarios.
- N-009 Salir del modo privado cierra la sesión NSFW.

### Creación

- N-010 Creación en 3 pasos con sugerencias máximas razonables.
- N-011 Avanzado en disclosure progresivo.
- N-012 Experience o desde cero.
- N-013 Época preconstruida o propia.
- N-014 Overrides de nombre/personalidad/preferencias o delegar en IA.
- N-015 Hasta 5 intereses principales y exclusiones ilimitadas.
- N-016 Self-insert persistente entre historias del usuario.
- N-017 Bloquear relaciones a preservar; por defecto la historia las inventa.
- N-018 Generar Caracterización al preparar.
- N-019 Resumen inicial sin spoilers, profundizable.
- N-020 Descartar plan sugerido; editar Director View como posibilidad.

### Motor

- N-021 Castellano de España directo.
- N-022 Contratos distintos por formato.
- N-023 Formato inmutable en la sesión/rama.
- N-024 Quick y Quality comparten Bible/estado/plan y se pueden cambiar.
- N-112 El usuario puede elegir modelo al crear una historia y cambiarlo para el siguiente intento.
- N-113 Los tres aliases iniciales son Gemma-4-26B-A4B StyleTune V2 + Heretic, Gemma-4-31B StyleTune Heretic ARA y G4-Dark-Soul-26B-A4B.
- N-114 Cada alias se mapea a un model id real de LM Studio; indisponibilidad visible y sin fallback silencioso.
- N-115 Cada intento registra modelo y configuración.
- N-116 Comparar modelos crea alternativas hermanas desde idéntico estado padre.
- N-025 Políticas Pause, Lite, Automático, No interactivo según formato.
- N-026 Speak, Act, elige la IA.
- N-027 Sugerencias con prominencia distinta + input libre.
- N-028 Parar en punto natural de intervención.
- N-029 No usurpar al protagonista salvo política que lo permita.
- N-030 No precipitar adulto/relación sin causa.
- N-031 Mantener objetivo, tono y cadencia.
- N-032 Diálogo sustancial también en Story.
- N-033 Adulto central y recurrente según perfil y duración.
- N-034 Corazón de escalada; no repetir la petición hasta cumplirse.
- N-035 Envelope estructurado y validado antes de aceptar.
- N-036 Campos separados: prosa, diálogo, speech, cues, choices, delta, plan patch.
- N-037 Speech oculto.
- N-038 Stop de stream: copiable, no aceptado.
- N-039 Un reintento automático; luego Retry / Quick / editar / Report.
- N-040 Skills aplicadas quedan registradas en el intento.

### Memoria

- N-041 World State, Bible, resumen, reciente, escena: separados.
- N-042 Bible versionada con procedencia de hechos.
- N-043 Secretos ocultos al jugador mientras el protagonista no los conozca; no existe revelación administrativa.
- N-044 Plan mutable por interacciones.
- N-045 Director View opcional, sin spoiler extra.
- N-046 Edición factual sincroniza estado.
- N-047 Corregir hechos canónicos ante contradicción.
- N-048 Caracterización por historia; fuente intacta.
- N-049 Guardar override como Clone privado.

### Ramas

- N-050 Re-roll no destructivo, navegable, descartable.
- N-051 Usage/feedback/modelo por intento.
- N-052 Bifurcar desde cualquier beat aceptado.
- N-053 Ancestros compartidos; original intacto.
- N-054 Una generación activa por rama.
- N-055 Paralelo entre historias distintas.
- N-056 Rechazar resultado stale.
- N-057 Secuela ligada.

### Chat (nuevo)

- N-058 Avatar/sprite por intervención con actor válido.
- N-059 Longitud y densidad de contrato Chat.
- N-060 Compositor conversacional + historial accesible.

### Novela Visual (nueva)

- N-061 Fondo de Place + sprites transparentes compuestos en cliente.
- N-062 Sin exigir imágenes de grupo.
- N-063 Selección por tags de cuerpo/ropa/pose/expresión/acción/contexto.
- N-064 Nombre, diálogo y narración con jerarquía clara.
- N-065 Backlog de beats aceptados.
- N-066 Auto, skip-leído, velocidad, transiciones, volumen, fullscreen, a11y.
- N-067 Teclado, touch, controles visibles.
- N-068 Landscape recomendado + portrait usable.
- N-069 Checkpoints y elecciones integradas.
- N-070 Galería de vistos.
- N-071 No voz, lip-sync, .rpy ni gen visual en play.
- N-104 Autosave en cada beat aceptado y saves manuales nombrados.
- N-105 Scene CGs precatalogados, versionados y registrables en galería.

### Studio / assets

- N-072 Character sin bio canónica.
- N-073 Sprite = un personaje transparente + tags completos.
- N-074 Place = escena + fondo versionado; sin Zone.
- N-075 Setting y Era.
- N-076 Experience con slots, perfil, seeds, finales.
- N-077 Draft, preview, validación, publicación.
- N-078 Recursos privados no publicados.
- N-079 Play solo con assets existentes pineados.

### Biblioteca / Hub

- N-080 Sesiones en curso y terminadas.
- N-081 Published Stories guardadas.
- N-082 Experiences, Characters, Places, Collections.
- N-083 Distinguir creado / añadido / derivado / guardado.
- N-084 Archivo reversible + vista de archivados.
- N-085 Hub con Stories, Experiences, Characters, Places.
- N-086 Búsqueda y facetas.
- N-087 Follow de creadores.
- N-088 Colecciones.
- N-089 Comentarios ocultables editorialmente por el Administrador.
- N-090 Share nativo/copia de ruta interna (nunca de sesión privada).
- N-091 Ratings 1–5 dimensionales, uno por usuario/recurso, con umbral de uso.
- N-092 Sin reseña libre.
- N-093 Publicar exige autorización explícita (sin licencia).
- N-094 Snapshot inmutable; retirar/republicar como nuevo snapshot.
- N-095 Retirada voluntaria no rompe adds previos.

### Feedback / uso / audio

- N-096 Thumbs por generación.
- N-097 Rating discreto en checkpoints (≈1/10).
- N-098 Encuesta al final.
- N-099 Feedback no bloquea el play.
- N-100 Bug y sugerencia siempre visibles.
- N-101 Usage desglosado; re-rolls y fallos incluidos.
- N-102 Audio affordances “Próximamente”.
- N-103 Speech annotations persistidas y ocultas.
- N-106 Publicación automática en Hub tras validación local satisfactoria.
- N-107 Portadas explícitas visibles directamente solo dentro del Hub NSFW autenticado.
- N-108 Ficha de creador con sus historias y recursos.
- N-109 Colecciones editoriales separadas de colecciones de usuario.
- N-110 Vista Admin de generaciones sin mostrar prosa ni prompts privados.
- N-111 Legado privado lineal en visor de solo lectura con CTA para iniciar sesión nueva.

---

## 12. Calidad (gate de producto, no de infra)

Dimensiones (mismas ponderaciones Empty Spaces, usadas por el critic Quality y por evals *internos* opcionales):

- calidad literaria y castellano 25%
- personajes/diálogo 20%
- continuidad/memoria 10%
- pacing y no acelerar 15%
- agencia 10%
- contenido adulto 20%

Umbral Empty Spaces 8.0 / ninguna dimensión &lt; 7.5 es **aspiración** del critic, no un bloqueo de deploy. No se adopta el benchmark Gemma 60×3 como requisito de instalación.

### 12.1 Objetivos medibles

- Activación: ≥80% de usuarios activos inicia una historia; mediana creación→primer texto <90 s; ≥70% completa creación sin abrir avanzado.
- Experiencia: ≥70% de beats aceptados sin re-roll; valoración final media ≥4/5; <5% feedback negativo por pérdida de agencia o aceleración; ≥60% reanuda una historia.
- Motor local (hipótesis revisables): feedback inmediato; p50 primer texto ≤3 s; p50 Quick ≤20 s; p50 Quality ≤50 s; timeout recuperable a 120 s; ≥95% intentos sin intervención manual.
- Catálogo: 8 Experiences, 12 Personajes y 12 Lugares materialmente distintos y con cobertura real antes de considerar completo M4.

### 12.2 Requisitos no funcionales de producto

- NFR-N01: publicar chunks provisionales cada 100–250 ms o unidad semántica.
- NFR-N02: mantener 60 fps razonables en VN en móvil soportado.
- NFR-N03: interfaz por teclado, foco visible, contraste WCAG AA y reducción de movimiento.
- NFR-N04: responsive portrait sin overflow horizontal a 320 y 390 px.
- NFR-N05: VN optimizada para landscape y con fallback portrait funcional.
- NFR-N06: un resultado stale nunca avanza una rama.
- NFR-N07: reanudar/saves/backlog usan solo Accepted Beats.
- NFR-N08: ninguna ruta o asset NSFW se muestra antes de entrar y autenticarse en la parte oculta.
- NFR-N09: el SFW conserva comportamiento, estilo, datos y tests existentes.

---

## 13. User stories (NSFW)

Cada historia requiere pruebas y verificación visual en navegador (desktop y 320/390 px; VN también landscape y fallback portrait).

| ID | Historia y criterios de aceptación |
|---|---|
| US-N01 | **Administrar usuarios.** Bootstrap solo sin usuarios; Admin crea, edita, resetea password y desactiva/reactiva; username único; desactivado no entra; salir del modo privado cierra sesión. |
| US-N02 | **Crear rápido.** Experience o cero; reparto/perfil/defaults sugeridos; avanzado colapsado; resumen sin spoilers; persiste exactamente formato, duración, tono, perspectiva, política y perfil. |
| US-N03 | **Jugar Story.** Cumple contrato Story; Speak/Act/input/escalada; no controla protagonista; estado/Bible/Plan cambian solo tras aceptar; fallo y stop no aceptan parcial. |
| US-N04 | **Re-roll.** Original y alternativas navegables; usage propio; solo una aceptada; hoja descartable; stale no sobrescribe. |
| US-N05 | **Bifurcar.** Cualquier beat aceptado; ancestros compartidos; original intacto; nombre/fecha; ambas rutas en Biblioteca. |
| US-N06 | **Chat nuevo.** Actor válido y avatar/sprite por intervención; densidad/longitud Chat; narrador conciso; compositor conversacional; portrait sin overflow. |
| US-N07 | **VN nueva.** Place + sprites o CG válido; backlog, saves, auto, skip leído, galería; choices integradas; landscape, touch/teclado y portrait usable. |
| US-N08 | **Bible.** Hechos y secretos separados; secretos no visibles hasta que el protagonista los conoce; corrección crea versión y afecta generaciones siguientes. |
| US-N09 | **Final.** Finalizar, seguir y secuela; secuela enlaza sesión anterior; continuar no elimina el final registrado. |
| US-N10 | **Personaje/Sprites.** Character sin bio; sprite individual transparente con facetas completas; preview de gaps; override guardable como Clone. |
| US-N11 | **Lugar.** Place con un fondo versionado, Setting/Era y preview; no aparece Zone. |
| US-N12 | **Experience.** Premisa, slots, variables, reglas, perfil, seeds y finales; preview valida cobertura; una sesión altera Plan sin mutar plantilla. |
| US-N13 | **Hub.** Autenticado; búsqueda/facetas/tabs; portadas explícitas directas; ficha muestra creador, tags, procedencia y CTA compatible; nada filtra al SFW/login. |
| US-N14 | **Añadir.** Add crea referencia, conserva versión/procedencia, evita duplicado; retirado no admite nuevos adds. |
| US-N15 | **Publicar/retirar.** Autorización explícita; publicación automática tras validación; snapshot inmutable; retirar no rompe adds previos; republicar crea snapshot nuevo. |
| US-N16 | **Valorar/comentar.** Una valoración editable por usuario/recurso tras uso suficiente; dimensiones 1–5; comentarios de texto; Admin puede ocultar editorialmente. |
| US-N17 | **Feedback.** Bug/sugerencia accesible desde toda superficie autenticada; usuario controla texto y contexto; aparece en Admin. |
| US-N18 | **Usage.** Tokens por categorías e intento/paso/historia/cuenta; fallos, descartes y re-rolls reconcilian con total. |
| US-N19 | **Admin producto.** Usuarios, taxonomía, listings, comentarios, feedback y metadatos de generaciones; sin inspeccionar historias privadas ni operar infra. |
| US-N20 | **Quick/Quality y modelos.** Perfil y modelo se eligen independientemente para el siguiente intento; los tres aliases se configuran; el no disponible se señala; cada intento registra model id; comparar modelos usa el mismo estado padre; Quality ejecuta planner/writer/critic/revision/validator. |
| US-N21 | **Legado.** Historias privadas antiguas abren en visor de solo lectura y ofrecen iniciar sesión nueva desde premisa/personajes sin conversión silenciosa. |

---

## 14. Milestones

DoD de cada uno: usable en vertical, FRs trazados, lint, E2E relevante, browser check, sin mezclar SFW.

### M0 — Cáscara NSFW

- Entrada oculta intacta.
- Estilo Empty Spaces en shell privado (tokens, nav Inicio/Hub/Crear/Biblioteca).
- Bootstrap admin + login + CRUD usuarios + desactivar.
- Ownership `ownerUserId` en datos nuevos privados.
- SFW sin cambios.

### M1 — Golden path Story

- Creación 3 pasos (desde cero).
- Envelope JSON + streaming provisional.
- Contrato Story, compositor Speak/Act, escalada.
- Bible/plan/estado básicos.
- Aceptar / fallo + 1 retry.
- Aviso de privacidad. Usage mínimo.

### M2 — Agencia

- Re-roll, ramas, edición+sync, continuación/secuela.
- Biblioteca con archivo/restaurar.

### M3 — Chat y VN **nuevos**

- Players distintos; formato inmutable.
- Composición sprites+fondo y Scene CG; spriteQuery.
- Backlog, autosave/saves manuales, auto, skip-leído, galería y landscape VN.
- Políticas de interacción.
- Misma historia de prueba jugable en Chat y VN **separados**.

### M4 — Studio, Experiences, Hub

- Character/Sprite/Place/Experience.
- Taxonomía adulta + propuestas.
- Publicar/retirar/Add/follow/colecciones/ratings/comentarios.
- Catálogo semilla: objetivo 8 Experiences / 12 Personajes / 12 Lugares **jugables** (cobertura real, no solo conteo). No bloquea M1–M3.

### M5 — Calidad de motor y admin de producto

- Quality pipeline; skills versionadas.
- Selector y comparación de modelos; aliases configurables para los tres modelos iniciales.
- Feedback thumbs/checkpoint/encuesta.
- Affordances de audio.
- Consola admin de usuarios, taxonomía, publicaciones, comentarios, feedback y generaciones sin prosa.
- Perfil Self-insert pulido.

### M6 — Hardening de producto

- Accesibilidad y reduced motion.
- Matriz desktop, 320 px, 390 px, VN landscape y portrait fallback.
- Latencia Quick/Quality medida en los modelos locales configurados.
- Pruebas de ramas profundas, saves, stale results y migración legacy.
- Cobertura real del catálogo semilla.
- Regresión completa SFW.

Orden fijo: no construir Hub ni VN pulida antes de M1. Chat/VN de M3 son rebuild, no un flag sobre el player SFW.

---

## 15. Trazabilidad del recorte

| Bloque Empty Spaces | Decisión Mis Historias NSFW |
|---|---|
| FR-016–030 creación/preferencias | Adoptado y adaptado a usuarios locales |
| FR-031–071 motor, memoria y ramas | Adoptado; sin workers/leases cloud |
| FR-072–083 VN | Adoptado, incluidos saves, CGs existentes, landscape/portrait y sin runtime generation |
| FR-084–101 Studio/Biblioteca | Adoptado; storage local y archivo reversible |
| FR-102–119 Hub/publicación | Adoptado como Hub autenticado local; sin licencia, derechos ni cuarentena legal |
| FR-134–147 feedback/usage/audio futuro | Adoptado; sin entrenamiento ni audio real |
| FR-148–159 administración | Solo usuarios y funciones editoriales de producto; se excluyen infra, auditoría e inspección privada |
| ADR 0003/0005/0007/0008/0009 | Adoptados íntegramente en formatos/ramas/VN |
| ADR 0016/0017/0018 | Speech/Envelope/Bible adoptados; no toggle Admin de secretos |
| ADR 0022–0027/0029/0030/0032/0033 | Adoptados y adaptados a local |
| ADR 0031 | Publicación automática local tras validación estructural |
| ADR 0054/0057 | Estilo visual y objetivo de catálogo adoptados |
| Infra, proveedores, edad, licencias, controles legales/seguridad | Excluidos explícitamente |

## 16. Mapa desde el código privado actual

| Hoy (private) | Destino |
|---|---|
| Trigger oculto + `.private-scope` rosa | Trigger oculto + tokens Empty Spaces |
| Sin usuarios | Admin + username/password |
| `visualMode` boolean | `format` inmutable; players nuevos |
| `Message` + parser líneas | Envelope; parser SFW no se usa en NSFW |
| `continue` / `auto` | Interaction Policy |
| `character.prompt` como bio | Defaults de identidad + Characterization |
| `StoryCharacterCustomization` | Character Override (+ Clone explícito) |
| `userName` / `protagonistPreferences` privados | Self-insert Profile |
| Backgrounds | Places (nombre + un fondo + setting/era) |
| Character images + tags | Character Sprites + facetas |
| Copiar historia | Branch / Experience / secuela (copiar deja de ser la operación viva) |
| Borrar historia | Archivar; borrar duro aparte y explícito |
| SwarmUI | Solo Studio |
| Presets de prompt | PromptBundle + skills; los presets SFW no se reutilizan como contrato de formato |

Datos privados existentes: migrar lo posible (personajes, imágenes, fondos, sonidos) a las nuevas entidades; sesiones viejas lineales pueden quedar solo lectura o re-generarse. No convertir en silencio un chat SFW-privado en Format Chat nuevo.

Decisión cerrada: las sesiones privadas antiguas se conservan en un visor legado de **solo lectura**. Ofrecen “Iniciar nueva versión” para copiar premisa, reparto y assets compatibles a una sesión nueva; no convierten mensajes antiguos en envelopes.

---

## 17. Fuera, recordatorio explícito

No implementar: invitaciones, edad, OAuth, email, licencias, cuarentena legal, Marketplace, Convex, S3, Docker, Salad, workers, leases, Gemma/Heretic, SEO, TTS real, gen de imagen en play, `.rpy`, Privacy Erasure, emergency stop, evals como gate de binario.

Sí mantener del repo: `pnpm lint`, no `pnpm build` salvo petición, no limpiar colección privada en test-data, rama actual.
