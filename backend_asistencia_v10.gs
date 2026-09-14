/**
 * BACKEND — pegar esto en Extensiones > Apps Script del Google Sheet,
 * reemplazando el contenido actual (v9).
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
  if (!sheet) throw new Error('Falta crear la hoja "Profesores".');

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
  return profesor.cursos.indexOf('todos') !== -1 || profesor.cursos.indexOf(cursoId) !== -1;
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
      const resultado = altaAlumno(data.cursoId, data.dni, data.nombre, data.telefono);
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
  return rows.some(r => norm(r[iId]) === cursoId);
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
  return norm(celdaIdCurso).split(',').map(s => norm(s)).includes(cursoId);
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
 */
function altaAlumno(cursoId, dniCrudo, nombreCrudo, telefonoCrudo) {
  cursoId = norm(cursoId);
  const dni = normalizeDni(dniCrudo);
  const nombre = norm(nombreCrudo).toUpperCase(); // mayúsculas, misma convención que la planilla existente
  const telefono = norm(telefonoCrudo).replace(/\D/g, ''); // solo dígitos — mismo criterio que el DNI, opcional

  if (!cursoExiste(cursoId)) throw new Error(`El curso "${cursoId}" no existe en la hoja Cursos.`);
  if (!dni) throw new Error('El DNI ingresado no es válido.');
  if (!nombre) throw new Error('Falta el nombre del alumno.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const existentes = getAlumnosDelCurso(cursoId);
    if (existentes.some(a => a.dni === dni)) {
      throw new Error(`Ya existe un alumno con DNI ${dni} en este curso.`);
    }

    const sheet = SS.getSheetByName('Alumnos');
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const iCurso = header.indexOf('ID Curso');
    const iDni = header.indexOf('DNI');
    const iAlumno = header.indexOf('Alumno');
    const iTelefono = header.indexOf('Teléfono');
    const iEstado = header.indexOf('Estado');
    const iFechaAlta = header.indexOf('Fecha de alta');
    if (iFechaAlta === -1) throw new Error('Falta la columna "Fecha de alta" en la hoja Alumnos.');
    if (iTelefono === -1) throw new Error('Falta la columna "Teléfono" en la hoja Alumnos.');

    const fila = new Array(header.length).fill('');
    fila[iCurso] = cursoId;
    fila[iDni] = dni;
    fila[iAlumno] = nombre;
    fila[iTelefono] = telefono;
    fila[iEstado] = ESTADO_PENDIENTE;
    fila[iFechaAlta] = todayISO();

    const nuevaFila = sheet.getLastRow() + 1;
    sheet.getRange(nuevaFila, iDni + 1, 1, 1).setNumberFormat('@');
    sheet.getRange(nuevaFila, iTelefono + 1, 1, 1).setNumberFormat('@');
    sheet.getRange(nuevaFila, iFechaAlta + 1, 1, 1).setNumberFormat('@');
    sheet.getRange(nuevaFila, 1, 1, header.length).setValues([fila]);

    return { dni: dni, nombre: nombre, telefono: telefono };
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

  if (!fecha || fecha > todayISO()) {
    throw new Error(`Fecha inválida o futura: "${fecha}".`);
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

    // 2) Recién ahora borrar las filas viejas, de abajo hacia arriba para
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

    if (!fechaTexto) {
      celdasASellar.push({ fila: idx + 2, valor: hoyISO });
      aAvisar.push({ cursoId: cursoId, nombre: nombre, dni: dni, dias: 0, nota: ' (sin fecha registrada, recién sellada con hoy)' });
      return;
    }

    const fechaAlta = new Date(fechaTexto + 'T00:00:00');
    const dias = Math.floor((hoy - fechaAlta) / (1000 * 60 * 60 * 24));
    if (dias < REMINDER_DAYS) return;

    const ciclosAhora = Math.floor(dias / REMINDER_DAYS);
    const ciclosHaceUnaSemana = Math.floor((dias - 7) / REMINDER_DAYS);
    if (ciclosAhora > ciclosHaceUnaSemana) {
      aAvisar.push({ cursoId: cursoId, nombre: nombre, dni: dni, dias: dias, nota: '' });
    }
  });

  celdasASellar.forEach(c => sheet.getRange(c.fila, iFechaAlta + 1).setValue(c.valor));

  if (aAvisar.length === 0) return;

  const cuerpo = aAvisar
    .map(a => `- ${a.cursoId} · ${a.nombre} (DNI ${a.dni}) — ${a.dias} día(s) pendiente${a.nota}`)
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
