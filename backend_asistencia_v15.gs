/**
 * BACKEND — pegar esto en Extensiones > Apps Script del Google Sheet,
 * reemplazando el contenido actual (v14).
 *
 * v15 — Cambios respecto a v14:
 *
 *  - FUNCIÓN NUEVA onEditAlumnos(e) — sincroniza DNI/Alumno con
 *    "Registros" AUTOMÁTICAMENTE cada vez que se edita a mano la hoja
 *    "Alumnos", sin tener que acordarse de correr corregirDni().
 *    Requiere instalarla UNA sola vez como activador (ver INSTALAR LA
 *    SINCRONIZACIÓN AUTOMÁTICA más abajo) — después corre sola.
 *
 *    Cubre el caso común: se edita UNA sola celda (DNI o Alumno) de
 *    una fila que ya tenía datos. Ahí sí reconcilia solo, con el
 *    mismo criterio de seguridad que corregirDni() (si el DNI nuevo
 *    ya le pertenece a otro alumno, revierte la celda en Alumnos y
 *    avisa por mail en vez de fusionar dos personas por accidente).
 *
 *    NO cubre ediciones de varias celdas a la vez (pegar una fila
 *    nueva, pegar una columna entera) — el evento onEdit de Apps
 *    Script no entrega el valor anterior en esos casos, así que no
 *    hay "antes" confiable con el que reconciliar. Se ignoran sin
 *    generar alertas — son, en la enorme mayoría de los casos, altas
 *    nuevas (no correcciones), y ahí no hay nada en Registros todavía
 *    que necesite reconciliarse. Para esos casos puntuales seguís
 *    teniendo corregirDni()/verificarConsistenciaCursos() a mano.
 *
 *    NO retroactivo: un alumno que ya tenía el DNI mal cargado ANTES
 *    de instalar este activador sigue necesitando un corregirDni()
 *    manual, una sola vez, para ponerse al día — de ahí en adelante,
 *    los cambios futuros a ese alumno ya quedan cubiertos solos.
 *
 *    Igual que corregirDni(), NO TOCA Registros_Historial (bitácora,
 *    no vista actual — ver v14).
 *
 * INSTALAR LA SINCRONIZACIÓN AUTOMÁTICA (una sola vez, manual):
 *   1. En el editor de Apps Script, elegí "onEditAlumnos" en el
 *      desplegable de funciones (arriba).
 *   2. Ícono de reloj ⏰ "Activadores" (columna izquierda) → "+ Añadir
 *      activador".
 *   3. Función: onEditAlumnos · Evento: Desde la hoja de cálculo ·
 *      Tipo: Al editar. Guardar.
 *   Con eso alcanza — no hace falta tocar nada más para que corra sola
 *   de ahí en adelante, cada vez que alguien edite la hoja Alumnos.
 *
 * v14 — Cambios respecto a v13:
 *
 *  - FUNCIÓN NUEVA corregirDni(dniViejo, dniNuevo) — para cuando un
 *    alumno quedó dado de alta con un DNI mal cargado (typo, o un
 *    placeholder tipo "0000000" porque no se tenía el dato real todavía)
 *    y se corrige después en la hoja "Alumnos". Sin esta función, la fila
 *    de "Alumnos" quedaba corregida pero los "Registros" de asistencia ya
 *    guardados con el DNI viejo quedaban huérfanos — silenciosamente
 *    dejaban de pertenecerle a ese alumno en cualquier planilla externa
 *    que matchee por DNI (como REGISTRO_2026_AUTOCOMPLETADO).
 *    corregirDni() actualiza en una sola operación, bajo el mismo lock
 *    que usan altaAlumno/saveAttendance: la fila de "Alumnos" (DNI +
 *    Alumno, por si también cambió el nombre) y TODAS las filas de
 *    "Registros" con ese DNI — la tabla viva, la que consultan otras
 *    planillas por DNI. Antes de tocar nada valida que el DNI nuevo no
 *    pertenezca ya a otro alumno activo — si pasara, se frena con error
 *    en vez de fusionar dos personas distintas por accidente.
 *    A PROPÓSITO NO TOCA "Registros_Historial": esa hoja es una
 *    bitácora de lo que se cargó y cuándo (ver changelog v11), no una
 *    vista actual — reescribirla borraría el rastro de que esas filas
 *    se guardaron en su momento con el DNI viejo.
 *    Deliberadamente NO es automática (no hay trigger onEdit escuchando
 *    la hoja Alumnos): es una operación que reescribe historial, así que
 *    se corre a mano desde el editor cuando hace falta, no cada vez que
 *    alguien toca una celda. Devuelve cuántas filas tocó en cada hoja —
 *    queda en el Registro de ejecuciones.
 *
 *  - FUNCIÓN NUEVA previsualizarCorreccionDni(dniViejo, dniNuevo) —
 *    mismo chequeo y el mismo conteo de filas que corregirDni(), pero
 *    sin escribir nada. Pensada para correr primero y confirmar en el
 *    log cuántas filas va a tocar antes de correr corregirDni() de
 *    verdad — atajo simple contra un DNI tipeado mal en el llamado.
 *
 * v13 — Cambios respecto a v12:
 *
 *  - altaAlumno() AHORA RECIBE APELLIDO Y NOMBRE POR SEPARADO
 *    (parámetros apellidoCrudo, nombreCrudo) EN VEZ DE UN SOLO CAMPO DE
 *    TEXTO LIBRE, Y AMBOS SON OBLIGATORIOS. Antes, el docente tipeaba
 *    el nombre completo en un único campo del panel "Agregar alumno" y
 *    el backend lo guardaba tal cual (solo pasado a mayúsculas, desde
 *    v9) — nada garantizaba que lo hubiera escrito en el orden
 *    "APELLIDO NOMBRE" que usa el resto del sistema, y con nombres
 *    compuestos (ej. "BEATRIZ FATIMA") no hay forma de deducir el
 *    orden después con una heurística de texto.
 *    Ahora el backend arma el nombre completo él mismo, concatenando
 *    `${apellido} ${nombre}` en ese orden fijo — el orden queda
 *    garantizado por código, no por lo que haya tipeado el docente en
 *    cada campo. Ninguno de los dos puede quedar vacío.
 *    REQUIERE actualizar el frontend EN EL MISMO DESPLIEGUE: el panel
 *    "Agregar alumno" tiene que separarse en dos inputs (Apellido,
 *    Nombre), y el POST de "altaAlumno" tiene que mandar "apellido" y
 *    "nombre" como campos separados en vez de uno solo. Con un
 *    frontend viejo (que siga mandando solo "nombre"), altaAlumno()
 *    ahora rechaza el alta con "Falta el apellido del alumno." en vez
 *    de guardar algo a medias — es intencional, para no mezclar altas
 *    con formato viejo y nuevo en la misma hoja sin darse cuenta.
 *    No afecta filas ya cargadas en "Alumnos" — el cambio solo rige
 *    para altas nuevas a partir de que se suba esta versión.
 *
 * v12 — Cambios respecto a v11:
 *
 *  - altaAlumno() YA NO DUPLICA FILA CUANDO EL ALUMNO YA EXISTE EN OTRO
 *    CURSO. Antes, el chequeo de DNI repetido solo miraba el curso
 *    destino (getAlumnosDelCurso(cursoId)); si el alumno ya tenía fila
 *    para "cursoA" y se lo daba de alta desde la app en "cursoB", ese
 *    chequeo no lo encontraba y se creaba una fila nueva — mismo DNI,
 *    Estado="pendiente" (aunque la fila original ya estuviera
 *    confirmada), sin sincronizar con la fila vieja. Quedaban dos filas
 *    sueltas en vez de una sola con "cursoA,cursoB" en ID Curso, que es
 *    el formato que el resto del sistema espera para multi-curso desde
 *    v10 — y verificarConsistenciaCursos() no lo detectaba, porque
 *    compara duplicados de DNI dentro del mismo curso, no entre filas
 *    de cursos distintos.
 *    Ahora, antes de crear fila, altaAlumno() busca el DNI en TODA la
 *    hoja "Alumnos" (no solo en el curso destino): si ya existe en otra
 *    fila, le agrega el curso nuevo a esa fila (ej. "cursoA" →
 *    "cursoA,cursoB") en vez de crear una fila nueva, sin tocar el
 *    resto de los campos (Estado, Alumno, Teléfono, Fecha de alta
 *    quedan como estaban). Si el DNI no existe en ninguna fila, el
 *    comportamiento es el mismo de siempre (fila nueva, "pendiente").
 *    Pendiente, no incluido acá: filas ya duplicadas por este bug antes
 *    de subir v12 no se fusionan solas — hay que unirlas a mano en la
 *    planilla.
 *
 *  - AVISO DE revisarPendientes() AHORA DICE "alumno nuevo" O "curso"
 *    junto a cada pendiente, para saber de un vistazo si hay que
 *    revisar un alumno recién creado o si es un alumno ya conocido que
 *    se sumó a un curso donde le faltaba (fila con más de un curso en
 *    ID Curso). Es una fila más para leer en el mail semanal, no cambia
 *    ninguna lógica de guardado.
 *
 * v11 — Cambios respecto a v10 (revisión de seguridad/bugs):
 *
 *  - COMPARACIÓN DE "ID CURSO" AHORA IGNORA MAYÚSCULAS/MINÚSCULAS
 *    (normCurso()) en perteneceACurso(), cursoExiste() y
 *    puedeAccederCurso(). Antes, un typo de mayúsculas entre "Cursos" y
 *    "Alumnos" (o entre "Cursos" y la columna "Cursos" de "Profesores")
 *    dejaba a un alumno invisible o a un profesor sin acceso, sin
 *    ningún error visible.
 *
 *  - altaAlumno() SANITIZA EL NOMBRE (sanitizeNombre()): saca los
 *    caracteres < > & antes de guardar. Segunda capa de defensa contra
 *    HTML/script inyectado vía el campo "Agregar alumno" — la principal
 *    es el escape al mostrar en el frontend (ver index.html).
 *
 *  - ERRORES DE CONFIGURACIÓN (hoja o columna faltante) YA NO SE
 *    MUESTRAN CRUDOS AL DOCENTE. errorConfiguracion() loguea el detalle
 *    real en el Registro de ejecuciones y devuelve un mensaje genérico
 *    y accionable. No aplica a errores que el docente puede resolver
 *    solo (DNI inválido, sin acceso al curso, sesión vencida) — esos
 *    siguen mostrando el detalle real, sigue siendo información útil.
 *
 *  - saveAttendance() VALIDA QUE LA FECHA TENGA FORMA REAL DE FECHA
 *    (esFechaValida()), no solo que compare como string contra hoy.
 *    Cierra el caso de una fecha con formato roto (ej. "2026-13-45")
 *    llegando directo por API sin pasar por el selector del frontend.
 *
 *  - NUEVA BITÁCORA — archivarRegistrosPrevios(): antes de borrar filas
 *    viejas de "Registros" al re-guardar una fecha ya cargada, copia esas
 *    filas a la hoja "Registros_Historial" (si existe). Antes, re-guardar
 *    pisaba en silencio quién había cargado esa fecha antes y cuándo —
 *    solo quedaba el último guardado. Ver INSTALAR LA BITÁCORA más abajo.
 *
 *  Pendiente, no incluido en esta revisión: sacar el idToken de la URL
 *  en los pedidos de lectura (hoy viaja en el query string de doGet).
 *  Queda para una revisión aparte porque cambia el protocolo de todos
 *  los pedidos de lectura y exige subir frontend y backend en el mismo
 *  momento — no se mezcla con este batch de fixes puntuales.
 *
 * INSTALAR LA BITÁCORA (una sola vez, manual):
 *   Crear una hoja nueva llamada exactamente "Registros_Historial", con
 *   los mismos encabezados que "Registros" en la fila 1: Marca temporal |
 *   ID Curso | Fecha | DNI | Alumno | Presente | Cargado por. Sin este
 *   paso, el guardado de asistencia sigue funcionando igual — solo se
 *   salta la bitácora y lo avisa en el log.
 *
 * v10 — Cambios respecto a v9:
 *
 *  - UN ALUMNO PUEDE ESTAR EN MÁS DE UN CURSO. La columna "ID Curso"
 *    de "Alumnos" ahora admite una lista separada por coma (con o sin
 *    espacio después de la coma — "curso1,curso2" y "curso1, curso2"
 *    son las dos válidas). Afecta a getAlumnosDelCurso() — de ahí
 *    dependen el roster y el chequeo de DNI duplicado al dar de alta,
 *    así que ambos quedan cubiertos con este único cambio. Marcar
 *    asistencia sigue afectando solo al curso que se está viendo — la
 *    tabla "Registros" ya guardaba un curso por fila, eso no cambió.
 *    Pendiente, no bloqueante: el diagnóstico manual
 *    verificarConsistenciaCursos() todavía no separa alumnos
 *    multi-curso — los va a listar bajo el texto combinado tal cual
 *    aparece en la celda (ej. "curso1,curso2"), no como parte de cada
 *    curso por separado.
 *
 * v9 — Cambios respecto a v8:
 *
 *  - altaAlumno() AHORA GUARDA EL NOMBRE EN MAYÚSCULAS, igual que la
 *    convención ya usada en la planilla (ej. "AHUMADA ISABEL" en la
 *    fila de ejemplo de la v7). Antes se guardaba tal cual lo tipeaba
 *    el docente, mezclando mayúsculas/minúsculas fila a fila.
 *  - TELÉFONO AHORA SE GUARDA SOLO CON DÍGITOS, mismo criterio que el
 *    DNI (que ya se normalizaba así desde v8). Se descartó forzar un
 *    formato con guion tipo "223-6803397" porque el largo del código
 *    de área varía en Argentina y automatizarlo mal deja el dato
 *    incorrecto en cada fila nueva sin forma de detectarlo después.
 *
 * v8 — Cambios respecto a v7:
 *
 *  - altaAlumno() AHORA ACEPTA TELÉFONO (4to parámetro, opcional). La
 *    columna "Teléfono" de "Alumnos" ya existía desde la migración
 *    original, pero esta función nunca la escribía — quedaba como
 *    descarte silencioso. doPost() ahora pasa data.telefono. Se cierra
 *    antes de conectar el campo Teléfono del panel de alta en el
 *    frontend nuevo, para no migrar un campo que el backend descartaba.
 *
 * v7 — 30/08/2026. Cambios respecto a v6:
 *
 *  - ALTA DE ALUMNO DESDE LA APP (acción "altaAlumno"): crea la fila en
 *    "Alumnos" con Estado="pendiente" y sella la columna nueva "Fecha
 *    de alta". Valida que el DNI no esté ya en ese curso antes de crear.
 *
 *  - COLUMNA NUEVA en "Alumnos": "Fecha de alta" (columna F). Hay que
 *    crearla a mano en la hoja real (agregar el encabezado exacto
 *    "Fecha de alta" en F1) y opcionalmente ocultarla con clic derecho
 *    > Ocultar columna — el script funciona igual esté oculta o no,
 *    eso es solo estética. La completa el script al dar de alta un
 *    alumno pendiente, o revisarPendientes() la primera vez que
 *    encuentra un pendiente viejo sin fecha. No cargar a mano.
 *
 *  - RECORDATORIO DE PENDIENTES (revisarPendientes) — pensada para
 *    correr con un trigger semanal (instrucciones de instalación más
 *    abajo). Avisa por mail a los 20 días de alta, y cada 20 días
 *    mientras el alumno siga "pendiente". Ver INSTALAR EL RECORDATORIO
 *    más abajo — sin ese paso manual en el editor, esta función existe
 *    pero nunca se ejecuta sola.
 *
 *  - CACHE DE VERIFICACIÓN DE idToken (CacheService, 10 minutos) — antes
 *    cada acción del docente (incluso cambiar de fecha) volvía a pegarle
 *    a Google. Ahora se cachea por el hash del token. Efecto secundario
 *    aceptado: revocar un acceso en "Profesores" puede tardar hasta 10
 *    minutos en hacerse efectivo en vez de ser inmediato.
 *
 *  - ACCIÓN NUEVA "cursoData": roster + asistencia del día en una sola
 *    llamada — antes abrir un curso eran dos viajes al servidor
 *    separados (roster, después attendance). Se usa solo al ABRIR un
 *    curso; cambiar de fecha dentro del mismo curso sigue usando
 *    "attendance" sola, porque el roster no cambió y no tiene sentido
 *    volver a pedirlo.
 *
 *  - FORMATO DE RESPUESTA UNIFICADO: todas las acciones devuelven
 *    {ok:true, ...} o {ok:false, error}. Antes "cursos"/"roster"/
 *    "attendance" devolvían el dato pelado o {error} sin "ok" en el
 *    caso de fallo — inconsistente con "verificar", que sí lo tenía.
 *
 *  - verificarConsistenciaCursos() ahora también avisa si hay más de
 *    una fila para el mismo curso+fecha+DNI en "Registros" — no debería
 *    pasar nunca con el guardado actual (ver comentario en
 *    saveAttendance), pero si pasa es rastro de un corte a mitad de un
 *    guardado y vale la pena que quede a la vista.
 *
 *  - normalizeDni() ahora también saca puntos y guiones ("30.123.456"
 *    pasa a "30123456"), no solo trim(). Sin esto, un DNI cargado con
 *    puntos en "Alumnos" y sin puntos en la app no matcheaban nunca.
 *
 *  - Se saca testFetch() — quedó de una prueba, sin uso funcional.
 *
 * REQUIERE:
 *   GOOGLE_CLIENT_ID más abajo, el mismo Client ID de OAuth que en el
 *   HTML del frontend (termina en .apps.googleusercontent.com).
 *
 * INSTALAR EL RECORDATORIO SEMANAL (una sola vez, manual):
 *   1. En el editor de Apps Script, elegí "revisarPendientes" en el
 *      desplegable de funciones (arriba).
 *   2. Ícono de reloj ⏰ "Activadores" (columna izquierda) → "+ Añadir
 *      activador".
 *   3. Función: revisarPendientes · Evento: Activado por tiempo ·
 *      Tipo: Temporizador semanal · Día y horario: el que prefieras.
 *      Guardar.
 *   Con eso alcanza — no hace falta tocar nada más para que corra sola.
 *
 * ESTRUCTURA DE HOJAS:
 *
 * Cursos:      ID Curso | Nombre | Sede | Turno | Estado
 * Alumnos:     ID Curso | DNI | Alumno | Teléfono | Estado | Fecha de alta
 *   Fecha de alta: columna nueva, formato texto (yyyy-MM-dd). La
 *   completa el script — no cargar a mano salvo que sepas lo que hacés.
 * Profesores:  Email | Nombre | Cursos | Estado
 *   Cursos: "todos", o lista de ID Curso separados por coma.
 *   Estado: "aprobado" o "pendiente".
 * Registros:   Marca temporal | ID Curso | Fecha | DNI | Alumno | Presente | Cargado por
 *   Una única fila por combinación de curso+fecha+DNI (delete+insert:
 *   decisión consciente para que la planilla sirva de base consultable
 *   por otros archivos con query, sin lógica de deduplicación).
 * Registros_Historial (opcional, ver v11): mismos encabezados que
 *   Registros. Recibe copia de cada fila que saveAttendance reemplaza al
 *   re-guardar una fecha ya cargada — puede tener varias filas por
 *   curso+fecha+DNI, es bitácora, no vista actual. No cargar a mano.
 *
 * Estado (en Cursos y Alumnos): vacío = activo, "baja" = inactivo.
 * Estado (solo en Alumnos, además): "pendiente" = alta hecha desde la
 *   app, sin confirmar todavía por un preceptor. Un alumno "pendiente"
 *   YA aparece en el roster del docente (lo puede marcar presente o
 *   ausente), pero NO cuenta en la Matrícula del Resumen hasta que
 *   alguien lo pase a Estado vacío (activo) a mano.
 *
 * IMPORTANTE (una sola vez): columna "DNI" en Alumnos y Registros, y
 * columnas "Fecha" y "Fecha de alta" → Formato > Número > Texto sin
 * formato.
 */

const GOOGLE_CLIENT_ID = '602289685493-vqk48ip48087vjpc2fmm1odkdrnqkja8.apps.googleusercontent.com';
const REMINDER_EMAIL = 'emfp10educacion@gmail.com';
const REMINDER_DAYS = 20;
const TOKEN_CACHE_SECONDS = 600; // 10 minutos

const SS = SpreadsheetApp.getActiveSpreadsheet();
const TZ = 'America/Argentina/Buenos_Aires';

const PRESENTE = 'Presente';
const AUSENTE = 'Ausente';
const ESTADO_BAJA = 'baja';
const ESTADO_PENDIENTE = 'pendiente';

// ---------- autenticación ----------

function verificarIdTokenSinCache(idToken) {
  if (!idToken) throw new Error('Falta iniciar sesión (sin idToken).');

  const resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) {
    throw new Error('Sesión inválida o vencida. Volvé a iniciar sesión.');
  }
  const info = JSON.parse(resp.getContentText());

  if (info.aud !== GOOGLE_CLIENT_ID) {
    throw new Error('Token de otra aplicación — configuración incorrecta.');
  }
  if (info.email_verified !== 'true' && info.email_verified !== true) {
    throw new Error('El email de Google no está verificado.');
  }
  return norm(info.email).toLowerCase();
}

function hashToken(idToken) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken);
  return digest.map(b => (b + 256).toString(16).slice(-2)).join('');
}

/**
 * Como verificarIdTokenSinCache, pero cachea el email verificado 10
 * minutos (por hash del token, nunca el token en sí) para no pegarle a
 * Google en cada acción del docente.
 */
function verificarIdToken(idToken) {
  if (!idToken) throw new Error('Falta iniciar sesión (sin idToken).');

  const cache = CacheService.getScriptCache();
  const key = 'tok_' + hashToken(idToken);
  const cached = cache.get(key);
  if (cached) return cached;

  const email = verificarIdTokenSinCache(idToken);
  cache.put(key, email, TOKEN_CACHE_SECONDS);
  return email;
}

function getProfesorAutorizado(email) {
  const sheet = SS.getSheetByName('Profesores');
  if (!sheet) errorConfiguracion('Falta crear la hoja "Profesores".');

  const rows = sheet.getDataRange().getValues();
  const header = rows.shift();
  const iEmail = header.indexOf('Email');
  const iNombre = header.indexOf('Nombre');
  const iCursos = header.indexOf('Cursos');
  const iEstado = header.indexOf('Estado');

  const fila = rows.find(r => norm(r[iEmail]).toLowerCase() === email);
  if (!fila) throw new Error('Tu email no está en la lista de profesores.');
  if (norm(fila[iEstado]).toLowerCase() !== 'aprobado') {
    throw new Error('Tu acceso todavía no fue aprobado.');
  }

  const cursosTexto = norm(fila[iCursos]).toLowerCase();
  const cursos = cursosTexto === 'todos' || !cursosTexto
    ? ['todos']
    : cursosTexto.split(',').map(c => c.trim()).filter(Boolean);

  return { email: email, nombre: norm(fila[iNombre]) || email, cursos: cursos };
}

function puedeAccederCurso(profesor, cursoId) {
  // profesor.cursos ya viene en minúsculas (armado en getProfesorAutorizado).
  return profesor.cursos.indexOf('todos') !== -1 || profesor.cursos.indexOf(normCurso(cursoId)) !== -1;
}

function autenticar(idToken) {
  const email = verificarIdToken(idToken);
  return getProfesorAutorizado(email);
}

// ---------- rutas ----------

function doGet(e) {
  const action = e.parameter.action;

  if (action === 'verificar') {
    try {
      const profesor = autenticar(e.parameter.idToken);
      return jsonResponse({ ok: true, nombre: profesor.nombre, cursos: profesor.cursos });
    } catch (err) {
      return jsonResponse({ ok: false, error: String(err.message || err) });
    }
  }

  try {
    const profesor = autenticar(e.parameter.idToken);

    if (action === 'cursos') {
      return jsonResponse({ ok: true, cursos: getCursos(profesor) });
    }
    if (action === 'roster') {
      if (!puedeAccederCurso(profesor, e.parameter.cursoId)) {
        return jsonResponse({ ok: false, error: 'No tenés acceso a ese curso.' });
      }
      return jsonResponse({ ok: true, roster: getRoster(e.parameter.cursoId) });
    }
    if (action === 'attendance') {
      if (!puedeAccederCurso(profesor, e.parameter.cursoId)) {
        return jsonResponse({ ok: false, error: 'No tenés acceso a ese curso.' });
      }
      return jsonResponse(Object.assign({ ok: true }, getAttendance(e.parameter.cursoId, e.parameter.fecha)));
    }
    if (action === 'cursoData') {
      if (!puedeAccederCurso(profesor, e.parameter.cursoId)) {
        return jsonResponse({ ok: false, error: 'No tenés acceso a ese curso.' });
      }
      return jsonResponse({
        ok: true,
        roster: getRoster(e.parameter.cursoId),
        attendance: getAttendance(e.parameter.cursoId, e.parameter.fecha)
      });
    }
    return jsonResponse({ ok: false, error: 'accion desconocida' });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const profesor = autenticar(data.idToken);

    if (!puedeAccederCurso(profesor, data.cursoId)) {
      return jsonResponse({ ok: false, error: 'No tenés acceso a ese curso.' });
    }

    if (data.action === 'altaAlumno') {
      const resultado = altaAlumno(data.cursoId, data.dni, data.apellido, data.nombre, data.telefono);
      return jsonResponse(Object.assign({ ok: true }, resultado));
    }

    // Sin "action" (o "guardarAsistencia" explícito): guardar asistencia.
    const resultado = saveAttendance(data.cursoId, data.fecha, data.asistencia, profesor.nombre);
    return jsonResponse({ ok: true, guardados: resultado.guardados, ignorados: resultado.ignorados });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message || err) });
  }
}

// ---------- helpers ----------

function norm(value) {
  return String(value == null ? '' : value).trim();
}

// ID de curso, para comparar sin que un typo de mayúsculas/minúsculas
// entre "Cursos" y "Alumnos" haga que un alumno quede invisible.
function normCurso(value) {
  return norm(value).toLowerCase();
}

// Error de CONFIGURACIÓN (hoja o columna faltante, no algo que el
// docente hizo mal): el detalle real queda en el Registro de
// ejecuciones, el docente ve un mensaje genérico y accionable.
function errorConfiguracion(detalle) {
  Logger.log('CONFIGURACIÓN — ' + detalle);
  throw new Error('Hay un problema de configuración en el sistema. Avisale a quien lo administra.');
}

// Fecha con forma real de fecha (no solo el patrón yyyy-MM-dd como
// texto) — rechaza cosas como "2026-13-45" que la comparación de
// strings sola no detecta.
function esFechaValida(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00');
  return !isNaN(d.getTime()) && normalizeFecha(d) === value;
}

// Nombre libre (lo tipea el docente en "Agregar alumno"): saca
// caracteres que no tienen sentido en un nombre real y que sí podrían
// usarse para inyectar HTML si algún día se muestra sin escapar en
// algún lugar. Es la segunda capa — la primera y principal es el
// escape en el frontend al mostrar (ver index.html, escapeHtml()).
function sanitizeNombre(value) {
  return norm(value).replace(/[<>&]/g, '');
}

function normalizeFecha(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, TZ, 'yyyy-MM-dd');
  }
  return norm(value);
}

function normalizeDni(value) {
  if (typeof value === 'number') {
    return String(Math.trunc(value));
  }
  return norm(value).replace(/\D/g, '');
}

function todayISO() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function cursoExiste(cursoId) {
  const sheet = SS.getSheetByName('Cursos');
  const rows = sheet.getDataRange().getValues();
  const header = rows.shift();
  const iId = header.indexOf('ID Curso');
  return rows.some(r => normCurso(r[iId]) === normCurso(cursoId));
}

// ---------- cursos ----------

function getCursos(profesor) {
  const sheet = SS.getSheetByName('Cursos');
  const rows = sheet.getDataRange().getValues();
  const header = rows.shift();
  const iId = header.indexOf('ID Curso');
  const iNombre = header.indexOf('Nombre');
  const iSede = header.indexOf('Sede');
  const iTurno = header.indexOf('Turno');
  const iEstado = header.indexOf('Estado');

  return rows
    .filter(r => norm(r[iId]) && norm(r[iEstado]).toLowerCase() !== ESTADO_BAJA)
    .filter(r => puedeAccederCurso(profesor, norm(r[iId])))
    .map(r => ({
      id: norm(r[iId]),
      nombre: norm(r[iNombre]),
      sede: norm(r[iSede]),
      turno: norm(r[iTurno])
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

// ---------- alumnos (pestaña única "Alumnos", todos los cursos juntos) ----------

// Un alumno puede estar anotado en más de un curso: "ID Curso" admite
// una lista separada por coma (con o sin espacio después de la coma,
// las dos formas son válidas — ej. "curso1,curso2" o "curso1, curso2").
function perteneceACurso(celdaIdCurso, cursoId) {
  return norm(celdaIdCurso).split(',').map(s => normCurso(s)).includes(normCurso(cursoId));
}

function getAlumnosDelCurso(cursoId) {
  cursoId = norm(cursoId);
  const sheet = SS.getSheetByName('Alumnos');
  const rows = sheet.getDataRange().getValues();
  const header = rows.shift();
  const iCurso = header.indexOf('ID Curso');
  const iDni = header.indexOf('DNI');
  const iAlumno = header.indexOf('Alumno');
  const iEstado = header.indexOf('Estado');

  return rows.filter(r => perteneceACurso(r[iCurso], cursoId)).map(r => ({
    dni: normalizeDni(r[iDni]),
    name: norm(r[iAlumno]),
    activo: norm(r[iEstado]).toLowerCase() !== ESTADO_BAJA
  }));
}

function getRoster(cursoId) {
  return getAlumnosDelCurso(cursoId)
    .filter(a => a.name && a.activo && a.dni)
    .map(a => ({ dni: a.dni, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function getNombresPorDni(cursoId) {
  const map = {};
  getAlumnosDelCurso(cursoId).forEach(a => {
    if (a.dni) map[a.dni] = a.name;
  });
  return map;
}

/**
 * Alta de un alumno "pendiente" desde la app. Valida DNI duplicado en
 * el mismo curso (el frontend ya lo chequea contra el roster en
 * memoria antes de llamar acá, pero esto es la validación real —
 * nunca confiar solo en el chequeo del cliente).
 *
 * V8 — teléfono opcional: la hoja "Alumnos" ya tenía la columna
 * "Teléfono" desde la migración original (ver migrarCursosAAlumnos),
 * pero esta función nunca la escribía — quedaba como descarte
 * silencioso si el frontend llegaba a mandar el dato. Se cierra acá,
 * antes de conectar el campo Teléfono del panel de alta en el
 * frontend nuevo.
 *
 * V12 — si el DNI ya tiene fila en OTRO curso, se le suma el curso
 * nuevo a esa fila en vez de crear una fila duplicada (ver changelog
 * v12 al principio del archivo). El chequeo de "ya existe en este
 * curso" de más abajo sigue mirando solo el curso destino — eso no
 * cambia —; lo nuevo es la búsqueda del DNI en toda la hoja que se
 * hace después, antes de decidir si crear fila o fusionar.
 *
 * V13 — apellido y nombre llegan separados (apellidoCrudo, nombreCrudo)
 * en vez de un solo campo de texto libre; acá se arma el "Alumno" final
 * como `${apellido} ${nombre}`, en ese orden fijo (ver changelog v13 al
 * principio del archivo). Los dos son obligatorios.
 */
function altaAlumno(cursoId, dniCrudo, apellidoCrudo, nombreCrudo, telefonoCrudo) {
  cursoId = norm(cursoId);
  const dni = normalizeDni(dniCrudo);
  // mayúsculas + sin < > & en cada parte por separado (ver sanitizeNombre),
  // así una inyección repartida entre los dos campos tampoco se cuela al unirlos.
  const apellido = sanitizeNombre(apellidoCrudo).toUpperCase();
  const nombre = sanitizeNombre(nombreCrudo).toUpperCase();
  const nombreCompleto = `${apellido} ${nombre}`.trim(); // orden fijo, no depende de cómo lo tipeen
  const telefono = norm(telefonoCrudo).replace(/\D/g, ''); // solo dígitos — mismo criterio que el DNI, opcional

  if (!cursoExiste(cursoId)) throw new Error(`El curso "${cursoId}" no existe en la hoja Cursos.`);
  if (!dni) throw new Error('El DNI ingresado no es válido.');
  if (!apellido) throw new Error('Falta el apellido del alumno.');
  if (!nombre) throw new Error('Falta el nombre del alumno.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const existentes = getAlumnosDelCurso(cursoId);
    if (existentes.some(a => a.dni === dni)) {
      throw new Error(`Ya existe un alumno con DNI ${dni} en este curso.`);
    }

    const sheet = SS.getSheetByName('Alumnos');
    const datos = sheet.getDataRange().getValues();
    const header = datos.shift();
    const iCurso = header.indexOf('ID Curso');
    const iDni = header.indexOf('DNI');
    const iAlumno = header.indexOf('Alumno');
    const iTelefono = header.indexOf('Teléfono');
    const iEstado = header.indexOf('Estado');
    const iFechaAlta = header.indexOf('Fecha de alta');
    if (iFechaAlta === -1) errorConfiguracion('Falta la columna "Fecha de alta" en la hoja Alumnos.');
    if (iTelefono === -1) errorConfiguracion('Falta la columna "Teléfono" en la hoja Alumnos.');

    // ¿El DNI ya tiene fila en OTRO curso? Buscamos en TODA la hoja,
    // no solo en el curso destino (ver V12 arriba). Si aparece, se
    // suma el curso nuevo a esa fila en vez de crear una fila
    // duplicada — sin tocar Estado/Alumno/Teléfono/Fecha de alta.
    const idxExistente = datos.findIndex(r => normalizeDni(r[iDni]) === dni);
    if (idxExistente !== -1) {
      const filaSheet = idxExistente + 2; // +1 por el header, +1 porque las filas empiezan en 1
      const cursosActuales = norm(datos[idxExistente][iCurso]).split(',').map(s => norm(s)).filter(Boolean);
      cursosActuales.push(cursoId);
      sheet.getRange(filaSheet, iCurso + 1).setValue(cursosActuales.join(','));

      return {
        dni: dni,
        nombre: norm(datos[idxExistente][iAlumno]),
        telefono: norm(datos[idxExistente][iTelefono])
      };
    }

    const fila = new Array(header.length).fill('');
    fila[iCurso] = cursoId;
    fila[iDni] = dni;
    fila[iAlumno] = nombreCompleto;
    fila[iTelefono] = telefono;
    fila[iEstado] = ESTADO_PENDIENTE;
    fila[iFechaAlta] = todayISO();

    const nuevaFila = sheet.getLastRow() + 1;
    sheet.getRange(nuevaFila, iDni + 1, 1, 1).setNumberFormat('@');
    sheet.getRange(nuevaFila, iTelefono + 1, 1, 1).setNumberFormat('@');
    sheet.getRange(nuevaFila, iFechaAlta + 1, 1, 1).setNumberFormat('@');
    sheet.getRange(nuevaFila, 1, 1, header.length).setValues([fila]);

    return { dni: dni, nombre: nombreCompleto, telefono: telefono };
  } finally {
    lock.releaseLock();
  }
}

// ---------- asistencia ----------

function getAttendance(cursoId, fecha) {
  cursoId = norm(cursoId);
  fecha = norm(fecha);
  const sheet = SS.getSheetByName('Registros');
  const rows = sheet.getDataRange().getValues();
  const header = rows.shift();
  const iCurso = header.indexOf('ID Curso');
  const iFecha = header.indexOf('Fecha');
  const iDni = header.indexOf('DNI');
  const iPresente = header.indexOf('Presente');
  const iMarca = header.indexOf('Marca temporal');
  const iCargadoPor = header.indexOf('Cargado por');

  const asistencia = {};
  let cargado = false;
  let ultimaCarga = null;
  let cargadoPor = '';

  rows.forEach(r => {
    if (!norm(r[iCurso]) && !norm(r[iFecha])) return;
    if (norm(r[iCurso]) !== cursoId) return;
    if (normalizeFecha(r[iFecha]) !== fecha) return;

    cargado = true;
    asistencia[normalizeDni(r[iDni])] = norm(r[iPresente]) === AUSENTE ? AUSENTE : PRESENTE;
    const marca = r[iMarca];
    if (marca instanceof Date && (!ultimaCarga || marca > ultimaCarga)) {
      ultimaCarga = marca;
      cargadoPor = iCargadoPor >= 0 ? norm(r[iCargadoPor]) : '';
    }
  });

  return {
    cargado: cargado,
    ultimaCarga: ultimaCarga ? Utilities.formatDate(ultimaCarga, TZ, "dd/MM HH:mm") : null,
    cargadoPor: cargadoPor,
    asistencia: asistencia
  };
}

function saveAttendance(cursoId, fecha, asistencia, cargadoPor) {
  cursoId = norm(cursoId);
  fecha = norm(fecha);
  cargadoPor = norm(cargadoPor);

  if (!esFechaValida(fecha)) {
    throw new Error(`Fecha inválida: "${fecha}".`);
  }
  if (fecha > todayISO()) {
    throw new Error(`Fecha futura: "${fecha}".`);
  }
  if (!cursoExiste(cursoId)) {
    throw new Error(`El curso "${cursoId}" no existe en la hoja Cursos.`);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const nombrePorDni = getNombresPorDni(cursoId);
    const dnisValidos = Object.keys(nombrePorDni);

    const dnisRecibidos = Object.keys(asistencia || {});
    const dnis = dnisRecibidos.filter(dni => dnisValidos.indexOf(dni) !== -1);
    const ignorados = dnisRecibidos.length - dnis.length;

    if (dnis.length === 0) return { guardados: 0, ignorados: ignorados };

    const sheet = SS.getSheetByName('Registros');

    // Guardamos primero qué filas viejas de este curso+fecha hay que
    // borrar, antes de escribir nada — así los números de fila no se
    // mezclan después con los de las filas nuevas que vamos a agregar.
    const datosPrevios = sheet.getDataRange().getValues();
    const header = datosPrevios[0];
    const iCurso = header.indexOf('ID Curso');
    const iFecha = header.indexOf('Fecha');
    const iDni = header.indexOf('DNI');

    const filasABorrar = []; // números de fila reales en la hoja (1-indexed)
    for (let i = 1; i < datosPrevios.length; i++) {
      const r = datosPrevios[i];
      if (!norm(r[iCurso]) && !norm(r[iFecha])) continue;
      if (norm(r[iCurso]) === cursoId && normalizeFecha(r[iFecha]) === fecha) {
        filasABorrar.push(i + 1);
      }
    }

    // 1) Escribir las filas nuevas primero (al final de la hoja).
    const timestamp = new Date();
    const nuevasFilas = dnis.map(dni => [
      timestamp,
      cursoId,
      fecha,
      dni,
      nombrePorDni[dni] || '',
      asistencia[dni] === AUSENTE ? AUSENTE : PRESENTE,
      cargadoPor
    ]);

    const firstNewRow = sheet.getLastRow() + 1;
    sheet.getRange(firstNewRow, iFecha + 1, nuevasFilas.length, 1).setNumberFormat('@');
    sheet.getRange(firstNewRow, iDni + 1, nuevasFilas.length, 1).setNumberFormat('@');
    sheet.getRange(firstNewRow, 1, nuevasFilas.length, 7).setValues(nuevasFilas);

    // 2) Antes de borrar, dejar copia de lo que había en "Registros_Historial"
    // (si existe) — así una re-carga de una fecha ya cargada no pisa en
    // silencio quién la había cargado antes. Si la hoja no existe todavía,
    // no bloquea el guardado — solo queda sin bitácora hasta que se cree.
    if (filasABorrar.length) {
      archivarRegistrosPrevios(filasABorrar.map(fila => datosPrevios[fila - 1]));
    }

    // 3) Recién ahora borrar las filas viejas, de abajo hacia arriba para
    // no correr los índices de las que todavía faltan borrar. Si el
    // script se corta acá, en el peor caso quedan filas duplicadas
    // (recuperable a mano, y ahora además detectable — ver
    // verificarConsistenciaCursos) — nunca cero filas para ese día.
    filasABorrar.sort((a, b) => b - a).forEach(fila => sheet.deleteRow(fila));

    return { guardados: dnis.length, ignorados: ignorados };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Copia filas de "Registros" a "Registros_Historial" antes de que
 * saveAttendance las borre para reemplazarlas. Sin esto, re-guardar una
 * fecha ya cargada pierde en silencio quién la había cargado antes y
 * cuándo — solo queda el último guardado.
 *
 * REQUIERE crear a mano la hoja "Registros_Historial" con los mismos
 * encabezados que "Registros" (Marca temporal | ID Curso | Fecha | DNI |
 * Alumno | Presente | Cargado por) — igual que "Fecha de alta" en su
 * momento, no se crea sola. Si no existe todavía: no bloquea el guardado
 * de asistencia, solo se salta la bitácora y lo deja en el log — la
 * asistencia del día importa más que su historial.
 */
function archivarRegistrosPrevios(filas) {
  const historial = SS.getSheetByName('Registros_Historial');
  if (!historial) {
    Logger.log('Registros_Historial no existe todavía — se guardó la asistencia igual, sin bitácora de este reemplazo.');
    return;
  }
  const primeraFila = historial.getLastRow() + 1;
  historial.getRange(primeraFila, 3, filas.length, 1).setNumberFormat('@'); // Fecha
  historial.getRange(primeraFila, 4, filas.length, 1).setNumberFormat('@'); // DNI
  historial.getRange(primeraFila, 1, filas.length, filas[0].length).setValues(filas);
}

// ---------- recordatorio de pendientes ----------

/**
 * Pensada para correr con un trigger semanal (ver INSTALAR EL
 * RECORDATORIO al principio del archivo). Revisa "Alumnos" buscando
 * Estado="pendiente". Por cada uno:
 *  - si no tiene "Fecha de alta" cargada (pendientes de antes de esta
 *    versión), la sella con hoy y lo incluye en el aviso de esta
 *    corrida sin importar el cálculo de días — mejor avisar de más una
 *    vez que dejarlo esperando por un dato que nunca va a aparecer.
 *  - si ya tiene fecha, calcula los días transcurridos y solo lo
 *    incluye si esta semana cruzó un nuevo múltiplo de REMINDER_DAYS
 *    (20) — así avisa una vez cada 20 días, no todas las semanas.
 * Si no hay nada para avisar, no manda mail — no genera ruido en
 * semanas sin pendientes vencidos.
 *
 * V12 — cada línea del aviso ahora dice "[alumno nuevo]" o "[curso]":
 * si la fila tiene más de un curso en ID Curso, es porque el alumno ya
 * estaba dado de alta en otro curso y altaAlumno() lo sumó a este sin
 * tocar Estado; si tiene uno solo, es un alta realmente nueva. Ayuda a
 * decidir de un vistazo si hay que revisar un alumno desconocido o
 * solo confirmar que corresponde sumarlo a ese curso.
 */
function revisarPendientes() {
  const sheet = SS.getSheetByName('Alumnos');
  const rows = sheet.getDataRange().getValues();
  const header = rows.shift();
  const iCurso = header.indexOf('ID Curso');
  const iDni = header.indexOf('DNI');
  const iAlumno = header.indexOf('Alumno');
  const iEstado = header.indexOf('Estado');
  const iFechaAlta = header.indexOf('Fecha de alta');
  if (iFechaAlta === -1) {
    Logger.log('Falta la columna "Fecha de alta" en Alumnos — no se puede revisar pendientes.');
    return;
  }

  const hoy = new Date();
  const hoyISO = todayISO();
  const aAvisar = [];
  const celdasASellar = [];

  rows.forEach((r, idx) => {
    if (norm(r[iEstado]).toLowerCase() !== ESTADO_PENDIENTE) return;
    const cursoId = norm(r[iCurso]);
    const nombre = norm(r[iAlumno]);
    const dni = normalizeDni(r[iDni]);
    const fechaTexto = norm(r[iFechaAlta]);

    // V12: más de un curso en la celda → ya estaba dado de alta en otro
    // curso y se lo sumó a este (ver altaAlumno); uno solo → alta nueva.
    const cantidadCursos = cursoId.split(',').map(s => s.trim()).filter(Boolean).length;
    const origen = cantidadCursos > 1 ? 'curso' : 'alumno nuevo';

    if (!fechaTexto) {
      celdasASellar.push({ fila: idx + 2, valor: hoyISO });
      aAvisar.push({ cursoId: cursoId, nombre: nombre, dni: dni, dias: 0, origen: origen, nota: ' (sin fecha registrada, recién sellada con hoy)' });
      return;
    }

    const fechaAlta = new Date(fechaTexto + 'T00:00:00');
    const dias = Math.floor((hoy - fechaAlta) / (1000 * 60 * 60 * 24));
    if (dias < REMINDER_DAYS) return;

    const ciclosAhora = Math.floor(dias / REMINDER_DAYS);
    const ciclosHaceUnaSemana = Math.floor((dias - 7) / REMINDER_DAYS);
    if (ciclosAhora > ciclosHaceUnaSemana) {
      aAvisar.push({ cursoId: cursoId, nombre: nombre, dni: dni, dias: dias, origen: origen, nota: '' });
    }
  });

  celdasASellar.forEach(c => sheet.getRange(c.fila, iFechaAlta + 1).setValue(c.valor));

  if (aAvisar.length === 0) return;

  const cuerpo = aAvisar
    .map(a => `- ${a.cursoId} · ${a.nombre} (DNI ${a.dni}) — ${a.dias} día(s) pendiente [${a.origen}]${a.nota}`)
    .join('\n');

  MailApp.sendEmail({
    to: REMINDER_EMAIL,
    subject: `Alumnos pendientes de confirmar (${aAvisar.length})`,
    body: `Estos alumnos siguen con alta "pendiente" en la hoja Alumnos:\n\n${cuerpo}\n\n` +
      `Confirmalos cambiando la columna Estado a vacío (activo), o dalos de baja si corresponde. ` +
      `Este aviso se repite cada ${REMINDER_DAYS} días mientras sigan pendientes.`
  });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// MIGRACIÓN ÚNICA — sin cambios respecto a v6. Correr una sola vez a
// mano desde el editor (elegí "migrarCursosAAlumnos" y presioná ▶) si
// todavía te queda algún curso viejo en pestaña propia por juntar.
// ============================================================
function migrarCursosAAlumnos() {
  const destino = SS.getSheetByName('Alumnos');
  if (!destino) { Logger.log('Falta crear la hoja "Alumnos" primero.'); return; }

  const cursosSheet = SS.getSheetByName('Cursos');
  const cursosRows = cursosSheet.getDataRange().getValues();
  const cHeader = cursosRows.shift();
  const iId = cHeader.indexOf('ID Curso');
  const idsDeCursos = cursosRows.map(r => norm(r[iId])).filter(Boolean);

  const yaEnAlumnos = new Set();
  const destRows = destino.getDataRange().getValues();
  const dHeader = destRows.shift();
  const dCurso = dHeader.indexOf('ID Curso');
  const dDni = dHeader.indexOf('DNI');
  destRows.forEach(r => yaEnAlumnos.add(norm(r[dCurso]) + '|' + normalizeDni(r[dDni])));

  let migrados = 0, saltados = 0;
  const filasNuevas = [];

  idsDeCursos.forEach(cursoId => {
    const hoja = SS.getSheetByName(cursoId);
    if (!hoja) return;

    const rows = hoja.getDataRange().getValues();
    const header = rows.shift();
    const iDni = header.indexOf('DNI');
    const iAlumno = header.indexOf('Alumno');
    const iTelefono = header.indexOf('Teléfono');
    const iEstado = header.indexOf('Estado');

    rows.forEach(r => {
      const nombre = norm(r[iAlumno]);
      if (!nombre) return;
      const dni = normalizeDni(r[iDni]);
      const clave = cursoId + '|' + dni;
      if (yaEnAlumnos.has(clave)) { saltados++; return; }
      filasNuevas.push([cursoId, dni, nombre, norm(r[iTelefono]), norm(r[iEstado])]);
      yaEnAlumnos.add(clave);
      migrados++;
    });
  });

  if (filasNuevas.length) {
    const primeraFila = destino.getLastRow() + 1;
    destino.getRange(primeraFila, 1, filasNuevas.length, 5).setValues(filasNuevas);
    destino.getRange(primeraFila, 2, filasNuevas.length, 1).setNumberFormat('@');
  }

  Logger.log(`Migrados ${migrados} alumnos a la hoja "Alumnos" (${saltados} ya estaban y se saltearon).`);
}

// ============================================================
// DIAGNÓSTICO — correr manualmente cuando haga falta (no se ejecuta
// sola). Elegí "verificarConsistenciaCursos" y presioná ▶. Resultado
// en Ver > Registro de ejecuciones.
// ============================================================
function verificarConsistenciaCursos() {
  const sheet = SS.getSheetByName('Alumnos');
  const rows = sheet.getDataRange().getValues();
  const header = rows.shift();
  const iCurso = header.indexOf('ID Curso');
  const iDni = header.indexOf('DNI');
  const iAlumno = header.indexOf('Alumno');
  const iEstado = header.indexOf('Estado');

  const cursosConAlumnos = new Set();
  const sinDniPorCurso = {};
  const dnisVistos = {};

  rows.forEach(r => {
    const cursoId = norm(r[iCurso]);
    const nombre = norm(r[iAlumno]);
    if (!cursoId || !nombre) return;
    cursosConAlumnos.add(cursoId);

    const activo = norm(r[iEstado]).toLowerCase() !== ESTADO_BAJA;
    const dni = normalizeDni(r[iDni]);
    if (activo && !dni) {
      sinDniPorCurso[cursoId] = (sinDniPorCurso[cursoId] || 0) + 1;
    }
    if (dni) {
      const clave = cursoId + '|' + dni;
      dnisVistos[clave] = (dnisVistos[clave] || 0) + 1;
    }
  });

  const cursos = getCursos({ cursos: ['todos'] }); // acceso total solo para este diagnóstico
  const problemas = [];

  cursos.forEach(c => {
    if (!cursosConAlumnos.has(c.id)) {
      problemas.push(`❌ "${c.id}" (${c.nombre}) no tiene ningún alumno cargado en "Alumnos" todavía.`);
    }
    if (sinDniPorCurso[c.id]) {
      problemas.push(`⚠ "${c.id}" (${c.nombre}) tiene ${sinDniPorCurso[c.id]} alumno(s) activos sin DNI — no aparecen en la app.`);
    }
  });

  Object.keys(dnisVistos).forEach(clave => {
    if (dnisVistos[clave] > 1) {
      const partes = clave.split('|');
      problemas.push(`⚠ DNI duplicado en el mismo curso: curso "${partes[0]}", DNI "${partes[1]}" aparece ${dnisVistos[clave]} veces.`);
    }
  });

  // Duplicados de curso+fecha+DNI en Registros. Con el guardado actual
  // (delete+insert) no debería pasar nunca; si aparece, es rastro de un
  // corte a mitad de un guardado.
  const regSheet = SS.getSheetByName('Registros');
  const regRows = regSheet.getDataRange().getValues();
  const regHeader = regRows.shift();
  const rCurso = regHeader.indexOf('ID Curso');
  const rFecha = regHeader.indexOf('Fecha');
  const rDni = regHeader.indexOf('DNI');
  const combosVistos = {};
  regRows.forEach(r => {
    if (!norm(r[rCurso]) || !norm(r[rFecha])) return;
    const clave = norm(r[rCurso]) + '|' + normalizeFecha(r[rFecha]) + '|' + normalizeDni(r[rDni]);
    combosVistos[clave] = (combosVistos[clave] || 0) + 1;
  });
  Object.keys(combosVistos).forEach(clave => {
    if (combosVistos[clave] > 1) {
      problemas.push(`⚠ Registro duplicado (posible corte a mitad de guardado): "${clave}" aparece ${combosVistos[clave]} veces en Registros.`);
    }
  });

  if (problemas.length === 0) {
    Logger.log('Sin problemas de consistencia detectados.');
  } else {
    Logger.log(problemas.join('\n'));
  }
}

// ============================================================
// CORRECCIÓN DE DNI — correr manualmente cuando un alumno quedó dado
// de alta con el DNI mal cargado (typo, o un placeholder tipo
// "0000000" porque no se tenía el dato real todavía — ver changelog
// v14 al principio del archivo).
//
// Uso: primero previsualizarCorreccionDni('dniViejo', 'dniNuevo') para
// confirmar en el Registro de ejecuciones cuántas filas va a tocar
// (no escribe nada). Si el número tiene sentido, corré
// corregirDni('dniViejo', 'dniNuevo') con los mismos DNI para aplicar
// el cambio de verdad. Los DNI van como texto entre comillas para no
// perder ceros a la izquierda al tipearlos en el editor.
// ============================================================

function _filasConDni(sheetName, dni, colName) {
  const sheet = SS.getSheetByName(sheetName);
  if (!sheet) return { sheet: null, header: null, filas: [] };
  const rows = sheet.getDataRange().getValues();
  const header = rows.shift();
  const iCol = header.indexOf(colName);
  const filas = [];
  if (iCol !== -1) {
    rows.forEach((r, idx) => {
      if (normalizeDni(r[iCol]) === dni) filas.push(idx + 2); // +1 header, +1 base 1
    });
  }
  return { sheet: sheet, header: header, filas: filas };
}

function _resumenCorreccionDni(dniViejoCrudo, dniNuevoCrudo) {
  const dniViejo = normalizeDni(dniViejoCrudo);
  const dniNuevo = normalizeDni(dniNuevoCrudo);

  if (!dniViejo) throw new Error('DNI viejo inválido.');
  if (!dniNuevo) throw new Error('DNI nuevo inválido.');
  if (dniViejo === dniNuevo) throw new Error('El DNI nuevo es igual al viejo — no hay nada para corregir.');

  const alumnos = _filasConDni('Alumnos', dniViejo, 'DNI');
  if (alumnos.filas.length === 0) {
    throw new Error(`No hay ningún alumno con DNI ${dniViejo} en la hoja Alumnos.`);
  }
  if (alumnos.filas.length > 1) {
    // No debería pasar (un alumno, una fila) — si pasa, mejor frenar y
    // resolverlo a mano en vez de tocar más de una fila sola.
    throw new Error(`Hay ${alumnos.filas.length} filas con DNI ${dniViejo} en Alumnos — revisar a mano antes de corregir.`);
  }

  // El DNI nuevo no puede pertenecer ya a OTRO alumno — evita fusionar
  // dos personas distintas por accidente.
  const alumnosConNuevo = _filasConDni('Alumnos', dniNuevo, 'DNI');
  if (alumnosConNuevo.filas.length > 0) {
    throw new Error(`Ya existe un alumno con DNI ${dniNuevo} en Alumnos — no se puede usar como destino.`);
  }

  const registros = _filasConDni('Registros', dniViejo, 'DNI');
  const historial = _filasConDni('Registros_Historial', dniViejo, 'DNI'); // hoja opcional

  return { dniViejo: dniViejo, dniNuevo: dniNuevo, alumnos: alumnos, registros: registros, historial: historial };
}

/**
 * Solo lee y cuenta — no escribe nada. Corré esto primero para
 * confirmar en el Registro de ejecuciones cuántas filas va a tocar
 * corregirDni() antes de aplicarlo de verdad.
 */
function previsualizarCorreccionDni(dniViejoCrudo, dniNuevoCrudo) {
  const r = _resumenCorreccionDni(dniViejoCrudo, dniNuevoCrudo);
  Logger.log(
    `Alumnos: 1 fila (DNI ${r.dniViejo} → ${r.dniNuevo}).\n` +
    `Registros: ${r.registros.filas.length} fila(s) a actualizar.\n` +
    `Registros_Historial: ${r.historial.sheet ? r.historial.filas.length + ' fila(s) con el DNI viejo — quedan SIN TOCAR a propósito, es bitácora (ver nota en corregirDni()).' : 'hoja no existe.'}`
  );
  return r;
}

/**
 * Corrige un DNI mal cargado en las hojas que reflejan el ESTADO
 * ACTUAL: Alumnos (identidad del alumno) y Registros (la tabla viva
 * que consultan otras planillas por DNI, como REGISTRO_2026_AUTOCOMPLETADO
 * vía IMPORTRANGE) — ver changelog v14 al principio del archivo. Bajo
 * el mismo lock que usan altaAlumno/saveAttendance, así no corre al
 * mismo tiempo que alguien está guardando asistencia.
 *
 * DELIBERADAMENTE NO TOCA Registros_Historial. Esa hoja es, por
 * diseño, una bitácora de lo que efectivamente se cargó y cuándo (ver
 * changelog v11: "es bitácora, no vista actual") — reescribirla
 * falsificaría el registro de que esas filas se guardaron en su
 * momento con el DNI viejo. Si algún día hace falta rastrear el
 * historial completo de un alumno con DNI corregido, hay que buscar
 * tanto el DNI nuevo (en Registros) como el viejo (en
 * Registros_Historial) — es el costo de mantener la bitácora honesta.
 *
 * De paso refresca el nombre en Registros al valor actual de Alumnos
 * — si el DNI estaba mal por venir de un alta apurada (ver v13), la
 * corrección deja la tabla viva prolija de una sola vez.
 */
function corregirDni(dniViejoCrudo, dniNuevoCrudo) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const r = _resumenCorreccionDni(dniViejoCrudo, dniNuevoCrudo);

    // 1) Alumnos: actualizar el DNI de la (única) fila.
    const iDniAlumnos = r.alumnos.header.indexOf('DNI');
    const iAlumnoAlumnos = r.alumnos.header.indexOf('Alumno');
    const filaAlumno = r.alumnos.filas[0];
    r.alumnos.sheet.getRange(filaAlumno, iDniAlumnos + 1).setValue(r.dniNuevo);
    r.alumnos.sheet.getRange(filaAlumno, iDniAlumnos + 1).setNumberFormat('@');
    const nombreActual = norm(r.alumnos.sheet.getRange(filaAlumno, iAlumnoAlumnos + 1).getValue());

    // 2) Registros (tabla viva): DNI + nombre en cada fila que todavía
    // tuviera el DNI viejo. Registros_Historial NO se toca — ver nota
    // arriba.
    _aplicarCorreccionDni(r.registros, r.dniNuevo, nombreActual);

    const resumen = `DNI ${r.dniViejo} → ${r.dniNuevo}: 1 fila en Alumnos, ` +
      `${r.registros.filas.length} en Registros. ` +
      `Registros_Historial sin tocar (${r.historial.sheet ? r.historial.filas.length + ' fila(s) quedan con el DNI viejo, a propósito' : 'hoja no existe'}).`;
    Logger.log(resumen);
    return resumen;
  } finally {
    lock.releaseLock();
  }
}

function _aplicarCorreccionDni(info, dniNuevo, nombreActual) {
  const iDni = info.header.indexOf('DNI');
  const iAlumno = info.header.indexOf('Alumno');
  info.filas.forEach(fila => {
    info.sheet.getRange(fila, iDni + 1).setValue(dniNuevo);
    info.sheet.getRange(fila, iDni + 1).setNumberFormat('@');
    if (iAlumno !== -1 && nombreActual) {
      info.sheet.getRange(fila, iAlumno + 1).setValue(nombreActual);
    }
  });
}

// ============================================================
// SINCRONIZACIÓN AUTOMÁTICA — activador instalable, ver changelog v15
// al principio del archivo e INSTALAR LA SINCRONIZACIÓN AUTOMÁTICA ahí
// mismo para darlo de alta. No se ejecuta sola hasta que se instale.
// ============================================================

/**
 * Activador de "Al editar" sobre TODA la planilla — filtra internamente
 * para actuar solo sobre ediciones de una sola celda en las columnas
 * DNI o Alumno de la hoja "Alumnos". Ver el changelog v15 para el
 * detalle completo de qué cubre y qué no.
 */
function onEditAlumnos(e) {
  try {
    const sheet = e.range.getSheet();
    if (sheet.getName() !== 'Alumnos') return;
    if (e.range.getNumRows() > 1 || e.range.getNumColumns() > 1) return; // edición múltiple: no tocar
    if (e.range.getRow() === 1) return; // encabezado

    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const iDni = header.indexOf('DNI') + 1;
    const iAlumno = header.indexOf('Alumno') + 1;
    const col = e.range.getColumn();
    if (col !== iDni && col !== iAlumno) return; // no es un campo que reconciliemos

    if (e.oldValue === undefined || e.oldValue === '') return; // primera carga, no corrección

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return; // si no se puede tomar el lock, mejor no tocar nada a los apurones

    try {
      const fila = e.range.getRow();
      if (col === iDni) {
        _sincronizarCambioDni(sheet, fila, header, e.oldValue, e.value);
      } else {
        _sincronizarCambioNombre(sheet, fila, header, e.value);
      }
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    Logger.log('onEditAlumnos — error: ' + (err.message || err));
    MailApp.sendEmail({
      to: REMINDER_EMAIL,
      subject: 'Error en sincronización automática de Alumnos',
      body: 'onEditAlumnos tiró un error al intentar sincronizar un cambio con Registros:\n\n' +
        (err.message || err) + '\n\nRevisar a mano con verificarConsistenciaCursos() o corregirDni().'
    });
  }
}

function _sincronizarCambioDni(sheet, fila, header, dniViejoCrudo, dniNuevoCrudo) {
  const dniViejo = normalizeDni(dniViejoCrudo);
  const dniNuevo = normalizeDni(dniNuevoCrudo);
  if (!dniViejo || !dniNuevo || dniViejo === dniNuevo) return;

  // ¿El DNI nuevo ya le pertenece a OTRO alumno? No fusionar solo:
  // revertir la celda en Alumnos y avisar por mail — mismo criterio de
  // seguridad que corregirDni().
  const otros = _filasConDni('Alumnos', dniNuevo, 'DNI').filas.filter(f => f !== fila);
  if (otros.length > 0) {
    sheet.getRange(fila, header.indexOf('DNI') + 1).setValue(dniViejoCrudo);
    MailApp.sendEmail({
      to: REMINDER_EMAIL,
      subject: 'DNI duplicado al editar Alumnos — no se sincronizó',
      body: `Se intentó cambiar el DNI ${dniViejo} → ${dniNuevo} en la fila ${fila} de Alumnos, ` +
        `pero ${dniNuevo} ya le pertenece a otro alumno (fila ${otros[0]}). Se revirtió el cambio en ` +
        `Alumnos para no fusionar a dos personas distintas. Si corresponde fusionar de verdad, usar ` +
        `corregirDni() a mano.`
    });
    return;
  }

  const registros = _filasConDni('Registros', dniViejo, 'DNI');
  const iAlumno = header.indexOf('Alumno');
  const nombreActual = norm(sheet.getRange(fila, iAlumno + 1).getValue());
  _aplicarCorreccionDni(registros, dniNuevo, nombreActual);
  Logger.log(`onEditAlumnos: DNI ${dniViejo} → ${dniNuevo} sincronizado en ${registros.filas.length} fila(s) de Registros.`);
}

function _sincronizarCambioNombre(sheet, fila, header, nombreNuevoCrudo) {
  const iDni = header.indexOf('DNI');
  const dni = normalizeDni(sheet.getRange(fila, iDni + 1).getValue());
  if (!dni) return; // sin DNI todavía, nada que sincronizar

  const nombreNuevo = norm(nombreNuevoCrudo);
  if (!nombreNuevo) return;

  const registros = _filasConDni('Registros', dni, 'DNI');
  _aplicarCorreccionDni(registros, dni, nombreNuevo); // mismo DNI, solo refresca el nombre
  Logger.log(`onEditAlumnos: nombre actualizado a "${nombreNuevo}" en ${registros.filas.length} fila(s) de Registros (DNI ${dni}).`);
}
