# Identidad y aislamiento multiusuario mediante Cloudflare Access

Estado: aceptada

## Contexto

Cloudflare Tunnel limita el acceso exterior, pero el servidor también escucha en la red local. Confiar solo en que el proxy validó `Cf-Access-Jwt-Assertion` permitiría falsificar identidades al alcanzar directamente el origen. Además, las referencias de mensajes a imágenes, fondos o sonidos deben respetar el mismo propietario que la historia; no basta con que la historia sea editable.

## Decisión

Mis Historias verifica en el propio servidor la firma RS256, emisor, audience y vigencia de cada JWT mediante el JWKS del dominio del equipo de Cloudflare Access. Usa `sub` como identidad técnica y el email solo como representación visible. El token completo no se guarda ni se registra.

El dominio del equipo y el audience se guardan como configuración global en SQLite. La activación valida el token con la configuración propuesta y, en una única transacción, asigna el primer usuario como administrador y reclama los datos heredados. Una instalación multiusuario sin configuración válida cierra la API; un token inválido recibe 401. El administrador solo puede cambiar la configuración mientras la actual todavía autentica la petición y la propuesta valida la misma identidad. Si la configuración queda inutilizable, la recuperación se hace con el servidor detenido mediante el script local `access-config.mjs`, nunca mediante una API sin autenticar.

Todo contenido normal y privado se aísla por propietario. El administrador no obtiene acceso ordinario al contenido ajeno: sus excepciones siguen limitadas a backups, trazas operativas y reasignación de identidades. Las relaciones editables —incluidas las referencias multimedia de mensajes— deben apuntar a recursos del mismo propietario; la migración elimina solo las referencias históricas que incumplan esta regla.

Se conserva la excepción demo explícita y de solo lectura. Una historia demo comparte su objeto completo y el contexto que utiliza, incluidos originales multimedia, metadatos de generación y diagnósticos asociados. Esta exposición amplia es deliberada; no existe una proyección demo saneada. Las consultas correlacionan siempre historia, mensaje y recurso por propietario para impedir que una referencia fabricada publique datos de otra cuenta.

La configuración operativa, los secretos, los backups y las trazas de error siguen siendo globales y administrativos. Los backups SQLite contienen la configuración Access capturada, pero una restauración en vivo conserva el dominio y audience activos de la instalación para no sustituir su frontera de autenticación. La apariencia, velocidad, avance visual, sonidos predeterminados y datos del protagonista siguen siendo personales.

## Consecuencias

La activación continúa siendo irreversible desde la interfaz y un cambio de `sub` exige reasignación administrativa. La disponibilidad depende del JWKS de Cloudflare al validar tokens no presentes en caché y una configuración errónea requiere acceso local al host. El administrador y quien posea un backup SQLite mantienen acceso a secretos y a contenido potencialmente sensible; las trazas omiten binarios y data URLs, truncan el tamaño y ocultan credenciales reconocibles.
