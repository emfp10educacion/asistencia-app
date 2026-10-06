/**
 * BACKEND DEL SISTEMA DE ASISTENCIA EMFP10 — v17
 *
 * Pegar este archivo completo en Extensiones > Apps Script del Google Sheet,
 * reemplazando el contenido actual, guardar y volver a implementar
 * (Implementar > Administrar implementaciones > ✏️ > Nueva versión).
 * La app (index.html) tiene que subirse en el mismo momento: ver "DNI opcional".
 *
 * REQUIERE: GOOGLE_CLIENT_ID más abajo (el mismo Client ID de OAuth que usa el
 * HTML del frontend).
 *
 * PUESTA EN MARCHA (una sola vez, con la cuenta dueña del sistema):
 *   1. Ejecutar instalarActivadores(). Deja instalados: sincronización al editar
 *      Alumnos, recordatorio semanal de pendientes y auditoría diaria. Se puede
 *      volver a ejecutar sin duplicar nada. Si había activadores cargados a mano
 *      de estas funciones, deja uno solo de cada una.
 *   2. Recargar la planilla y elegir Asistencia > Mantenimiento > Preparar la
 *      planilla. Aplica la lista desplegable de Estado, los colores de alumnos
 *      repetidos, las fórmulas del Resumen sin tope de filas y deja al día la
 *      hoja Instrucciones. Se puede repetir cuando se quiera.
 *   3. IMPORTANTE (una sola vez): columna "DNI" en Alumnos y Registros, y
 *      columnas "Fecha" y "Fecha de alta" → Formato > Número > Texto sin formato.
 *   Opcional: crear la hoja "Registros_Historial" con los mismos encabezados que
 *   "Registros" (bitácora de reemplazos; sin ella el guardado funciona igual).
 *
 * QUÉ CAMBIA EN v17 (respecto a v16):
 *
 *  - DNI OPCIONAL. En la app el DNI puede quedar vacío. Al dar de alta sin DNI,
 *    el sistema asigna un número provisorio de 7 dígitos que EMPIEZA CON 0
 *    (0000001, 0000002…): ningún DNI real empieza con 0 y cada persona recibe uno
 *    propio (antes un "0000000" compartido fusionaba personas distintas). Cuando
 *    llega el DNI real se escribe encima del provisorio en la hoja Alumnos y la
 *    asistencia ya guardada se traspasa sola. Escribir solo ID Curso y Alumno
 *    directamente en la hoja también alcanza: el sistema completa el DNI
 *    provisorio. La app tiene que mostrar el nombre/DNI que devuelve altaAlumno.
 *
 *  - MENÚ "Asistencia" en la planilla: dar de baja las filas seleccionadas o por
 *    lista de DNI, unir alumnos repetidos (con vista previa y confirmación),
 *    asignar número a alumnos sin DNI, revisar el sistema ahora, y un submenú de
 *    mantenimiento (reparar asistencia sin alumno, preparar la planilla, instalar
 *    activadores).
 *
 *  - ALUMNO EN DOS CURSOS: puede tener una fila con "curso1,curso2" o una fila por
 *    curso; las dos formas valen. La auditoría ya no lo marca como problema: solo
 *    es problema el MISMO alumno repetido dentro del MISMO curso. Colores en
 *    Alumnos: rojo = repetido en el mismo curso; naranja = mismo DNI en dos filas.
 *
 *  - SINCRONIZACIÓN AL EDITAR (onEditAlumnos): ahora también cubre borrar un DNI y
 *    escribir otro después (son dos ediciones); el cambio se completa solo y se
 *    anota hasta 7 días. Un error repetido ya no manda un mail por edición
 *    (máximo uno por hora). Si el bloqueo está ocupado, queda en el registro.
 *
 *  - AUDITORÍA DIARIA: mail solo si hay problemas, sin repetir el mismo más de una
 *    vez por semana. Los alumnos sin DNI definitivo y el mismo DNI en cursos
 *    distintos son avisos informativos (no mandan mail).
 *
 *  - El curso se compara sin importar mayúsculas también al leer y guardar
 *    asistencia. Se saca la migración inicial (ya no hacía falta).
 *
 * POLÍTICA: NUNCA SE BORRAN FILAS DE "Alumnos" (salvo al unir repetidos). Para
 * sacar a un alumno se pone Estado = "baja": así su asistencia sigue vinculada y
 * la columna "Bajas" del Resumen lo cuenta.
 *
 * HISTORIAL RESUMIDO: v7 alta de alumnos desde la app, pendientes y recordatorio;
 * v10 alumno en varios cursos; v11 comparación sin mayúsculas, bitácora de
 * reemplazos y mensajes de configuración; v13 apellido y nombre separados; v14
 * corregirDni; v15 onEditAlumnos; v16 auditoría diaria, bajas en lote, reparación
 * de asistencia huérfana, una fila por curso.
 *
 * ESTRUCTURA DE HOJAS:
 *
 * Cursos:      ID Curso | Nombre | Sede | Turno | Estado
 * Alumnos:     ID Curso | DNI | Alumno | Teléfono | Estado | Fecha de alta | (otras columnas informativas)
 *   "ID Curso" admite una lista separada por coma ("curso1,curso2").
 *   Estado: vacío = activo · "pendiente" = alta hecha desde la app sin confirmar
 *   (aparece en la app, pero no cuenta en la Matrícula del Resumen) · "baja".
 *   "Fecha de alta": la completa el sistema.
 * Profesores:  Email | Nombre | Cursos | Estado
 *   Cursos: "todos", o lista de ID Curso separados por coma. Estado: "aprobado" o "pendiente".
 * Registros:   Marca temporal | ID Curso | Fecha | DNI | Alumno | Presente | Cargado por
 *   Una única fila por combinación curso+fecha+DNI (borrar + insertar): la planilla
 *   sirve de base consultable para otros archivos sin lógica de deduplicación.
 * Registros_Historial (opcional): mismos encabezados. Recibe copia de cada fila que
 *   se reemplaza al volver a guardar una fecha. Es bitácora, no vista actual.
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

// ---------- DNI opcional: número provisorio ----------
//
// Si un alumno no tiene DNI, el sistema le asigna un número provisorio: 7 dígitos que
// EMPIEZAN CON 0 (0000001, 0000002…). Ningún DNI real empieza con 0, así que nunca se
// confunde con uno, y cada persona recibe el suyo (no se fusionan). Cuando llega el DNI
// real se escribe encima del provisorio en la hoja Alumnos y onEditAlumnos pasa la
// asistencia ya guardada al número nuevo. Se asigna: al dar de alta desde la app sin
// DNI, al escribir una fila nueva en Alumnos con curso y nombre pero sin DNI, y a
// pedido / en la auditoría diaria para lo que se pegó de golpe.

const DNI_PROVISORIO_MAX = 999999;

function esDniProvisorio(dni) {
  return /^0/.test(normalizeDni(dni));
}

// Para mails y avisos: un provisorio se muestra como lo que es.
function _dniParaMostrar(dni) {
  return esDniProvisorio(dni) ? `sin DNI, provisorio ${dni}` : `DNI ${dni}`;
}

// Mayor número provisorio ya usado en Alumnos, Registros o Registros_Historial.
function _maxProvisorio() {
  let max = 0;
  ['Alumnos', 'Registros', 'Registros_Historial'].forEach(nombre => {
    const sheet = SS.getSheetByName(nombre);
    if (!sheet || sheet.getLastRow() < 2) return;
    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const col = header.indexOf('DNI');
    if (col === -1) return;
    sheet.getRange(2, col + 1, sheet.getLastRow() - 1, 1).getValues().forEach(r => {
      const d = normalizeDni(r[0]);
      if (/^0\d{6}$/.test(d)) max = Math.max(max, parseInt(d, 10));
    });
  });
  return max;
}

function _formatoProvisorio(n) {
  if (n > DNI_PROVISORIO_MAX) throw new Error('Se agotaron los números provisorios disponibles.');
  return ('0000000' + n).slice(-7);
}

// Completa el DNI provisorio de las filas activas que tienen curso y nombre pero DNI
// vacío. soloFila (opcional): limitarse a esa fila. Devuelve [{fila, nombre, dni}].
// Quien llama tiene que tener el lock. No toca filas en baja ni una fila a la que
// recién se le borró el DNI (puede estar por reescribirlo; ver _recordarDniBorrado).
function _asignarProvisorios(soloFila) {
  const sheet = SS.getSheetByName('Alumnos');
  if (!sheet) errorConfiguracion('Falta la hoja "Alumnos".');
  const datos = sheet.getDataRange().getValues();
  const header = datos.shift();
  const iCurso = header.indexOf('ID Curso');
  const iDni = header.indexOf('DNI');
  const iAlumno = header.indexOf('Alumno');
  const iEstado = header.indexOf('Estado');
  if (iCurso === -1 || iDni === -1 || iAlumno === -1) errorConfiguracion('Faltan columnas en la hoja Alumnos.');

  const borrados = _leerDnisBorrados();
  const pendientes = [];
  datos.forEach((r, idx) => {
    const fila = idx + 2;
    if (soloFila && fila !== soloFila) return;
    if (!norm(r[iAlumno]) || !norm(r[iCurso]) || normalizeDni(r[iDni])) return;
    if (iEstado !== -1 && norm(r[iEstado]).toLowerCase() === ESTADO_BAJA) return;
    const cursos = norm(r[iCurso]).split(',').map(normCurso).filter(Boolean).sort().join(',');
    if (borrados[_claveNombre(r[iAlumno]) + '|' + cursos]) return;
    pendientes.push({ fila: fila, nombre: norm(r[iAlumno]) });
  });
  if (!pendientes.length) return [];

  let n = _maxProvisorio();
  pendientes.forEach(p => {
    n++;
    p.dni = _formatoProvisorio(n);
    const celda = sheet.getRange(p.fila, iDni + 1);
    celda.setNumberFormat('@');
    celda.setValue(p.dni);
  });
  return pendientes;
}

function asignarProvisorios() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const hechos = _asignarProvisorios();
    Logger.log(hechos.length
      ? `Se asignó número provisorio a ${hechos.length} alumno(s):\n` + hechos.map(h => `fila ${h.fila} · ${h.nombre} → ${h.dni}`).join('\n')
      : 'No hay alumnos activos sin DNI.');
    return hechos;
  } finally {
    lock.releaseLock();
  }
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
 * Alta de un alumno "pendiente" desde la app. Esta es la validación real: el
 * frontend chequea lo mismo contra el roster, pero nunca se confía solo en el cliente.
 *
 *  - Apellido y nombre llegan por separado, ambos obligatorios, y se guardan como
 *    "APELLIDO NOMBRE" en mayúsculas (el orden queda fijo por código).
 *  - El DNI es OPCIONAL. Vacío → se asigna un número provisorio (ver arriba). Si
 *    viene, debe tener 6 o más dígitos y no empezar con 0.
 *  - Si el DNI ya tiene una fila activa en OTRO curso, se le suma el curso a esa fila
 *    en vez de duplicarla (sin tocar Estado, Alumno, Teléfono ni Fecha de alta). Una
 *    fila en "baja" no se reutiliza: se crea una nueva "pendiente" para ese curso.
 *  - Sin DNI nunca se fusiona con otra persona: cada una recibe su propio provisorio.
 *    Si en ese curso ya figura alguien con el mismo nombre sin DNI definitivo, se
 *    rechaza el alta para no crear un gemelo.
 *  - Teléfono: opcional, solo dígitos.
 *
 * Devuelve { dni, nombre, telefono, provisorio } con lo que REALMENTE quedó
 * guardado: el frontend tiene que mostrar esos datos, no lo que se tipeó.
 */
function altaAlumno(cursoId, dniCrudo, apellidoCrudo, nombreCrudo, telefonoCrudo) {
  cursoId = norm(cursoId);
  let dni = normalizeDni(dniCrudo);
  // mayúsculas + sin < > & en cada parte por separado (ver sanitizeNombre),
  // así una inyección repartida entre los dos campos tampoco se cuela al unirlos.
  const apellido = sanitizeNombre(apellidoCrudo).toUpperCase();
  const nombre = sanitizeNombre(nombreCrudo).toUpperCase();
  const nombreCompleto = `${apellido} ${nombre}`.trim();
  const telefono = norm(telefonoCrudo).replace(/\D/g, '');

  if (!cursoExiste(cursoId)) throw new Error(`El curso "${cursoId}" no existe en la hoja Cursos.`);
  if (norm(dniCrudo) && !dni) throw new Error('El DNI ingresado no es válido.');
  if (dni && dni.length < 6) throw new Error('El DNI ingresado no es válido (mínimo 6 dígitos).');
  if (dni && esDniProvisorio(dni)) throw new Error('El DNI no puede empezar con 0. Si no lo tenés, dejá el campo vacío.');
  if (!apellido) throw new Error('Falta el apellido del alumno.');
  if (!nombre) throw new Error('Falta el nombre del alumno.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const existentes = getAlumnosDelCurso(cursoId);

    if (dni) {
      const yaEnCurso = existentes.find(a => a.dni === dni);
      if (yaEnCurso) {
        // Si está de baja en ESTE curso, el mensaje dice cómo reactivarlo en vez de un
        // "ya existe" que parece contradecir lo que se ve en la app.
        throw new Error(yaEnCurso.activo
          ? `Ya existe un alumno con DNI ${dni} en este curso.`
          : `El alumno con DNI ${dni} figura de baja en este curso. Para reactivarlo, borrá "baja" en la columna Estado de la hoja Alumnos.`);
      }
    }

    // Mismo nombre en este curso: si uno de los dos no tiene DNI definitivo no se puede
    // saber si es la misma persona, así que no se crea un gemelo.
    const mismoNombre = existentes.find(a => _claveNombre(a.name) === _claveNombre(nombreCompleto));
    if (mismoNombre) {
      const sinDniDefinitivo = !mismoNombre.dni || esDniProvisorio(mismoNombre.dni);
      if (!dni || sinDniDefinitivo) {
        if (!mismoNombre.activo) {
          throw new Error(`"${mismoNombre.name}" figura de baja en este curso. Para reactivarlo, borrá "baja" en la columna Estado de la hoja Alumnos.`);
        }
        throw new Error(dni
          ? `"${mismoNombre.name}" ya está en este curso sin DNI. Pedile a un preceptor que cargue el DNI en la hoja Alumnos.`
          : `Ya existe "${mismoNombre.name}" en este curso.`);
      }
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

    // ¿El DNI ya tiene fila activa en OTRO curso? Se busca en TODA la hoja y, si aparece, se
    // le suma el curso en vez de crear una fila duplicada. Una fila en "baja" no se reutiliza:
    // el Estado es de toda la fila y el alumno quedaría de baja también en el curso nuevo.
    if (dni) {
      const idxExistente = datos.findIndex(r => normalizeDni(r[iDni]) === dni && norm(r[iEstado]).toLowerCase() !== ESTADO_BAJA);
      if (idxExistente !== -1) {
        const filaSheet = idxExistente + 2; // +1 por el encabezado, +1 porque las filas empiezan en 1
        const cursosActuales = norm(datos[idxExistente][iCurso]).split(',').map(s => norm(s)).filter(Boolean);
        cursosActuales.push(cursoId);
        sheet.getRange(filaSheet, iCurso + 1).setValue(cursosActuales.join(','));
        return {
          dni: dni,
          nombre: norm(datos[idxExistente][iAlumno]),
          telefono: norm(datos[idxExistente][iTelefono]),
          provisorio: false
        };
      }
    }

    const provisorio = !dni;
    if (provisorio) dni = _formatoProvisorio(_maxProvisorio() + 1);

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

    return { dni: dni, nombre: nombreCompleto, telefono: telefono, provisorio: provisorio };
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
    if (normCurso(r[iCurso]) !== normCurso(cursoId)) return;
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
      if (normCurso(r[iCurso]) === normCurso(cursoId) && normalizeFecha(r[iFecha]) === fecha) {
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
 * Pensada para el activador semanal (lo instala instalarActivadores). Revisa "Alumnos" buscando
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
 * Cada línea del aviso dice "[alumno nuevo]" o "[curso]":
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

    // Más de un curso en la celda → ya estaba dado de alta en otro
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
    .map(a => `- ${a.cursoId} · ${a.nombre} (${_dniParaMostrar(a.dni)}) — ${a.dias} día(s) pendiente [${a.origen}]${a.nota}`)
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
// DIAGNÓSTICO Y AUDITORÍA
//
//  - verificarConsistenciaCursos(): manual. Elegila y presioná ▶;
//    el resultado queda en Ver > Registro de ejecuciones. Muestra
//    problemas Y avisos informativos.
//  - auditoriaDiaria(): la misma revisión, para el activador diario (lo instala
//    instalarActivadores). Manda mail SOLO si hay problemas, y no repite el mismo mail todos los días.
// ============================================================

const AUDITORIA_REPETIR_DIAS = 7; // si el problema sigue igual, se vuelve a avisar cada tanto
const ESTADOS_VALIDOS = ['', ESTADO_BAJA, ESTADO_PENDIENTE]; // vacío = activo

/**
 * Revisa Alumnos y Registros y devuelve { problemas, avisos }:
 *  - problemas: cosas que hay que arreglar (van en el mail diario).
 *  - avisos: informativos, pueden ser legítimos (solo en el log manual).
 * No escribe nada.
 */
function _auditarConsistencia() {
  const problemas = [];
  const avisos = [];

  // ---- Alumnos ----
  const alumnos = SS.getSheetByName('Alumnos').getDataRange().getValues();
  const aH = alumnos.shift();
  const iCurso = aH.indexOf('ID Curso');
  const iDni = aH.indexOf('DNI');
  const iAlumno = aH.indexOf('Alumno');
  const iEstado = aH.indexOf('Estado');

  const cSheet = SS.getSheetByName('Cursos').getDataRange().getValues();
  const cH = cSheet.shift();
  const cId = cH.indexOf('ID Curso');
  const idsCursos = new Set(cSheet.map(r => normCurso(r[cId])).filter(Boolean)); // todos, incluso los dados de baja

  const cursosConAlumnos = new Set();
  const cursosDesconocidos = [];       // alumnos anotados en un curso que no existe en "Cursos"
  const sinDniPorCurso = {};
  const filasPorDni = {};              // dni -> [{fila, nombre, cursos, estado}]
  const existentesDni = new Set();     // cualquier fila, cualquier estado (baja incluida)
  const existentesCursoDni = new Set();
  const provisorios = [];              // activos con número provisorio (informativo)
  const cerosViejos = {};              // DNI "0000000" compartido (provisorio viejo)
  const estadosRaros = [];

  alumnos.forEach((r, idx) => {
    const nombre = norm(r[iAlumno]);
    // Multi-curso: "ID Curso" puede traer "curso1,curso2".
    const cursos = norm(r[iCurso]).split(',').map(normCurso).filter(Boolean);
    if (!cursos.length || !nombre) return;

    const fila = idx + 2;
    const estado = norm(r[iEstado]).toLowerCase();
    const activo = estado !== ESTADO_BAJA;
    const dni = normalizeDni(r[iDni]);

    if (ESTADOS_VALIDOS.indexOf(estado) === -1) {
      estadosRaros.push(`fila ${fila} · ${nombre}: Estado "${norm(r[iEstado])}"`);
    }

    cursos.forEach(c => {
      cursosConAlumnos.add(c);
      if (!idsCursos.has(c)) cursosDesconocidos.push(`fila ${fila} · ${nombre}: curso "${c}"`);
      if (activo && !dni) sinDniPorCurso[c] = (sinDniPorCurso[c] || 0) + 1;
    });

    if (!dni) return;
    existentesDni.add(dni);
    cursos.forEach(c => existentesCursoDni.add(c + '|' + dni));

    if (esDniProvisorio(dni)) {
      // Provisorio (empieza con 0): es válido; se informa pero no es un problema.
      if (activo) {
        provisorios.push(`${nombre} (${cursos.join(',')})`);
        if (/^0+$/.test(dni)) (cerosViejos[dni] = cerosViejos[dni] || []).push(`fila ${fila} · ${nombre} (${cursos.join(',')})`);
      }
    } else {
      (filasPorDni[dni] = filasPorDni[dni] || []).push({
        fila: fila, nombre: nombre, cursos: cursos.join(','), estado: estado || 'activo'
      });
    }
  });

  // ---- Registros ----
  const reg = SS.getSheetByName('Registros').getDataRange().getValues();
  const rH = reg.shift();
  const rCurso = rH.indexOf('ID Curso');
  const rFecha = rH.indexOf('Fecha');
  const rDni = rH.indexOf('DNI');
  const rNombre = rH.indexOf('Alumno');

  const combos = {};
  const cursosHuerfanos = {}; // cursos de Registros que ya no están en "Cursos"
  const huerfanos = {};    // DNI que ya no existe en NINGUNA fila de Alumnos
  const fueraDeCurso = {}; // DNI que existe, pero no en ese curso

  reg.forEach(r => {
    if (!norm(r[rCurso]) || !norm(r[rFecha])) return;
    const curso = normCurso(r[rCurso]);
    const dni = normalizeDni(r[rDni]);

    const clave = curso + '|' + normalizeFecha(r[rFecha]) + '|' + dni;
    combos[clave] = (combos[clave] || 0) + 1;
    if (!idsCursos.has(curso)) cursosHuerfanos[curso] = (cursosHuerfanos[curso] || 0) + 1;

    if (!dni) return;
    if (!existentesDni.has(dni)) {
      const h = huerfanos[dni] = huerfanos[dni] || { nombre: norm(r[rNombre]), filas: 0, cursos: new Set() };
      h.filas++;
      h.cursos.add(curso);
    } else if (!existentesCursoDni.has(curso + '|' + dni)) {
      const k = curso + '|' + dni;
      const f = fueraDeCurso[k] = fueraDeCurso[k] || { nombre: norm(r[rNombre]), filas: 0 };
      f.filas++;
    }
  });

  // ---- armado de resultados (lo más grave primero) ----
  const dnisHuerfanos = Object.keys(huerfanos);
  if (dnisHuerfanos.length) {
    const filasTotal = dnisHuerfanos.reduce((a, d) => a + huerfanos[d].filas, 0);
    const lista = dnisHuerfanos.slice(0, 10).map(d => `${d} (${huerfanos[d].nombre || 'sin nombre'})`).join(', ') +
      (dnisHuerfanos.length > 10 ? ` y ${dnisHuerfanos.length - 10} más` : '');
    problemas.push(
      `⚠ ${dnisHuerfanos.length} DNI con asistencia en Registros que ya no figuran en Alumnos (${filasTotal} fila(s) de asistencia): ${lista}. ` +
      `Pasa cuando se borran o reemplazan filas de Alumnos. La asistencia no se perdió (los totales del Resumen siguen bien); ` +
      `lo que falta es vincularla a un alumno. Para repararlo: Asistencia > Mantenimiento > Reparar asistencia sin alumno.`
    );
  }

  cursosDesconocidos.forEach(t => problemas.push(
    `❌ ${t} no existe en la hoja Cursos (¿error de tipeo?) — el alumno no aparece en ningún curso de la app.`
  ));

  // Profesores: un curso mal escrito deja al docente sin acceso, sin ningún error visible.
  const pSheet = SS.getSheetByName('Profesores');
  if (pSheet) {
    const pRows = pSheet.getDataRange().getValues();
    const pH = pRows.shift();
    const pEmail = pH.indexOf('Email');
    const pCursos = pH.indexOf('Cursos');
    pRows.forEach((r, idx) => {
      const email = norm(r[pEmail]);
      const txt = norm(r[pCursos]).toLowerCase();
      if (!email || !txt || txt === 'todos') return;
      const malos = txt.split(',').map(c => normCurso(c)).filter(c => c && !idsCursos.has(c));
      if (malos.length) {
        problemas.push(`⚠ Profesores, fila ${idx + 2} (${email}): curso(s) que no existen en Cursos: ${malos.join(', ')} — no va a ver esos cursos.`);
      }
    });
  }

  const cursos = getCursos({ cursos: ['todos'] }); // acceso total solo para este diagnóstico
  cursos.forEach(c => {
    if (!cursosConAlumnos.has(normCurso(c.id))) {
      problemas.push(`❌ "${c.id}" (${c.nombre}) no tiene ningún alumno cargado en "Alumnos" todavía.`);
    }
    if (sinDniPorCurso[normCurso(c.id)]) {
      problemas.push(`⚠ "${c.id}" (${c.nombre}) tiene ${sinDniPorCurso[normCurso(c.id)]} alumno(s) activos sin DNI ni número provisorio — no aparecen en la app. Se numeran con Asistencia > Asignar número a alumnos sin DNI.`);
    }
  });

  Object.keys(filasPorDni).forEach(dni => {
    const vivas = filasPorDni[dni].filter(x => x.estado !== ESTADO_BAJA);
    if (vivas.length < 2) return; // una fila en "baja" más una activa es normal
    const detalle = vivas.map(x => `fila ${x.fila} (${x.nombre}, ${x.cursos})`).join('; ');
    // Problema solo si el MISMO curso aparece en dos filas vivas; el mismo DNI en cursos
    // distintos es válido (una fila por curso).
    const porCurso = {};
    vivas.forEach(x => x.cursos.split(',').forEach(c => { porCurso[c] = (porCurso[c] || 0) + 1; }));
    const repetidos = Object.keys(porCurso).filter(c => porCurso[c] > 1);
    if (repetidos.length) {
      problemas.push(`⚠ DNI ${dni} repetido en el mismo curso (${repetidos.join(', ')}): ${detalle}. Se unen con Asistencia > Unir alumnos repetidos.`);
    } else {
      const mismoNombre = new Set(vivas.map(x => _claveNombre(x.nombre))).size === 1;
      avisos.push(`ℹ DNI ${dni} está en ${vivas.length} filas de cursos distintos: ${detalle}. ` +
        (mismoNombre ? 'Es válido; si se prefiere una sola fila, Asistencia > Unir alumnos repetidos.'
          : 'Los nombres no coinciden: revisar si el DNI está bien cargado.'));
    }
  });

  estadosRaros.forEach(t => problemas.push(
    `⚠ Estado no reconocido — ${t}. Solo valen vacío (activo), "pendiente" o "baja"; ` +
    `con otro texto el alumno cuenta como activo.`
  ));

  Object.keys(cerosViejos).forEach(d => {
    if (cerosViejos[d].length > 1) {
      problemas.push(`⚠ ${cerosViejos[d].length} alumnos comparten el número provisorio viejo ${d} (${cerosViejos[d].join('; ')}): su asistencia se mezcla. ` +
        `Cargar a cada uno su DNI real, o borrar el DNI de todos menos uno y usar Asistencia > Asignar número a alumnos sin DNI.`);
    }
  });

  Object.keys(combos).forEach(clave => {
    if (combos[clave] > 1) {
      problemas.push(`⚠ Registro duplicado (posible corte a mitad de guardado): "${clave}" aparece ${combos[clave]} veces en Registros.`);
    }
  });

  if (provisorios.length) {
    avisos.push(`ℹ ${provisorios.length} alumno(s) sin DNI definitivo (número provisorio): ` +
      provisorios.slice(0, 10).join('; ') + (provisorios.length > 10 ? ` y ${provisorios.length - 10} más` : '') +
      `. Cuando tengan el DNI real, escribirlo encima del número en Alumnos: la asistencia se traspasa sola.`);
  }

  Object.keys(fueraDeCurso).forEach(k => {
    const f = fueraDeCurso[k];
    const p = k.split('|');
    avisos.push(
      `ℹ DNI ${p[1]} ("${f.nombre}") tiene ${f.filas} fila(s) en Registros del curso "${p[0]}", ` +
      `pero en Alumnos ya no figura en ese curso (¿se lo sacó del curso a propósito?).`
    );
  });

  Object.keys(cursosHuerfanos).forEach(c => avisos.push(
    `ℹ Hay ${cursosHuerfanos[c]} fila(s) en Registros del curso "${c}", que ya no está en la hoja Cursos ` +
    `(si se cerró, mejor ponerle Estado "baja" en Cursos en vez de borrarlo, así sigue apareciendo en el Resumen).`
  ));

  return { problemas: problemas, avisos: avisos };
}

function verificarConsistenciaCursos() {
  const r = _auditarConsistencia();
  const todo = r.problemas.concat(r.avisos);
  Logger.log(todo.length ? todo.join('\n') : 'Sin problemas de consistencia detectados.');
  return r;
}

/**
 * Para el activador diario (lo instala instalarActivadores). Manda mail a REMINDER_EMAIL SOLO si
 * _auditarConsistencia() encuentra problemas, y no repite el mismo
 * mail cada día: guarda una huella del último informe enviado y
 * vuelve a avisar solo si cambió, o si pasaron AUDITORIA_REPETIR_DIAS
 * días con el mismo problema sin resolverse. Cuando todo queda limpio
 * se borra la huella, así que un problema nuevo avisa de inmediato.
 */
function auditoriaDiaria() {
  const props = PropertiesService.getScriptProperties();

  // Lo que se pegó de golpe sin DNI no dispara onEdit: se numera acá, antes de revisar.
  const lock = LockService.getScriptLock();
  if (lock.tryLock(20000)) {
    try {
      const hechos = _asignarProvisorios();
      if (hechos.length) Logger.log(`auditoriaDiaria: se asignó número provisorio a ${hechos.length} alumno(s) sin DNI.`);
    } finally {
      lock.releaseLock();
    }
  }
  const problemas = _auditarConsistencia().problemas;

  if (!problemas.length) {
    props.deleteProperty('AUDITORIA_ULTIMO');
    Logger.log('auditoriaDiaria: sin problemas.');
    return;
  }

  const cuerpoProblemas = problemas.join('\n\n');
  const huella = hashToken(cuerpoProblemas); // SHA-256 hex del texto
  const hoy = todayISO();
  const ultimo = JSON.parse(props.getProperty('AUDITORIA_ULTIMO') || 'null');

  if (ultimo && ultimo.huella === huella) {
    const dias = Math.round((new Date(hoy + 'T00:00:00') - new Date(ultimo.fecha + 'T00:00:00')) / 86400000);
    if (dias < AUDITORIA_REPETIR_DIAS) {
      Logger.log(`auditoriaDiaria: mismos ${problemas.length} problema(s) que el último aviso (${ultimo.fecha}); no se repite el mail.`);
      return;
    }
  }

  MailApp.sendEmail({
    to: REMINDER_EMAIL,
    subject: `Auditoría del sistema de asistencia: ${problemas.length} problema(s)`,
    body: `Auditoría automática del ${hoy}.\n\n${cuerpoProblemas}\n\n` +
      `Recordatorio: para sacar a un alumno NO se borra la fila de "Alumnos" — se pone Estado = "baja" (o se usa Asistencia > Dar de baja). ` +
      `Así su historial de asistencia sigue vinculado y el Resumen cuenta la baja.\n` +
      `Este aviso se repite solo si el informe cambia o pasan ${AUDITORIA_REPETIR_DIAS} días sin resolverlo.`
  });
  props.setProperty('AUDITORIA_ULTIMO', JSON.stringify({ huella: huella, fecha: hoy }));
  Logger.log(`auditoriaDiaria: mail enviado (${problemas.length} problema(s)).`);
}

// ============================================================
// BAJAS — la forma correcta de "eliminar" alumnos.
//
// Nunca se borra la fila: Estado = "baja". Ya lo respetan getRoster,
// getAlumnosDelCurso y el Resumen (la sacan de la Matrícula y la
// cuentan en Bajas). Se puede hacer a mano en la hoja, o en lote con
// estas funciones, que además resuelven el caso multi-curso:
//
//   previsualizarBajas('30123456, 31222333', 'hde')   // no escribe nada
//   darDeBajaAlumnos('30123456, 31222333', 'hde')     // aplica
// (los preceptores lo usan desde el menú Asistencia; ver más abajo)
//
// - DNI separados por coma, espacio o salto de línea (con o sin puntos).
// - cursoId es OPCIONAL pero necesario si el alumno está en más de un
//   curso: si la fila tiene "hde,iecia" y se indica "hde", se le SACA
//   ese curso de la celda (sigue activo en el otro) en vez de ponerlo
//   de baja en todos. Sin cursoId, un alumno multi-curso se saltea y
//   se avisa — nunca se decide por él.
// - Si el alumno tiene un solo curso, queda Estado="baja".
// - No toca Registros ni Registros_Historial.
// ============================================================

function previsualizarBajas(dnisCrudos, cursoId) {
  return _procesarBajas(dnisCrudos, cursoId, false);
}

function darDeBajaAlumnos(dnisCrudos, cursoId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return _procesarBajas(dnisCrudos, cursoId, true);
  } finally {
    lock.releaseLock();
  }
}

function _procesarBajas(dnisCrudos, cursoId, aplicar) {
  const lista = Array.isArray(dnisCrudos) ? dnisCrudos : String(dnisCrudos == null ? '' : dnisCrudos).split(/[\s,;]+/);
  const dnis = Array.from(new Set(lista.map(normalizeDni).filter(Boolean)));
  if (!dnis.length) throw new Error('No se indicó ningún DNI válido.');

  const curso = normCurso(cursoId);
  if (curso && !cursoExiste(curso)) throw new Error(`El curso "${cursoId}" no existe en la hoja Cursos.`);

  const sheet = SS.getSheetByName('Alumnos');
  const datos = sheet.getDataRange().getValues();
  const header = datos.shift();
  const iCurso = header.indexOf('ID Curso');
  const iDni = header.indexOf('DNI');
  const iAlumno = header.indexOf('Alumno');
  const iEstado = header.indexOf('Estado');
  if (iEstado === -1) errorConfiguracion('Falta la columna "Estado" en la hoja Alumnos.');

  const escrituras = []; // { fila, col, valor }
  const informe = [];

  dnis.forEach(dni => {
    const idxs = [];
    datos.forEach((r, i) => { if (normalizeDni(r[iDni]) === dni) idxs.push(i); });

    if (!idxs.length) { informe.push(`❌ ${dni}: no existe en Alumnos — no se tocó.`); return; }
    if (idxs.length > 1) {
      informe.push(`❌ ${dni}: aparece en ${idxs.length} filas (${idxs.map(i => i + 2).join(', ')}) — unirlas primero; no se tocó.`);
      return;
    }

    const r = datos[idxs[0]];
    const fila = idxs[0] + 2;
    const nombre = norm(r[iAlumno]);
    const cursosFila = norm(r[iCurso]).split(',').map(s => norm(s)).filter(Boolean);
    const estado = norm(r[iEstado]).toLowerCase();

    if (curso && !cursosFila.some(c => normCurso(c) === curso)) {
      informe.push(`❌ ${dni} (${nombre}): no está anotado en "${cursoId}" (tiene: ${cursosFila.join(',')}) — no se tocó.`);
      return;
    }
    if (estado === ESTADO_BAJA) { informe.push(`ℹ ${dni} (${nombre}): ya estaba en baja.`); return; }

    if (cursosFila.length > 1) {
      if (!curso) {
        informe.push(`⚠ ${dni} (${nombre}): está en varios cursos (${cursosFila.join(',')}). Indicá el curso para sacarlo solo de ese — no se tocó.`);
        return;
      }
      const restantes = cursosFila.filter(c => normCurso(c) !== curso);
      escrituras.push({ fila: fila, col: iCurso + 1, valor: restantes.join(',') });
      informe.push(`✔ ${dni} (${nombre}): se le sacó el curso "${cursoId}"; sigue en ${restantes.join(',')}.`);
      return;
    }

    escrituras.push({ fila: fila, col: iEstado + 1, valor: ESTADO_BAJA });
    informe.push(`✔ ${dni} (${nombre}): Estado = "baja".`);
  });

  if (aplicar) {
    escrituras.forEach(e => sheet.getRange(e.fila, e.col).setValue(e.valor));
  }
  const resumen = (aplicar ? 'APLICADO' : 'PREVISUALIZACIÓN (no se escribió nada)') + ':\n' + informe.join('\n');
  Logger.log(resumen);
  return resumen;
}

/**
 * Pone una lista desplegable en la columna Estado de
 * "Alumnos" (vacío, "pendiente" o "baja"). Es una AYUDA, no una regla:
 * se elige con un clic y, si alguien escribe otra cosa, Sheets solo
 * muestra una advertencia (no bloquea). Sirve para evitar escribir
 * "de baja", que el sistema no reconocería. No afecta lo que escribe
 * el script (altaAlumno).
 */
function configurarValidacionAlumnos() {
  const sheet = SS.getSheetByName('Alumnos');
  if (!sheet) errorConfiguracion('Falta la hoja "Alumnos".');
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = header.indexOf('Estado') + 1;
  if (!col) errorConfiguracion('Falta la columna "Estado" en la hoja Alumnos.');

  const regla = SpreadsheetApp.newDataValidation()
    .requireValueInList([ESTADO_PENDIENTE, ESTADO_BAJA], true)
    .setAllowInvalid(true) // solo advierte: no bloquea a nadie
    .setHelpText('Vacío = activo. Elegí "baja" para sacar a un alumno (así se conserva su historial).')
    .build();
  sheet.getRange(2, col, sheet.getMaxRows() - 1, 1).setDataValidation(regla);
  Logger.log('Validación de Estado aplicada en la columna ' + col + ' de Alumnos.');
  return 'aplicada en la columna ' + col;
}

// ============================================================
// REPARACIÓN DE HUÉRFANOS — para cuando se BORRAN o REEMPLAZAN varias
// filas de "Alumnos" de golpe (pegar una lista nueva encima, borrar un
// rango, cambiar varios DNI juntos). Google no informa qué había antes
// en cada celda en esos casos, así que ningún activador puede
// reconciliarlo solo: queda la asistencia en "Registros" con un DNI que
// ya no figura en "Alumnos".
//
// Dos pasos, sin escribir nada en el primero:
//   1) previsualizarReparacion()   → muestra qué haría con cada DNI.
//   2) repararHuerfanos()          → lo aplica.
//
// Por cada DNI de Registros que ya no existe en Alumnos:
//  - Si hay UN alumno actual con el mismo nombre en ese mismo curso
//    (sin importar mayúsculas, tildes ni orden), se entiende que fue un
//    cambio de DNI: sus filas de asistencia pasan al DNI actual.
//    Si ese día ya había asistencia con el DNI nuevo, esa fila se
//    saltea (no se pisa nada).
//  - Si no coincide nadie, se entiende que la fila se borró o se la
//    reemplazó por otra persona: se vuelve a crear en Alumnos con
//    Estado "baja", así su historial sigue vinculado y cuenta en Bajas.
//    No aparece en la app (las bajas no figuran en el roster).
//  - Si coincide con VARIOS alumnos, no se toca y se avisa.
// No toca Registros_Historial. Bajo el mismo lock que el guardado de
// asistencia. Es idempotente: correrla dos veces no repite nada.
//
// A propósito NO corre sola dentro de auditoriaDiaria(): si alguien
// borra una fila a propósito, no tiene que reaparecer todos los días.
// ============================================================

// Nombre comparable: sin tildes, mayúsculas, sin signos y sin importar el orden.
function _claveNombre(texto) {
  return norm(texto).toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/).filter(Boolean).sort().join(' ');
}

function previsualizarReparacion() {
  return _repararHuerfanos(false);
}

function repararHuerfanos() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return _repararHuerfanos(true);
  } finally {
    lock.releaseLock();
  }
}

function _repararHuerfanos(aplicar) {
  // ---- Alumnos: qué DNI existen y quién es quién por curso+nombre ----
  const aSheet = SS.getSheetByName('Alumnos');
  const alumnos = aSheet.getDataRange().getValues();
  const aH = alumnos.shift();
  const iCurso = aH.indexOf('ID Curso');
  const iDni = aH.indexOf('DNI');
  const iAlumno = aH.indexOf('Alumno');
  const iEstado = aH.indexOf('Estado');

  const existentesDni = new Set();
  const porNombre = {}; // "curso|claveNombre" -> { dni: nombreActual }
  alumnos.forEach(r => {
    const dni = normalizeDni(r[iDni]);
    const nombre = norm(r[iAlumno]);
    const cursos = norm(r[iCurso]).split(',').map(normCurso).filter(Boolean);
    if (!dni || !nombre || !cursos.length) return;
    existentesDni.add(dni);
    if (esDniProvisorio(dni)) return; // DNI provisorio: no sirve como destino
    const k = _claveNombre(nombre);
    cursos.forEach(c => {
      const key = c + '|' + k;
      (porNombre[key] = porNombre[key] || {})[dni] = nombre;
    });
  });

  // ---- Registros: huérfanos, agrupados por DNI ----
  const reg = SS.getSheetByName('Registros');
  const ultima = reg.getLastRow();
  if (ultima < 2) return 'No hay registros.';
  const datos = reg.getRange(1, 1, ultima, reg.getLastColumn()).getValues();
  const h = datos[0];
  const rCurso = h.indexOf('ID Curso');
  const rFecha = h.indexOf('Fecha');
  const rDni = h.indexOf('DNI');
  const rNombre = h.indexOf('Alumno');

  const ocupadas = new Set(); // curso|fecha|dni ya existentes
  const huerfanos = {};       // dni -> { nombre, cursos: {norm: original}, filas: [índices] }
  for (let i = 1; i < datos.length; i++) {
    const r = datos[i];
    if (!norm(r[rCurso]) || !norm(r[rFecha])) continue;
    const curso = normCurso(r[rCurso]);
    const dni = normalizeDni(r[rDni]);
    if (!dni) continue;
    ocupadas.add(curso + '|' + normalizeFecha(r[rFecha]) + '|' + dni);
    if (!existentesDni.has(dni)) {
      const o = huerfanos[dni] = huerfanos[dni] || { nombre: '', cursos: {}, filas: [] };
      if (norm(r[rNombre])) o.nombre = norm(r[rNombre]);
      o.cursos[curso] = norm(r[rCurso]);
      o.filas.push(i);
    }
  }

  const dnis = Object.keys(huerfanos);
  if (!dnis.length) {
    Logger.log('No hay registros huérfanos: todo DNI de Registros figura en Alumnos.');
    return 'No hay registros huérfanos.';
  }

  // ---- plan ----
  const informe = [];
  const nuevasFilas = [];
  let filasReasignadas = 0;

  dnis.forEach(dni => {
    const o = huerfanos[dni];
    const k = _claveNombre(o.nombre);
    const candidatos = {};
    if (k) {
      Object.keys(o.cursos).forEach(c => {
        const m = porNombre[c + '|' + k];
        if (m) Object.keys(m).forEach(d => { candidatos[d] = m[d]; });
      });
    }
    const ds = Object.keys(candidatos);

    if (ds.length > 1) {
      informe.push(`⚠ ${dni} ("${o.nombre}"): coincide con varios alumnos (${ds.join(', ')}) — no se tocó; resolver a mano.`);
      return;
    }

    if (ds.length === 1) {
      const nuevo = ds[0];
      let movidas = 0;
      let choques = 0;
      o.filas.forEach(i => {
        const r = datos[i];
        const combo = normCurso(r[rCurso]) + '|' + normalizeFecha(r[rFecha]) + '|' + nuevo;
        if (ocupadas.has(combo)) { choques++; return; }
        ocupadas.add(combo);
        r[rDni] = nuevo;
        r[rNombre] = candidatos[nuevo];
        movidas++;
      });
      filasReasignadas += movidas;
      informe.push(`✔ ${dni} ("${o.nombre}") → DNI actual ${nuevo}: ${movidas} fila(s) de asistencia reasignadas` +
        (choques ? `, ${choques} saltadas (ese día ya había asistencia con el DNI nuevo)` : '') + '.');
      return;
    }

    // Ningún alumno actual coincide: fila borrada o reemplazada por otra persona.
    const fila = new Array(aH.length).fill('');
    fila[iCurso] = Object.keys(o.cursos).map(c => o.cursos[c]).join(',');
    fila[iDni] = dni;
    fila[iAlumno] = o.nombre || ('DNI ' + dni);
    fila[iEstado] = ESTADO_BAJA;
    nuevasFilas.push(fila);
    informe.push(`✔ ${dni} ("${o.nombre}"): no coincide con ningún alumno actual → se vuelve a crear en Alumnos con Estado "baja" ` +
      `(curso: ${fila[iCurso]}; ${o.filas.length} fila(s) de asistencia vinculadas).`);
  });

  // ---- aplicar ----
  if (aplicar) {
    if (filasReasignadas) {
      const n = datos.length - 1;
      const rangoDni = reg.getRange(2, rDni + 1, n, 1);
      rangoDni.setNumberFormat('@');
      rangoDni.setValues(datos.slice(1).map(r => [r[rDni]]));
      reg.getRange(2, rNombre + 1, n, 1).setValues(datos.slice(1).map(r => [r[rNombre]]));
    }
    if (nuevasFilas.length) {
      const primera = aSheet.getLastRow() + 1;
      aSheet.getRange(primera, iDni + 1, nuevasFilas.length, 1).setNumberFormat('@');
      aSheet.getRange(primera, 1, nuevasFilas.length, aH.length).setValues(nuevasFilas);
    }
  }

  const resumen = (aplicar ? 'APLICADO' : 'PREVISUALIZACIÓN (no se escribió nada)') +
    ` — ${dnis.length} DNI huérfano(s):\n` + informe.join('\n');
  Logger.log(resumen);
  return resumen;
}

// ============================================================
// CORRECCIÓN DE DNI — a mano, para un alumno dado de alta con el DNI mal
// cargado (typo) o con número provisorio. Corregir el DNI directamente en la
// hoja Alumnos ya lo hace solo (onEditAlumnos); esto queda para los casos que
// el activador no cubre (pegados de varias celdas).
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
 * vía IMPORTRANGE). Bajo
 * el mismo lock que usan altaAlumno/saveAttendance, así no corre al
 * mismo tiempo que alguien está guardando asistencia.
 *
 * DELIBERADAMENTE NO TOCA Registros_Historial. Esa hoja es, por
 * diseño, una bitácora de lo que efectivamente se cargó y cuándo (ver
 * "es bitácora, no vista actual") — reescribirla
 * falsificaría el registro de que esas filas se guardaron en su
 * momento con el DNI viejo. Si algún día hace falta rastrear el
 * historial completo de un alumno con DNI corregido, hay que buscar
 * tanto el DNI nuevo (en Registros) como el viejo (en
 * Registros_Historial) — es el costo de mantener la bitácora honesta.
 *
 * De paso refresca el nombre en Registros al valor actual de Alumnos
 * — si el DNI estaba mal por venir de un alta apurada, la
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
// SINCRONIZACIÓN AUTOMÁTICA (Alumnos → Registros) — activador instalable.
// Lo deja instalado instalarActivadores(); no corre solo hasta entonces.
// ============================================================

/**
 * Activador "Al editar" sobre toda la planilla; filtra y actúa solo sobre ediciones
 * de UNA celda en las columnas DNI, Alumno o ID Curso de la hoja "Alumnos":
 *  - DNI pisado por otro: la asistencia ya guardada pasa al DNI nuevo (solo en los
 *    cursos de esa fila). Si el DNI nuevo ya es de otra persona, revierte y avisa.
 *  - DNI borrado y escrito después (son dos ediciones): se completa igual, ver abajo.
 *  - Alumno corregido: se actualiza el nombre en Registros.
 *  - Fila nueva con curso y nombre pero sin DNI: se le asigna un número provisorio.
 * NO cubre pegados de varias celdas ni filas borradas (Google no informa qué había
 * antes): de eso se ocupan la auditoría diaria y "Reparar asistencia sin alumno".
 * No toca Registros_Historial (bitácora, no vista actual).
 */
function onEditAlumnos(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    if (sheet.getName() !== 'Alumnos') return;
    if (e.range.getNumRows() > 1 || e.range.getNumColumns() > 1) return; // edición múltiple: no tocar
    const fila = e.range.getRow();
    if (fila === 1) return; // encabezado

    const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const iDni = header.indexOf('DNI') + 1;
    const iAlumno = header.indexOf('Alumno') + 1;
    const iCurso = header.indexOf('ID Curso') + 1;
    const col = e.range.getColumn();
    if (col !== iDni && col !== iAlumno && col !== iCurso) return;

    const viejo = e.oldValue === undefined ? '' : String(e.oldValue);
    const nuevo = e.value === undefined ? '' : String(e.value);

    if (col === iDni && !viejo && !nuevo) return;   // nada cambió
    if (col === iCurso && viejo) return;            // cambiar el curso de un alumno ya cargado: no se toca

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) {
      Logger.log(`onEditAlumnos: el sistema estaba ocupado y no se pudo procesar el cambio de la fila ${fila}. ` +
        'Si fue un cambio de DNI, la auditoría diaria lo va a detectar.');
      return;
    }

    try {
      if (col === iDni) {
        if (viejo && nuevo) _sincronizarCambioDni(sheet, fila, header, viejo, nuevo);   // pisó el DNI
        else if (viejo) _recordarDniBorrado(sheet, fila, header, viejo);                // lo borró: anotar cuál era
        else _retomarDniBorrado(sheet, fila, header, nuevo);                            // lo escribió de nuevo
      } else if (col === iAlumno && viejo) {
        _sincronizarCambioNombre(sheet, fila, header, e.value);
      } else {
        // Nombre o curso cargado por primera vez: si la fila ya tiene los dos y no
        // tiene DNI, se le asigna el provisorio para que aparezca en la app.
        const hechos = _asignarProvisorios(fila);
        if (hechos.length) Logger.log(`onEditAlumnos: fila ${fila} (${hechos[0].nombre}) sin DNI → provisorio ${hechos[0].dni}.`);
      }
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    Logger.log('onEditAlumnos — error: ' + (err.message || err));
    _avisarErrorSincronizacion(err);
  }
}

// Un error que se repite en cada edición no tiene que mandar un mail por edición:
// máximo uno por hora (el resto queda en el Registro de ejecuciones).
const ERROR_MAIL_INTERVALO_MS = 60 * 60 * 1000;

function _avisarErrorSincronizacion(err) {
  const props = PropertiesService.getScriptProperties();
  const ultimo = Number(props.getProperty('ONEDIT_ERROR_MAIL') || 0);
  if (Date.now() - ultimo < ERROR_MAIL_INTERVALO_MS) {
    Logger.log('onEditAlumnos: mail de error omitido (ya se avisó hace menos de 1 hora).');
    return;
  }
  props.setProperty('ONEDIT_ERROR_MAIL', String(Date.now()));
  MailApp.sendEmail({
    to: REMINDER_EMAIL,
    subject: 'Error en sincronización automática de Alumnos',
    body: 'onEditAlumnos tuvo un error al sincronizar un cambio con Registros:\n\n' +
      (err.message || err) + '\n\nRevisar con Asistencia > Revisar el sistema ahora. ' +
      '(Este aviso se manda como máximo una vez por hora.)'
  });
}

// ---------- DNI borrado y vuelto a escribir ----------
//
// Borrar un DNI y tipear otro son dos ediciones: en la segunda Google ya no
// informa cuál era el valor anterior. Por eso, al BORRAR se anota qué DNI tenía
// esa persona, identificada por nombre + curso(s) (no por número de fila, que
// cambia si ordenan o insertan filas), y al ESCRIBIR uno nuevo en la fila de la
// misma persona se completa la sincronización como si hubiera sido una sola
// edición. Las anotaciones vencen a los DNI_BORRADOS_DIAS días.

const DNI_BORRADOS_KEY = 'DNI_BORRADOS';
const DNI_BORRADOS_DIAS = 7;

function _claveFilaAlumno(sheet, fila, header) {
  const nombre = _claveNombre(sheet.getRange(fila, header.indexOf('Alumno') + 1).getValue());
  const cursos = _cursosDeFilaAlumnos(sheet, fila, header).sort().join(',');
  return nombre && cursos ? nombre + '|' + cursos : '';
}

function _leerDnisBorrados() {
  const mapa = JSON.parse(PropertiesService.getScriptProperties().getProperty(DNI_BORRADOS_KEY) || '{}');
  const limite = Date.now() - DNI_BORRADOS_DIAS * 86400000;
  Object.keys(mapa).forEach(k => { if (mapa[k].ts < limite) delete mapa[k]; });
  return mapa;
}

function _guardarDnisBorrados(mapa) {
  PropertiesService.getScriptProperties().setProperty(DNI_BORRADOS_KEY, JSON.stringify(mapa));
}

function _recordarDniBorrado(sheet, fila, header, dniViejoCrudo) {
  const dni = normalizeDni(dniViejoCrudo);
  const clave = _claveFilaAlumno(sheet, fila, header);
  if (!dni || !clave) return;
  const mapa = _leerDnisBorrados();
  // Dos personas con el mismo nombre y curso con el DNI borrado a la vez: no se
  // puede saber cuál es cuál → se marca ambiguo (dni:null) y no se sincroniza.
  mapa[clave] = (mapa[clave] && mapa[clave].dni !== dni) ? { dni: null, ts: Date.now() } : { dni: dni, ts: Date.now() };
  _guardarDnisBorrados(mapa);
  Logger.log(`onEditAlumnos: DNI ${dni} borrado en la fila ${fila}; queda anotado por si se vuelve a escribir.`);
}

function _retomarDniBorrado(sheet, fila, header, dniNuevoCrudo) {
  const clave = _claveFilaAlumno(sheet, fila, header);
  if (!clave) return;
  const mapa = _leerDnisBorrados();
  const anotado = mapa[clave];
  if (!anotado) return; // alta nueva normal: no había nada anotado para esta persona
  delete mapa[clave];
  _guardarDnisBorrados(mapa);

  if (!anotado.dni) {
    Logger.log(`onEditAlumnos: DNI nuevo en la fila ${fila} pero hay varias personas con ese nombre y curso; no se sincronizó (usar repararHuerfanos).`);
    return;
  }
  if (anotado.dni === normalizeDni(dniNuevoCrudo)) return; // volvió a escribir el mismo
  _sincronizarCambioDni(sheet, fila, header, anotado.dni, dniNuevoCrudo);
}

// ============================================================
// ACTIVADORES — instalarActivadores(): correr UNA vez desde el editor (con la
// cuenta que va a ser dueña de los activadores). Deja instalados los tres que
// usa el sistema y es seguro correrla de nuevo: no duplica los que ya existen.
//   - onEditAlumnos     → al editar la planilla (sincroniza Alumnos → Registros)
//   - revisarPendientes → semanal (recordatorio de alumnos pendientes)
//   - auditoriaDiaria   → diario (auditoría, mail solo si hay problemas)
// Solo administra esos tres por nombre: cualquier otro activador (por ejemplo
// el de la copia de seguridad) no se toca. Si un activador nuestro está
// repetido, borra las copias de más y deja una. Si ya existe uno con otro
// horario, lo respeta.
// Límite de Google: getProjectTriggers() solo ve los activadores de la cuenta
// que ejecuta la función; correrla siempre con la misma cuenta.
// ============================================================

const ACTIVADOR_AUDITORIA_HORA = 7;   // se ejecuta entre las 7 y las 8
const ACTIVADOR_SEMANAL_HORA = 8;     // lunes, entre las 8 y las 9

function instalarActivadores() {
  const deseados = [
    {
      fn: 'onEditAlumnos',
      desc: 'al editar la planilla',
      crear: () => ScriptApp.newTrigger('onEditAlumnos').forSpreadsheet(SS).onEdit().create()
    },
    {
      fn: 'revisarPendientes',
      desc: 'lunes ~' + ACTIVADOR_SEMANAL_HORA + ':00',
      crear: () => ScriptApp.newTrigger('revisarPendientes').timeBased()
        .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(ACTIVADOR_SEMANAL_HORA).inTimezone(TZ).create()
    },
    {
      fn: 'auditoriaDiaria',
      desc: 'todos los días ~' + ACTIVADOR_AUDITORIA_HORA + ':00',
      crear: () => ScriptApp.newTrigger('auditoriaDiaria').timeBased()
        .everyDays(1).atHour(ACTIVADOR_AUDITORIA_HORA).inTimezone(TZ).create()
    }
  ];

  const existentes = ScriptApp.getProjectTriggers();
  const informe = [];

  deseados.forEach(d => {
    const propios = existentes.filter(t => t.getHandlerFunction() === d.fn);
    if (propios.length === 0) {
      d.crear();
      informe.push(`+ Creado: ${d.fn} (${d.desc})`);
      return;
    }
    informe.push(`= Ya existía: ${d.fn}`);
    propios.slice(1).forEach(t => {
      ScriptApp.deleteTrigger(t);
      informe.push(`- Duplicado eliminado: ${d.fn}`);
    });
  });

  const nuestros = deseados.map(d => d.fn);
  existentes
    .filter(t => nuestros.indexOf(t.getHandlerFunction()) === -1)
    .forEach(t => informe.push(`· No se toca: ${t.getHandlerFunction()}`));

  const resumen = informe.join('\n');
  Logger.log(resumen);
  return resumen;
}

// Cursos (normalizados) de una fila de Alumnos.
function _cursosDeFilaAlumnos(sheet, fila, header) {
  return norm(sheet.getRange(fila, header.indexOf('ID Curso') + 1).getValue())
    .split(',').map(normCurso).filter(Boolean);
}

// Filas de Registros con ese DNI, limitadas a los cursos que cumplan
// el predicado (null = todos). Sirve para que, cuando una misma persona
// tiene una fila por curso en Alumnos, corregir una fila no arrastre la
// asistencia del otro curso.
function _filasRegistrosConDni(dni, predicadoCurso) {
  const info = _filasConDni('Registros', dni, 'DNI');
  if (!predicadoCurso || !info.sheet || !info.filas.length) return info;
  const iCurso = info.header.indexOf('ID Curso');
  const vals = info.sheet.getRange(2, iCurso + 1, info.sheet.getLastRow() - 1, 1).getValues();
  info.filas = info.filas.filter(f => predicadoCurso(normCurso(vals[f - 2][0])));
  return info;
}

function _sincronizarCambioDni(sheet, fila, header, dniViejoCrudo, dniNuevoCrudo) {
  const dniViejo = normalizeDni(dniViejoCrudo);
  const dniNuevo = normalizeDni(dniNuevoCrudo);
  if (!dniViejo || !dniNuevo || dniViejo === dniNuevo) return;

  const iAlumno = header.indexOf('Alumno');
  const nombreActual = norm(sheet.getRange(fila, iAlumno + 1).getValue());

  // ¿El DNI nuevo ya le pertenece a OTRO alumno? No fusionar solo:
  // revertir la celda en Alumnos y avisar por mail — mismo criterio de
  // seguridad que corregirDni(). Si esa otra fila tiene el MISMO
  // nombre es la misma persona anotada en otro curso (una fila por
  // curso) y no es un choque: se corrige el segundo DNI sin trabas.
  const otros = _filasConDni('Alumnos', dniNuevo, 'DNI').filas.filter(f => f !== fila)
    .filter(f => _claveNombre(sheet.getRange(f, iAlumno + 1).getValue()) !== _claveNombre(nombreActual));
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

  // Si OTRA fila de Alumnos todavía tiene el DNI viejo (la misma persona
  // en otro curso), solo se mueve la asistencia de los cursos que NO son de
  // esa otra fila. Si no hay otra fila, se mueve todo, como antes.
  const otrasConViejo = _filasConDni('Alumnos', dniViejo, 'DNI').filas.filter(f => f !== fila);
  let cursosDeOtras = null;
  if (otrasConViejo.length) {
    cursosDeOtras = new Set();
    otrasConViejo.forEach(f => _cursosDeFilaAlumnos(sheet, f, header).forEach(c => cursosDeOtras.add(c)));
  }
  const registros = _filasRegistrosConDni(dniViejo, cursosDeOtras ? (c => !cursosDeOtras.has(c)) : null);
  _aplicarCorreccionDni(registros, dniNuevo, nombreActual);
  Logger.log(`onEditAlumnos: DNI ${dniViejo} → ${dniNuevo} sincronizado en ${registros.filas.length} fila(s) de Registros` +
    (cursosDeOtras ? ' (solo los cursos de esta fila; el DNI viejo sigue en otra fila de Alumnos).' : '.'));
}

function _sincronizarCambioNombre(sheet, fila, header, nombreNuevoCrudo) {
  const iDni = header.indexOf('DNI');
  const dni = normalizeDni(sheet.getRange(fila, iDni + 1).getValue());
  if (!dni) return; // sin DNI todavía, nada que sincronizar

  const nombreNuevo = norm(nombreNuevoCrudo);
  if (!nombreNuevo) return;

  // Si la misma persona tiene otra fila (otro curso), el nombre nuevo
  // solo se aplica a los cursos de ESTA fila: cada curso usa el nombre de su fila.
  const hayOtras = _filasConDni('Alumnos', dni, 'DNI').filas.some(f => f !== fila);
  const misCursos = hayOtras ? new Set(_cursosDeFilaAlumnos(sheet, fila, header)) : null;
  const registros = _filasRegistrosConDni(dni, misCursos ? (c => misCursos.has(c)) : null);
  _aplicarCorreccionDni(registros, dni, nombreNuevo); // mismo DNI, solo refresca el nombre
  Logger.log(`onEditAlumnos: nombre actualizado a "${nombreNuevo}" en ${registros.filas.length} fila(s) de Registros (DNI ${dni}).`);
}

// ============================================================
// BAJAS POR FILA, UNIR REPETIDOS Y MENÚ "Asistencia"
// ============================================================

// Baja de filas concretas de Alumnos (las que el preceptor seleccionó). Estado = "baja";
// si el alumno está en varios cursos queda de baja en todos (para sacarlo de uno solo
// está darDeBajaAlumnos con cursoId). No toca Registros. Devuelve el resumen.
function _bajasPorFilas(filas, aplicar) {
  const sheet = SS.getSheetByName('Alumnos');
  const datos = sheet.getDataRange().getValues();
  const header = datos.shift();
  const iCurso = header.indexOf('ID Curso');
  const iAlumno = header.indexOf('Alumno');
  const iEstado = header.indexOf('Estado');
  if (iEstado === -1) errorConfiguracion('Falta la columna "Estado" en la hoja Alumnos.');

  const res = { aBaja: 0, yaBaja: 0, multi: 0, lista: [] };
  filas.forEach(fila => {
    if (fila < 2 || fila > datos.length + 1) return;
    const r = datos[fila - 2];
    const nombre = norm(r[iAlumno]);
    if (!nombre) return;
    if (norm(r[iEstado]).toLowerCase() === ESTADO_BAJA) { res.yaBaja++; return; }
    const cursos = norm(r[iCurso]).split(',').map(s => norm(s)).filter(Boolean);
    if (cursos.length > 1) res.multi++;
    res.aBaja++;
    res.lista.push(`${nombre} (${cursos.join(',')})`);
    if (aplicar) sheet.getRange(fila, iEstado + 1).setValue(ESTADO_BAJA);
  });
  return res;
}

function darDeBajaFilas(filas) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return _bajasPorFilas(filas, true);
  } finally {
    lock.releaseLock();
  }
}

// Une las filas repetidas de un mismo alumno (mismo DNI real, activo) en una sola, con
// todos sus cursos ("curso1,curso2"). No une: provisorios, filas en baja ni DNI repetido
// con nombres distintos (probable error de tipeo; se informa). En la fila que se queda,
// Estado vacío si alguna estaba confirmada; el resto de las columnas toma el primer dato
// no vacío. Registros no se toca (se vincula por DNI, que no cambia). Es lo único que
// borra filas de Alumnos.
function _unirRepetidos(aplicar) {
  const sheet = SS.getSheetByName('Alumnos');
  const datos = sheet.getDataRange().getValues();
  const header = datos.shift();
  const iCurso = header.indexOf('ID Curso');
  const iDni = header.indexOf('DNI');
  const iAlumno = header.indexOf('Alumno');
  const iEstado = header.indexOf('Estado');
  const iFechaAlta = header.indexOf('Fecha de alta');
  if (iCurso === -1 || iDni === -1 || iAlumno === -1 || iEstado === -1) errorConfiguracion('Faltan columnas en la hoja Alumnos.');

  const grupos = {};
  datos.forEach((r, idx) => {
    const dni = normalizeDni(r[iDni]);
    if (!dni || esDniProvisorio(dni) || !norm(r[iAlumno]) || !norm(r[iCurso])) return;
    if (norm(r[iEstado]).toLowerCase() === ESTADO_BAJA) return;
    (grupos[dni] = grupos[dni] || []).push(idx);
  });

  const informe = [];
  const omitidos = [];
  const escrituras = [];
  const aBorrar = [];

  Object.keys(grupos).forEach(dni => {
    const idxs = grupos[dni];
    if (idxs.length < 2) return;
    const filas = idxs.map(i => datos[i]);
    const nombres = Array.from(new Set(filas.map(r => norm(r[iAlumno]))));
    if (new Set(filas.map(r => _claveNombre(r[iAlumno]))).size > 1) {
      omitidos.push(`DNI ${dni}: tiene nombres distintos (${nombres.join(' / ')}) — no se unió; revisar si el DNI está bien.`);
      return;
    }

    const vistos = new Set();
    const cursos = [];
    filas.forEach(r => norm(r[iCurso]).split(',').map(s => norm(s)).filter(Boolean).forEach(c => {
      if (!vistos.has(normCurso(c))) { vistos.add(normCurso(c)); cursos.push(c); }
    }));

    const destino = idxs[0];
    const original = datos[destino];
    const nueva = original.slice();
    for (let c = 0; c < nueva.length; c++) {
      if (c === iCurso) nueva[c] = cursos.join(',');
      else if (c === iEstado) nueva[c] = filas.some(r => !norm(r[iEstado])) ? '' : ESTADO_PENDIENTE;
      else if (c === iFechaAlta) {
        const fechas = filas.map(r => norm(r[c])).filter(Boolean).sort();
        nueva[c] = fechas.length ? fechas[0] : '';
      } else {
        const primero = filas.map(r => r[c]).find(v => norm(v) !== '');
        nueva[c] = primero === undefined ? original[c] : primero;
      }
    }
    for (let c = 0; c < nueva.length; c++) {
      if (norm(nueva[c]) !== norm(original[c])) escrituras.push({ fila: destino + 2, col: c + 1, valor: nueva[c] });
    }
    idxs.slice(1).forEach(i => aBorrar.push(i + 2));
    informe.push(`${nombres[0]} (DNI ${dni}): filas ${idxs.map(i => i + 2).join(' y ')} → una sola, cursos ${cursos.join(',')}.`);
  });

  if (aplicar) {
    escrituras.forEach(w => sheet.getRange(w.fila, w.col).setValue(w.valor));
    aBorrar.sort((a, b) => b - a).forEach(f => sheet.deleteRow(f));
  }
  return { informe: informe, omitidos: omitidos, filasABorrar: aBorrar.length };
}

function unirAlumnosRepetidos() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const r = _unirRepetidos(true);
    Logger.log(`Unir repetidos: ${r.informe.length} alumno(s) unidos.\n` + r.informe.concat(r.omitidos).join('\n'));
    return r;
  } finally {
    lock.releaseLock();
  }
}

// ---------- menú ----------

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Asistencia')
    .addItem('Dar de baja las filas seleccionadas', 'menuDarDeBajaSeleccion')
    .addItem('Dar de baja por lista de DNI…', 'menuDarDeBajaLista')
    .addItem('Unir alumnos repetidos…', 'menuUnirRepetidos')
    .addItem('Asignar número a alumnos sin DNI', 'menuAsignarProvisorios')
    .addSeparator()
    .addItem('Revisar el sistema ahora', 'menuAuditar')
    .addSubMenu(ui.createMenu('Mantenimiento')
      .addItem('Reparar asistencia sin alumno…', 'menuReparar')
      .addItem('Preparar la planilla (colores, listas, instrucciones)…', 'menuPrepararPlanilla')
      .addItem('Instalar activadores (solo administrador)…', 'menuInstalarActivadores'))
    .addToUi();
}

function _recortar(texto, max) {
  texto = String(texto);
  return texto.length > max ? texto.slice(0, max) + '\n…(sigue; ver Ejecuciones en Apps Script)' : texto;
}

function _manejarErrorMenu(ui, err) {
  Logger.log('Menú — error: ' + (err.message || err));
  ui.alert('No se pudo completar', String(err.message || err), ui.ButtonSet.OK);
}

function menuDarDeBajaSeleccion() {
  const ui = SpreadsheetApp.getUi();
  try {
    const sheet = SpreadsheetApp.getActiveSheet();
    const rango = SpreadsheetApp.getActiveRange();
    if (sheet.getName() !== 'Alumnos' || !rango) {
      ui.alert('Dar de baja', 'Primero seleccioná, en la hoja Alumnos, las filas de los alumnos que querés dar de baja.', ui.ButtonSet.OK);
      return;
    }
    const filas = [];
    for (let f = rango.getRow(); f <= rango.getLastRow(); f++) filas.push(f);

    const vista = _bajasPorFilas(filas, false);
    if (!vista.aBaja) {
      ui.alert('Dar de baja', vista.yaBaja ? 'Los alumnos seleccionados ya están de baja.' : 'No hay alumnos en las filas seleccionadas.', ui.ButtonSet.OK);
      return;
    }
    const lista = vista.lista.slice(0, 15).join('\n') + (vista.lista.length > 15 ? `\n…y ${vista.lista.length - 15} más` : '');
    const aviso = vista.multi ? `\n\n${vista.multi} de ellos están en más de un curso y quedarán de baja en TODOS.` : '';
    const resp = ui.alert('Dar de baja',
      `Se van a dar de baja ${vista.aBaja} alumno(s):\n\n${lista}${aviso}\n\nSu asistencia ya guardada no se toca. ¿Continuar?`,
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
    const res = darDeBajaFilas(filas);
    ui.alert('Listo', `Se dieron de baja ${res.aBaja} alumno(s).`, ui.ButtonSet.OK);
  } catch (err) { _manejarErrorMenu(ui, err); }
}

function menuDarDeBajaLista() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r1 = ui.prompt('Dar de baja por lista de DNI', 'Pegá los DNI (separados por coma o espacio).', ui.ButtonSet.OK_CANCEL);
    if (r1.getSelectedButton() !== ui.Button.OK) return;
    const r2 = ui.prompt('Curso (opcional)',
      'Si algún alumno está en más de un curso, escribí el ID del curso del que querés sacarlo (sigue en los otros). Dejalo vacío para darlos de baja por completo.',
      ui.ButtonSet.OK_CANCEL);
    if (r2.getSelectedButton() !== ui.Button.OK) return;
    const dnis = r1.getResponseText();
    const curso = r2.getResponseText();

    const vista = previsualizarBajas(dnis, curso);
    const resp = ui.alert('Dar de baja', _recortar(vista, 1500) + '\n\n¿Aplicar?', ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
    ui.alert('Listo', _recortar(darDeBajaAlumnos(dnis, curso), 1500), ui.ButtonSet.OK);
  } catch (err) { _manejarErrorMenu(ui, err); }
}

function menuUnirRepetidos() {
  const ui = SpreadsheetApp.getUi();
  try {
    const vista = _unirRepetidos(false);
    if (!vista.informe.length) {
      ui.alert('Unir alumnos repetidos',
        'No hay alumnos repetidos para unir.' + (vista.omitidos.length ? '\n\nA revisar a mano:\n' + vista.omitidos.join('\n') : ''),
        ui.ButtonSet.OK);
      return;
    }
    const texto = `Se van a unir ${vista.informe.length} alumno(s) (quedan en una sola fila con todos sus cursos):\n\n` +
      vista.informe.slice(0, 12).join('\n') + (vista.informe.length > 12 ? `\n…y ${vista.informe.length - 12} más` : '') +
      (vista.omitidos.length ? '\n\nNo se unen (revisar a mano):\n' + vista.omitidos.slice(0, 5).join('\n') : '') +
      '\n\nSe borran las filas sobrantes; la asistencia no se toca. ¿Continuar?';
    if (ui.alert('Unir alumnos repetidos', _recortar(texto, 2000), ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    const r = unirAlumnosRepetidos();
    ui.alert('Listo', `Se unieron ${r.informe.length} alumno(s).`, ui.ButtonSet.OK);
  } catch (err) { _manejarErrorMenu(ui, err); }
}

function menuAsignarProvisorios() {
  const ui = SpreadsheetApp.getUi();
  try {
    const hechos = asignarProvisorios();
    ui.alert('Alumnos sin DNI',
      hechos.length ? `Se asignó un número provisorio a ${hechos.length} alumno(s). Cuando tengan el DNI real, escribilo encima del número.`
        : 'Todos los alumnos activos ya tienen DNI o número provisorio.', ui.ButtonSet.OK);
  } catch (err) { _manejarErrorMenu(ui, err); }
}

function menuAuditar() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = _auditarConsistencia();
    const lineas = r.problemas.concat(r.avisos);
    ui.alert(r.problemas.length ? `Se encontraron ${r.problemas.length} problema(s)` : 'Todo en orden',
      lineas.length ? _recortar(lineas.join('\n\n'), 2500) : 'No se detectaron problemas de consistencia.', ui.ButtonSet.OK);
  } catch (err) { _manejarErrorMenu(ui, err); }
}

function menuReparar() {
  const ui = SpreadsheetApp.getUi();
  try {
    const vista = previsualizarReparacion();
    if (/^No hay/.test(String(vista))) { ui.alert('Reparar asistencia', String(vista), ui.ButtonSet.OK); return; }
    if (ui.alert('Reparar asistencia', _recortar(vista, 2000) + '\n\n¿Aplicar?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
    ui.alert('Listo', _recortar(repararHuerfanos(), 2000), ui.ButtonSet.OK);
  } catch (err) { _manejarErrorMenu(ui, err); }
}

function menuPrepararPlanilla() {
  const ui = SpreadsheetApp.getUi();
  try {
    const resp = ui.alert('Preparar la planilla',
      'Aplica la lista desplegable de Estado, los colores de alumnos repetidos, las fórmulas del Resumen sin tope de filas y actualiza la hoja Instrucciones. ' +
      'No toca datos de alumnos ni de asistencia. ¿Continuar?', ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
    ui.alert('Listo', _recortar(prepararPlanilla(), 2000), ui.ButtonSet.OK);
  } catch (err) { _manejarErrorMenu(ui, err); }
}

function menuInstalarActivadores() {
  const ui = SpreadsheetApp.getUi();
  try {
    const resp = ui.alert('Instalar activadores',
      'Esto lo tiene que hacer UNA sola vez la persona dueña del sistema: los activadores quedan a nombre de quien lo ejecuta. ¿Continuar?', ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
    ui.alert('Activadores', _recortar(instalarActivadores(), 1500), ui.ButtonSet.OK);
  } catch (err) { _manejarErrorMenu(ui, err); }
}

// ============================================================
// PREPARAR LA PLANILLA — una función que aplica (y se puede repetir sin problema):
//  1. lista desplegable en Estado de Alumnos,
//  2. colores de alumnos repetidos,
//  3. borra las notas viejas de "fila 2 es ejemplo" de los encabezados,
//  4. fórmulas del Resumen sin tope de filas,
//  5. deja al día la hoja Instrucciones.
// No toca datos de alumnos ni de asistencia. Menú: Asistencia > Mantenimiento.
// ============================================================

function prepararPlanilla() {
  const pasos = [
    ['Lista desplegable en Estado', configurarValidacionAlumnos],
    ['Colores de alumnos repetidos', configurarFormatoAlumnos],
    ['Notas viejas de encabezados', limpiarNotasObsoletas],
    ['Fórmulas del Resumen sin tope de filas', ampliarRangosResumen],
    ['Hoja Instrucciones', actualizarInstrucciones]
  ];
  const informe = pasos.map(p => {
    try { return `✔ ${p[0]}: ${p[1]() || 'listo'}`; }
    catch (err) { return `❌ ${p[0]}: ${err.message || err}`; }
  }).join('\n');
  Logger.log(informe);
  return informe;
}

function _letraColumna(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// Colores apagados, pensados para leerse bien sin cansar.
const FORMATO_REPETIDO_MISMO_CURSO = { fondo: '#EBCFCB', texto: '#7A2E26' };   // rojo apagado
const FORMATO_DNI_EN_DOS_FILAS = { fondo: '#F3E0C7', texto: '#7A5016' };        // naranja apagado

// Rojo: mismo DNI en el MISMO curso (fila repetida, conviene unirla).
// Naranja: mismo DNI en dos filas (puede estar bien si son cursos distintos).
// Las filas en baja no cuentan.
function configurarFormatoAlumnos() {
  const sheet = SS.getSheetByName('Alumnos');
  if (!sheet) errorConfiguracion('Falta la hoja "Alumnos".');
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const iCurso = header.indexOf('ID Curso') + 1;
  const iDni = header.indexOf('DNI') + 1;
  const iEstado = header.indexOf('Estado') + 1;
  if (!iCurso || !iDni || !iEstado) errorConfiguracion('Faltan columnas ID Curso, DNI o Estado en la hoja Alumnos.');
  const C = _letraColumna(iCurso), D = _letraColumna(iDni), E = _letraColumna(iEstado);

  const rojo = `=AND($${D}2<>"",$${E}2<>"baja",COUNTIFS($${D}$2:$${D},$${D}2,$${C}$2:$${C},$${C}2,$${E}$2:$${E},"<>baja")>1)`;
  const naranja = `=AND($${D}2<>"",$${E}2<>"baja",COUNTIFS($${D}$2:$${D},$${D}2,$${E}$2:$${E},"<>baja")>1)`;

  const ancho = Math.max(sheet.getLastColumn(), 6);
  const rango = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), ancho);
  const crear = (formula, f) => SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(formula).setBackground(f.fondo).setFontColor(f.texto).setRanges([rango]).build();

  // Si ya estaban puestas (corrida anterior), se reemplazan; las reglas ajenas se respetan.
  const ajenas = sheet.getConditionalFormatRules().filter(r => {
    const cond = r.getBooleanCondition && r.getBooleanCondition();
    const v = cond && cond.getCriteriaValues && cond.getCriteriaValues()[0];
    return v !== rojo && v !== naranja;
  });
  sheet.setConditionalFormatRules([crear(rojo, FORMATO_REPETIDO_MISMO_CURSO), crear(naranja, FORMATO_DNI_EN_DOS_FILAS)].concat(ajenas));
  return 'rojo = repetido en el mismo curso, naranja = mismo DNI en dos filas';
}

// Borra las notas "← fila 2 es ejemplo…" que quedaron en los encabezados.
function limpiarNotasObsoletas() {
  let borradas = 0;
  ['Cursos', 'Alumnos', 'Profesores'].forEach(nombre => {
    const sheet = SS.getSheetByName(nombre);
    if (!sheet || !sheet.getLastColumn()) return;
    sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].forEach((v, i) => {
      if (/fila 2 es (solo )?ejemplo/i.test(norm(v))) { sheet.getRange(1, i + 1).clearContent(); borradas++; }
    });
  });
  return borradas ? `${borradas} nota(s) borrada(s)` : 'no había notas viejas';
}

// El Resumen miraba Alumnos hasta la fila 991 (y ese tope se achica solo al borrar filas).
// Se pasa a rangos abiertos ($A$2:$A). Solo reescribe las celdas que tienen ese tope.
function ampliarRangosResumen() {
  const sheet = SS.getSheetByName('Resumen');
  if (!sheet) return 'no existe la hoja Resumen (se omite)';
  const formulas = sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).getFormulas();
  let cambios = 0;
  formulas.forEach((fila, r) => fila.forEach((f, c) => {
    if (!f) return;
    const g = f.replace(/Alumnos!\$([A-Z]+)\$2:\$\1\$\d+/g, (m, col) => 'Alumnos!$' + col + '$2:$' + col);
    if (g !== f) { sheet.getRange(r + 1, c + 1).setFormula(g); cambios++; }
  }));
  return cambios ? `${cambios} fórmula(s) actualizadas` : 'ya estaban sin tope';
}

const INSTRUCCIONES_TITULO = 'Sistema de Asistencia — EMFP10 (v17)';
const INSTRUCCIONES_TEXTOS = [
  ['Alumnos', 'UNA sola tabla con TODOS los cursos juntos (la columna "ID Curso" dice a cuál pertenece cada fila) — no hay pestaña por curso. ' +
    'Columnas: ID Curso | DNI | Alumno | Teléfono | Estado | Fecha de alta | Fecha de nacimiento | Nacionalidad | Domicilio | Localidad. ' +
    'Alcanza con cargar ID Curso y Alumno: si no se conoce el DNI se lo deja vacío y el sistema le pone un número provisorio que empieza con 0 (ej. 0000012). ' +
    'Cuando se consiga el DNI real se escribe ENCIMA del provisorio y la asistencia ya guardada se traspasa sola. ' +
    'Estado vacío = activo, "baja" = inactivo, "pendiente" = alta hecha desde la app, todavía sin confirmar. "Fecha de alta" la completa el sistema — no cargar a mano.'],
  ['Altas, cambios y bajas', 'ALTA: desde la app (queda "pendiente") o escribiendo la fila en Alumnos. ' +
    'CAMBIOS: corregir el nombre o el DNI directamente en la celda; la asistencia guardada se actualiza sola. ' +
    'BAJA: NO borrar filas — elegir "baja" en Estado, o seleccionar las filas y usar Asistencia > Dar de baja las filas seleccionadas (también hay baja por lista de DNI). Así se conserva el historial y el Resumen cuenta la baja. ' +
    'Un alumno en dos cursos puede tener una fila con "curso1,curso2" o una fila por curso. ' +
    'COLORES en Alumnos: rojo = el mismo alumno repetido en el mismo curso (conviene unirlo con Asistencia > Unir alumnos repetidos); naranja = el mismo DNI en dos filas (puede ser correcto si son cursos distintos).'],
  ['Menú Asistencia', 'Aparece en la barra de menús de esta planilla: Dar de baja las filas seleccionadas · Dar de baja por lista de DNI · Unir alumnos repetidos · Asignar número a alumnos sin DNI · Revisar el sistema ahora · ' +
    'Mantenimiento (administrador): reparar asistencia sin alumno, preparar la planilla, instalar activadores. La primera vez que cada persona lo usa, Google le pide autorizar el script.'],
  ['Revisión automática', 'Todos los días (7 h) el sistema se revisa solo y manda un mail a emfp10educacion@gmail.com SOLO si encuentra un problema (no repite el mismo aviso más de una vez por semana). ' +
    'También numera solo a los alumnos que quedaron sin DNI. Para revisar a pedido: Asistencia > Revisar el sistema ahora.'],
  ['Recordatorio de pendientes', 'Corre solo los lunes (activador instalado con instalarActivadores). Si hay alumnos "pendiente" con 20+ días desde su alta, manda un mail a emfp10educacion@gmail.com. ' +
    'Para confirmarlos: dejar vacío el Estado, o darlos de baja si no corresponde.'],
  ['Backend (.gs)', 'Vive en Extensiones > Apps Script del Sheet. Cambios de código: pegar el archivo nuevo completo sobre el actual, guardar, y volver a implementar ' +
    '(Implementar > Administrar implementaciones > ✏️ > Nueva versión) para que el link /exec use el código nuevo — guardar sin volver a implementar NO alcanza. ' +
    'Los activadores (al editar, lunes, diario) se instalan UNA vez ejecutando instalarActivadores() con la cuenta dueña del sistema.']
];

function actualizarInstrucciones() {
  const sheet = SS.getSheetByName('Instrucciones');
  if (!sheet) return 'no existe la hoja Instrucciones (se omite)';
  const ultima = Math.max(sheet.getLastRow(), 3);
  const valores = sheet.getRange(1, 2, ultima, 2).getValues(); // columnas B:C
  if (/^Sistema de Asistencia/.test(norm(valores[1][0]))) sheet.getRange(2, 2).setValue(INSTRUCCIONES_TITULO);

  const filaDe = {};
  let ultimaConTexto = 3;
  valores.forEach((r, i) => {
    if (norm(r[0])) filaDe[norm(r[0])] = i + 1;
    if (norm(r[0]) || norm(r[1])) ultimaConTexto = i + 1;
  });
  const modelo = ultimaConTexto; // las filas nuevas copian el formato de la última

  let nuevas = 0;
  INSTRUCCIONES_TEXTOS.forEach(t => {
    let fila = filaDe[t[0]];
    if (!fila) {
      fila = ++ultimaConTexto;
      sheet.getRange(modelo, 2, 1, 2).copyTo(sheet.getRange(fila, 2, 1, 2), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      sheet.getRange(fila, 2).setValue(t[0]);
      nuevas++;
    }
    sheet.getRange(fila, 3).setValue(t[1]);
    sheet.autoResizeRows(fila, 1);
  });
  return `${INSTRUCCIONES_TEXTOS.length} entrada(s) al día (${nuevas} nueva(s))`;
}
