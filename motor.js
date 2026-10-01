/* =====================================================================
   MOTOR — común a todas las apps de estudio.
   No se edita al crear una app nueva: todo lo que cambia vive en
   config.json, contenido.json y teoria.json.
   ===================================================================== */
(function () {
'use strict';

/* ---------------------- utilidades ---------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.prototype.slice.call(r.querySelectorAll(s));

// Fecha local (no UTC): estudiar a las 00:30 en España no debe contar como el día anterior.
function fecha(offset) {
  const d = new Date();
  if (offset) d.setDate(d.getDate() + offset);
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
function diasEntre(a, b) { return Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 86400000); }

function prng(semilla) {
  let a = semilla >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function barajar(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
// Markdown mínimo: ## título, listas con - o 1., **negrita**, *cursiva*, párrafos.
function md(txt) {
  const lineas = String(txt || '').split('\n');
  let html = '', lista = null;
  const enLinea = t => esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
  const cerrar = () => { if (lista) { html += `</${lista}>`; lista = null; } };
  for (const ln of lineas) {
    const l = ln.trim();
    if (!l) { cerrar(); continue; }
    if (/^##\s+/.test(l)) { cerrar(); html += `<h3>${enLinea(l.replace(/^##\s+/, ''))}</h3>`; }
    else if (/^[-•]\s+/.test(l)) { if (lista !== 'ul') { cerrar(); html += '<ul>'; lista = 'ul'; } html += `<li>${enLinea(l.replace(/^[-•]\s+/, ''))}</li>`; }
    else if (/^\d+[.)]\s+/.test(l)) { if (lista !== 'ol') { cerrar(); html += '<ol>'; lista = 'ol'; } html += `<li>${enLinea(l.replace(/^\d+[.)]\s+/, ''))}</li>`; }
    else { cerrar(); html += `<p>${enLinea(l)}</p>`; }
  }
  cerrar();
  return html;
}

/* ---------------------- datos ---------------------- */
let CFG, PREGUNTAS = [], TEORIA = [], FIGURAS = [], PORID = {};
let estado = null, sesion = null, vistaActual = 'hoy';

const CLAVE = () => 'estudio:' + CFG.app.id + ':estado';

function estadoInicial() {
  return {
    esquema: 1,
    semilla: (Math.random() * 4294967295) >>> 0,
    creado: fecha(0),
    tarjetas: {},   // id -> {int, fac, venc, reps, lapsus, vistas, aciertos, fase, menos, oculta, avisado, maxInt, marcada}
    dias: {},       // 'AAAA-MM-DD' -> {nuevas, repasos, aciertos}
    maduras: { vistas: 0, aciertos: 0 },
    figuras: {},    // id de esquema -> true si se ha guardado en teoría
    ajustes: { nuevasPorDia: null, topeRepasos: null, tema: 'auto', desactivados: [] },
    hoyTemas: { fecha: null, fuera: [] }   // selección de temas válida solo para hoy
  };
}
function tarjeta(id) {
  if (!estado.tarjetas[id]) {
    estado.tarjetas[id] = { int: 0, fac: CFG.srs.facilidadInicial, venc: null, reps: 0, lapsus: 0, vistas: 0, aciertos: 0, fase: 'nueva', menos: false, oculta: false, avisado: 0, maxInt: 0, marcada: false, estudiar: false };
  }
  return estado.tarjetas[id];
}
function guardar() {
  try { localStorage.setItem(CLAVE(), JSON.stringify(estado)); }
  catch (e) { console.warn('No se pudo guardar el progreso', e); }
}
function cargar() {
  let bruto = null;
  try { bruto = JSON.parse(localStorage.getItem(CLAVE()) || 'null'); } catch (e) { bruto = null; }
  estado = bruto && bruto.tarjetas ? bruto : estadoInicial();
  const base = estadoInicial();
  for (const k in base) if (estado[k] === undefined) estado[k] = base[k];
  for (const k in base.ajustes) if (estado.ajustes[k] === undefined) estado.ajustes[k] = base.ajustes[k];
  // Las preguntas retiradas del contenido dejan su progreso en paz; no se borra nada.
}

const aj = {
  get nuevas() { return estado.ajustes.nuevasPorDia == null ? CFG.estudio.nuevasPorDia : estado.ajustes.nuevasPorDia; },
  get tope() { return estado.ajustes.topeRepasos == null ? CFG.estudio.topeRepasosDia : estado.ajustes.topeRepasos; }
};
function dia(f) {
  if (!estado.dias[f]) estado.dias[f] = { nuevas: 0, repasos: 0, aciertos: 0 };
  return estado.dias[f];
}

/* ---------------------- selección de tarjetas ---------------------- */
function claveTema(p) { return (p.tema || '—') + '||' + (p.subtema || '—'); }
function desactivada(p) { return estado.ajustes.desactivados.indexOf(claveTema(p)) !== -1; }
function activa(p) { return !tarjeta(p.id).oculta && !desactivada(p); }

/* Selección de temas del día. A diferencia de Ajustes, se reinicia cada
   mañana: sirve para decidir qué se estudia hoy, no qué entra en la app. */
function seleccionHoy() {
  if (!estado.hoyTemas || estado.hoyTemas.fecha !== fecha(0)) estado.hoyTemas = { fecha: fecha(0), fuera: [] };
  return estado.hoyTemas;
}
function enHoy(p) { return seleccionHoy().fuera.indexOf(grupoDe(p)) === -1; }
function ordenarGrupos(lista) {
  const orden = (CFG.ejeAgrupacion && CFG.ejeAgrupacion.orden) || [];
  return lista.slice().sort((a, b) => {
    const ia = orden.indexOf(a), ib = orden.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b, 'es');
  });
}
function gruposActivos() {
  const set = [];
  PREGUNTAS.forEach(p => { if (activa(p) && set.indexOf(grupoDe(p)) === -1) set.push(grupoDe(p)); });
  return ordenarGrupos(set);
}

function vencidas(todosLosTemas) {
  const hoy = fecha(0);
  return PREGUNTAS.filter(p => {
    const t = tarjeta(p.id);
    return activa(p) && (todosLosTemas || enHoy(p)) && t.fase !== 'nueva' && t.venc && t.venc <= hoy;
  }).sort((a, b) => (tarjeta(a.id).venc < tarjeta(b.id).venc ? -1 : 1));
}
function ordenNuevas() {
  // Orden propio de cada instalación: dos personas con la misma app ven series distintas.
  const rnd = prng(estado.semilla);
  const candidatas = PREGUNTAS.filter(p => activa(p) && enHoy(p) && tarjeta(p.id).fase === 'nueva');
  const menosPrio = candidatas.filter(p => tarjeta(p.id).menos);
  const normales = candidatas.filter(p => !tarjeta(p.id).menos);
  return barajar(normales, rnd).concat(barajar(menosPrio, prng(estado.semilla ^ 0x9E3779B9)));
}
function nuevasRestantes() { return Math.max(0, aj.nuevas - dia(fecha(0)).nuevas); }

function construirCola(opciones) {
  const o = opciones || {};
  const rnd = prng(estado.semilla ^ hash(fecha(0)));

  if (o.filtro) { // sesión dirigida desde Consulta: sin topes
    const sel = PREGUNTAS.filter(p => activa(p) && o.filtro(p));
    const rep = sel.filter(p => tarjeta(p.id).fase !== 'nueva');
    const nue = sel.filter(p => tarjeta(p.id).fase === 'nueva');
    return barajar(rep, rnd).concat(barajar(nue, rnd)).slice(0, 40).map(p => p.id);
  }

  let rep = vencidas();
  if (!o.sinTope) {
    const restante = Math.max(0, aj.tope - dia(fecha(0)).repasos);
    rep = rep.slice(0, restante);
  }
  rep = barajar(rep, rnd);

  const cuantasNuevas = o.soloNuevas ? aj.nuevas : nuevasRestantes();
  const nue = ordenNuevas().slice(0, cuantasNuevas);

  if (o.soloNuevas) return nue.map(p => p.id);
  if (!nue.length) return rep.map(p => p.id);
  if (!rep.length) return nue.map(p => p.id);

  // Intercalado: las nuevas se reparten a lo largo de la sesión en vez de amontonarse.
  const cola = rep.slice();
  const paso = Math.max(1, Math.floor(cola.length / nue.length));
  nue.forEach((p, i) => cola.splice(Math.min(cola.length, (i + 1) * paso + i), 0, p));
  return cola.map(p => p.id);
}

/* ---------------------- repetición espaciada ---------------------- */
function ruido(int, rnd) {
  if (int < 3) return int;
  const d = Math.max(1, Math.round(int * 0.05));
  return Math.max(1, int + Math.round((rnd() * 2 - 1) * d));
}
// resultado: 'fallo' | 'normal' | 'dude' | 'facil'
function aplicar(id, resultado) {
  const t = tarjeta(id), s = CFG.srs, hoy = fecha(0);
  const rnd = prng(hash(id + hoy + t.reps));
  const eraMadura = t.int >= s.umbralMaduroDias;
  const eraNueva = t.fase === 'nueva';

  t.vistas++;
  if (resultado !== 'fallo') t.aciertos++;
  if (eraMadura) { estado.maduras.vistas++; if (resultado !== 'fallo') estado.maduras.aciertos++; }

  const d = dia(hoy);
  if (eraNueva) d.nuevas++; else d.repasos++;
  if (resultado !== 'fallo') d.aciertos++;

  if (resultado === 'fallo') {
    if (!eraNueva && t.fase === 'repaso') t.lapsus++;
    t.fac = Math.max(s.facilidadMinima, t.fac + s.penalizacionFallo);
    t.int = t.fase === 'repaso' ? Math.max(1, Math.round(t.int * 0.3)) : 0;
    t.fase = 'aprendiendo';
    t.venc = fecha(Math.max(1, t.int));
    guardar();
    return;
  }

  if (t.fase === 'nueva' || t.fase === 'aprendiendo') {
    t.int = resultado === 'facil' ? 3 : 1;
    if (resultado === 'dude') t.fac = Math.max(s.facilidadMinima, t.fac + s.penalizacionDude);
    if (resultado === 'facil') t.fac = Math.min(3.0, t.fac + s.bonusFacil);
  } else {
    if (resultado === 'dude') {
      t.fac = Math.max(s.facilidadMinima, t.fac + s.penalizacionDude);
      t.int = Math.max(1, Math.round(t.int * s.multiplicadorDude));
    } else if (resultado === 'facil') {
      t.fac = Math.min(3.0, t.fac + s.bonusFacil);
      t.int = Math.max(1, Math.round(t.int * t.fac * s.multiplicadorFacil));
    } else {
      t.int = Math.max(1, Math.round(t.int * t.fac));
    }
  }
  if (t.menos) t.int = Math.round(t.int * s.factorMostrarMenos);
  t.int = Math.min(ruido(t.int, rnd), 365);
  t.maxInt = Math.max(t.maxInt, t.int);
  t.reps++;
  t.fase = 'repaso';
  t.venc = fecha(t.int);
  guardar();
}

function esProblematica(t) {
  const s = CFG.srs;
  if (t.avisado && t.lapsus - t.avisado < 3) return false;
  if (t.lapsus >= s.leechLapsus) return true;
  if (t.lapsus >= s.leechLapsusIntervaloCorto && t.maxInt <= 3) return true;
  return false;
}
function listaProblematicas() {
  return PREGUNTAS.filter(p => { const t = tarjeta(p.id); return !t.oculta && t.lapsus >= CFG.srs.leechLapsusIntervaloCorto; })
    .sort((a, b) => tarjeta(b.id).lapsus - tarjeta(a.id).lapsus);
}

/* ---------------------- métricas ---------------------- */
function racha() {
  const activo = o => { const d = estado.dias[fecha(o)]; return !!d && (d.nuevas + d.repasos) > 0; };
  // Si hoy aún no has estudiado, la racha de ayer sigue viva.
  let o = activo(0) ? 0 : -1;
  if (!activo(o)) return 0;
  let n = 0;
  while (activo(o)) { n++; o--; }
  return n;
}
function mejorRacha() {
  const dias = Object.keys(estado.dias).filter(f => (estado.dias[f].nuevas + estado.dias[f].repasos) > 0).sort();
  let mejor = 0, act = 0, prev = null;
  for (const f of dias) { act = (prev && diasEntre(prev, f) === 1) ? act + 1 : 1; mejor = Math.max(mejor, act); prev = f; }
  return mejor;
}
function vistasTotales() {
  const total = PREGUNTAS.filter(p => !tarjeta(p.id).oculta).length;
  const vistas = PREGUNTAS.filter(p => tarjeta(p.id).vistas > 0 && !tarjeta(p.id).oculta).length;
  return { vistas, total };
}
function grupoDe(p) { return p[CFG.ejeAgrupacion.clave] || p.tema || '—'; }
function mapaAciertos() {
  const m = {};
  PREGUNTAS.forEach(p => {
    if (tarjeta(p.id).oculta) return;
    const g = grupoDe(p), t = tarjeta(p.id);
    if (!m[g]) m[g] = { vistas: 0, aciertos: 0, total: 0, tocadas: 0 };
    m[g].total++; m[g].vistas += t.vistas; m[g].aciertos += t.aciertos;
    if (t.vistas > 0) m[g].tocadas++;
  });
  const orden = (CFG.ejeAgrupacion.orden && CFG.ejeAgrupacion.orden.length) ? CFG.ejeAgrupacion.orden : Object.keys(m).sort();
  const extra = Object.keys(m).filter(g => orden.indexOf(g) === -1).sort();
  return orden.concat(extra).filter(g => m[g]).map(g => Object.assign({ nombre: g }, m[g]));
}
function pintarMapa(cont) {
  const datos = mapaAciertos();
  if (!datos.length) { cont.innerHTML = '<p class="vacio">Aún no hay datos.</p>'; return; }
  cont.innerHTML = datos.map(d => {
    const pct = d.vistas ? Math.round(d.aciertos / d.vistas * 100) : null;
    const cls = pct == null ? '' : pct >= 80 ? 'bien' : pct >= 60 ? 'regular' : 'mal';
    return `<div class="chip ${cls}"><b>${pct == null ? '—' : pct + '%'}</b><span title="${esc(d.nombre)}">${esc(d.nombre)} · ${d.tocadas}/${d.total}</span></div>`;
  }).join('');
}

/* ---------------------- diálogo de confirmación ---------------------- */
let alConfirmar = null;
function confirmar(texto, cb) {
  $('#dialogo-texto').textContent = texto;
  alConfirmar = cb;
  $('#dialogo').classList.remove('oculto');
}
$('#dialogo-no').onclick = () => { $('#dialogo').classList.add('oculto'); alConfirmar = null; };
$('#dialogo-si').onclick = () => { $('#dialogo').classList.add('oculto'); const c = alConfirmar; alConfirmar = null; if (c) c(); };

/* ---------------------- vista Hoy ---------------------- */
function pintarHoy() {
  const pend = vencidas().length;
  const restante = Math.max(0, aj.tope - dia(fecha(0)).repasos);
  const mostrables = Math.min(pend, restante);
  $('#n-pendientes').textContent = pend;
  $('#n-nuevas').textContent = aj.nuevas;

  const avisoTope = $('#aviso-tope');
  if (pend > restante) {
    avisoTope.textContent = `Hoy se te mostrarán ${mostrables} por el tope diario. Puedes repartir los atrasos desde Ajustes.`;
    avisoTope.classList.remove('oculto');
  } else avisoTope.classList.add('oculto');

  const nuevasHoy = Math.min(nuevasRestantes(), ordenNuevas().length);
  $('#btn-estudiar').textContent = mostrables + nuevasHoy > 0
    ? `Estudiar (${mostrables + nuevasHoy})` : 'Estudiar';
  $('#btn-estudiar').disabled = (mostrables + nuevasHoy) === 0;
  $('#btn-estudiar').style.opacity = (mostrables + nuevasHoy) === 0 ? .45 : 1;
  $('#sin-nada').classList.toggle('oculto', (mostrables + nuevasHoy) > 0);

  pintarTemasHoy();
  pintarMapa($('#mapa-aciertos'));
  const v = vistasTotales();
  $('#m-racha').textContent = racha();
  $('#m-vistas').textContent = v.vistas + '/' + v.total;
  const man = fecha(1);
  $('#m-manana').textContent = PREGUNTAS.filter(p => { const t = tarjeta(p.id); return activa(p) && t.venc === man; }).length;
}

function pintarTemasHoy() {
  const cont = $('#temas-hoy');
  if (!cont) return;
  const sel = seleccionHoy(), grupos = gruposActivos(), hoy = fecha(0);
  cont.innerHTML = grupos.map(g => {
    const dentro = sel.fuera.indexOf(g) === -1;
    const pend = PREGUNTAS.filter(p => {
      const t = tarjeta(p.id);
      return activa(p) && grupoDe(p) === g && t.fase !== 'nueva' && t.venc && t.venc <= hoy;
    }).length;
    return `<button class="chip-tema${dentro ? ' dentro' : ''}" data-tema-hoy="${esc(g)}" aria-pressed="${dentro}">${esc(g)}${pend ? ` <b>${pend}</b>` : ''}</button>`;
  }).join('');
  $$('[data-tema-hoy]', cont).forEach(b => b.onclick = () => {
    const g = b.getAttribute('data-tema-hoy'), sl = seleccionHoy(), i = sl.fuera.indexOf(g);
    if (i === -1) sl.fuera.push(g); else sl.fuera.splice(i, 1);
    guardar(); pintarHoy();
  });
  const fuera = sel.fuera.filter(g => grupos.indexOf(g) !== -1).length;
  $('#nota-temas').textContent = fuera
    ? `Hoy estudias ${grupos.length - fuera} de ${grupos.length} temas. Mañana vuelven todos.`
    : 'Quita los que hoy no toquen: la sesión saldrá solo de los que queden marcados.';
  const bt = $('#btn-temas-todos');
  bt.classList.toggle('oculto', !fuera);
  bt.onclick = () => { seleccionHoy().fuera = []; guardar(); pintarHoy(); };
}

/* ---------------------- vista Consulta ---------------------- */
let subActual = 'teoria';
function pintarConsulta() {
  const q = $('#buscador').value.trim().toLowerCase();
  if (subActual === 'teoria') pintarTeoria(q);
  if (subActual === 'imagenes') pintarImagenes(q);
  if (subActual === 'tarjetas') pintarTarjetas(q);
  if (subActual === 'marcadas') pintarMarcadas();
}
function coincide(txt, q) { return !q || String(txt || '').toLowerCase().indexOf(q) !== -1; }

const gruposAbiertos = {};
let verTodoTemario = false;
function seccionDe(p) { return p.teoria ? TEORIA.filter(s => s.id === p.teoria)[0] : null; }
function enTeoria(s) { return PREGUNTAS.some(p => p.teoria === s.id && tarjeta(p.id).estudiar); }

function pintarTeoria(q) {
  const cont = $('#sub-teoria');
  if (!CFG.modulos.teoria) { cont.innerHTML = '<p class="vacio">Esta app no lleva sección de teoría.</p>'; return; }
  let html = '';

  // Pendientes: mandadas a teoría pero sin sección escrita todavía.
  const pend = PREGUNTAS.filter(p => tarjeta(p.id).estudiar && !seccionDe(p));
  if (pend.length) {
    const gp = {};
    pend.forEach(p => { const g = grupoDe(p); (gp[g] = gp[g] || []).push(p); });
    html += `<details class="seccion pendientes" id="sec-pendientes" open>
      <summary>Para desarrollar (${pend.length})</summary>
      <div class="cuerpo-seccion">
        <p class="nota">Tarjetas que has mandado a teoría. Copia la lista y pídeme las secciones: llegarán en la siguiente actualización del contenido.</p>
        ${ordenarGrupos(Object.keys(gp)).map(g => `<p class="etiqueta">${esc(g)}</p>` +
          gp[g].map(p => `<div class="pendiente"><span>${esc(p.enunciado)}</span><button data-quitar-estudiar="${esc(p.id)}">Quitar</button></div>`).join('')).join('')}
        <button id="btn-copiar-estudiar" class="secundario">Copiar lista</button>
      </div></details>`;
  }

  const visibles = TEORIA.filter(s => verTodoTemario || enTeoria(s));
  const secs = visibles.filter(s => coincide(s.titulo, q) || coincide(s.contenido, q));
  const guardadas = FIGURAS.filter(f => estado.figuras[f.id]);
  const figs = guardadas.filter(f => coincide(f.titulo, q) || coincide(f.descripcion, q));
  if (!visibles.length && !pend.length && !guardadas.length) {
    html += `<p class="vacio">Aquí solo hay lo que tú mandes con el botón <b>Estudiar</b>, desde una tarjeta o desde un esquema. De momento, nada.</p>`;
  } else if ((visibles.length || guardadas.length) && !secs.length && !figs.length) {
    html += '<p class="vacio">Nada encontrado en teoría.</p>';
  }
  {
    const seccionHTML = s => {
      const n = PREGUNTAS.filter(p => p.teoria === s.id && activa(p)).length;
      const img = (CFG.modulos.imagenes && s.imagen) ? `<img src="${esc(s.imagen)}" alt="${esc(s.titulo)}" loading="lazy">` : '';
      return `<details class="seccion" id="sec-${esc(s.id)}" ${q ? 'open' : ''}>
        <summary>${esc(s.titulo)}</summary>
        <div class="cuerpo-seccion">${md(s.contenido)}${img}
          <div class="pie">
            ${n ? `<button class="enlace" data-practicar="${esc(s.id)}">Repasar estas (${n})</button>` : ''}
            ${enTeoria(s) ? `<button class="enlace" data-quitar-seccion="${esc(s.id)}">Quitar de teoría</button>` : ''}
          </div>
        </div></details>`;
    };
    const figuraSeccionHTML = f => `<details class="seccion" id="fig-${esc(f.id)}" ${q ? 'open' : ''}>
      <summary>${esc(f.titulo)}</summary>
      <div class="cuerpo-seccion">
        <figure class="figura" data-ver="${esc(f.id)}">${cuerpoFigura(f)}</figure>
        ${f.descripcion ? `<p>${esc(f.descripcion)}</p>` : ''}
        <div class="pie"><button class="enlace" data-figura-teoria="${esc(f.id)}">Quitar de teoría</button></div>
      </div></details>`;

    const items = secs.map(x => ({ g: x.grupo || '—', html: seccionHTML(x) }))
      .concat(figs.map(f => ({ g: f.grupo || '—', html: figuraSeccionHTML(f) })));
    if (items.length) {
      const gs = {};
      items.forEach(it => { (gs[it.g] = gs[it.g] || []).push(it.html); });
      const claves = ordenarGrupos(Object.keys(gs));
      const unSoloGrupo = claves.length < 2;
      html += claves.map(g => (unSoloGrupo && !verTodoTemario) ? gs[g].join('') :
        `<details class="grupo" data-grupo="${esc(g)}" ${(q || gruposAbiertos['t:' + g]) ? 'open' : ''}>
          <summary><span>${esc(g)}</span><span class="cuenta">${gs[g].length}</span></summary>
          <div class="cuerpo-grupo">${gs[g].join('')}</div>
        </details>`).join('');
    }
  }

  const cuantasFuera = TEORIA.filter(s => !enTeoria(s)).length;
  if (TEORIA.length && (cuantasFuera || verTodoTemario)) {
    html += `<button id="btn-todo-temario" class="enlace">${verTodoTemario
      ? 'Ver solo lo que he guardado' : `Ver todo el temario (${cuantasFuera} secciones más)`}</button>`;
  }

  cont.innerHTML = html;
  engancharGrupos(cont, 't:');
  engancharFiguras(cont);
  const bt = $('#btn-todo-temario');
  if (bt) bt.onclick = () => { verTodoTemario = !verTodoTemario; pintarConsulta(); };
  $$('[data-quitar-seccion]', cont).forEach(b => b.onclick = () => {
    const id = b.getAttribute('data-quitar-seccion');
    PREGUNTAS.forEach(p => { if (p.teoria === id) tarjeta(p.id).estudiar = false; });
    guardar(); pintarConsulta();
  });
  $$('[data-practicar]', cont).forEach(b => b.onclick = () => {
    const id = b.getAttribute('data-practicar');
    iniciarSesion({ filtro: p => p.teoria === id });
  });
  $$('[data-quitar-estudiar]', cont).forEach(b => b.onclick = () => {
    tarjeta(b.getAttribute('data-quitar-estudiar')).estudiar = false;
    guardar(); pintarConsulta();
  });
  const bc = $('#btn-copiar-estudiar');
  if (bc) bc.onclick = () => copiar(pend.map(p =>
    `[${p.id}] ${grupoDe(p)}${p.subtema ? ' · ' + p.subtema : ''}\n${p.enunciado}\nCorrecta: ${p.opciones[p.correcta]}\nExplicación actual: ${p.explicacion}`
  ).join('\n\n---\n\n'), bc);
}
/* ---------------------- esquemas (pestaña Imágenes) ---------------------- */
function cuerpoFigura(f) {
  if (f.svg) return f.svg;
  if (f.archivo) return `<img src="${esc(f.archivo)}" alt="${esc(f.titulo)}" loading="lazy">`;
  return '';
}
function abrirVisor(id) {
  const f = FIGURAS.filter(x => x.id === id)[0];
  if (!f) return;
  $('#visor-titulo').textContent = f.titulo;
  $('#visor-cuerpo').innerHTML = cuerpoFigura(f);
  $('#visor-pie').textContent = f.descripcion || '';
  $('#visor').classList.remove('oculto');
  document.body.style.overflow = 'hidden';
}
function cerrarVisor() {
  $('#visor').classList.add('oculto');
  $('#visor-cuerpo').innerHTML = '';
  if (!sesion) document.body.style.overflow = '';
}
function engancharFiguras(cont) {
  $$('[data-ver]', cont).forEach(el => el.onclick = () => abrirVisor(el.getAttribute('data-ver')));
  $$('[data-figura-teoria]', cont).forEach(b => b.onclick = () => {
    const id = b.getAttribute('data-figura-teoria');
    if (estado.figuras[id]) delete estado.figuras[id]; else estado.figuras[id] = true;
    guardar(); pintarConsulta();
  });
  $$('[data-repasar-figura]', cont).forEach(b => b.onclick = () => {
    const id = b.getAttribute('data-repasar-figura');
    iniciarSesion({ filtro: p => p.figura === id });
  });
}
function pintarImagenes(q) {
  const cont = $('#sub-imagenes');
  if (!FIGURAS.length) { cont.innerHTML = '<p class="vacio">Esta app no lleva esquemas.</p>'; return; }
  const sel = FIGURAS.filter(f => coincide(f.titulo, q) || coincide(f.descripcion, q) || coincide(f.grupo, q));
  if (!sel.length) { cont.innerHTML = '<p class="vacio">Nada encontrado.</p>'; return; }
  const gs = {};
  sel.forEach(f => { const g = f.grupo || '—'; (gs[g] = gs[g] || []).push(f); });
  const fichaFigura = f => {
    const n = PREGUNTAS.filter(p => p.figura === f.id && activa(p)).length;
    return `<div class="ficha figura-ficha">
      <figure class="figura" data-ver="${esc(f.id)}">${cuerpoFigura(f)}</figure>
      <p class="pregunta">${esc(f.titulo)}</p>
      ${f.descripcion ? `<p class="expl">${esc(f.descripcion)}</p>` : ''}
      <div class="pie">
        <button data-figura-teoria="${esc(f.id)}">${estado.figuras[f.id] ? 'Quitar de teoría' : 'Estudiar'}</button>
        ${n ? `<button data-repasar-figura="${esc(f.id)}">Repasar estas (${n})</button>` : ''}
      </div></div>`;
  };
  cont.innerHTML = '<p class="nota">Solo esquemas. Toca uno para verlo a pantalla completa.</p>' +
    ordenarGrupos(Object.keys(gs)).map(g => `<details class="grupo" data-grupo="${esc(g)}" ${(q || gruposAbiertos['i:' + g]) ? 'open' : ''}>
      <summary><span>${esc(g)}</span><span class="cuenta">${gs[g].length}</span></summary>
      <div class="cuerpo-grupo">${gs[g].map(fichaFigura).join('')}</div>
    </details>`).join('');
  engancharGrupos(cont, 'i:');
  engancharFiguras(cont);
}

function engancharGrupos(cont, prefijo) {
  $$('details.grupo', cont).forEach(d => d.addEventListener('toggle', () => {
    gruposAbiertos[prefijo + d.getAttribute('data-grupo')] = d.open;
  }));
}

function insigniasDe(t) {
  const ins = [];
  if (t.oculta) ins.push('oculta');
  if (t.menos) ins.push('menos a menudo');
  if (t.marcada) ins.push('marcada');
  if (t.estudiar) ins.push('a teoría');
  if (t.lapsus >= CFG.srs.leechLapsusIntervaloCorto) ins.push(t.lapsus + ' fallos');
  return ins;
}
function pieFichaHTML(p, extra) {
  const t = tarjeta(p.id);
  return `<div class="pie">
    <button data-accion="marcar">${t.marcada ? 'Quitar de marcadas' : 'Revisar'}</button>
    <button data-accion="estudiar">${t.estudiar ? 'Quitar de teoría' : 'Estudiar'}</button>
    ${t.oculta ? '<button data-accion="mostrar">Reactivar</button>' : '<button data-accion="ocultar">Ocultar</button>'}
    <button data-accion="menos">${t.menos ? 'Frecuencia normal' : 'Mostrar menos'}</button>
    ${extra || ''}
  </div>`;
}
function cuerpoFichaHTML(p, extra) {
  const img = (CFG.modulos.imagenes && p.imagen) ? `<img src="${esc(p.imagen)}" alt="" loading="lazy">` : '';
  return `<div class="cuerpo-ficha">${img}
    <p class="correcta">${esc(p.opciones[p.correcta])}</p>
    <p class="expl">${esc(p.explicacion)}</p>
    ${p.fuente ? `<p class="expl"><i>${esc(p.fuente)}</i></p>` : ''}
    ${pieFichaHTML(p, extra)}</div>`;
}
function fichaHTML(p, extra) {
  const t = tarjeta(p.id), ins = insigniasDe(t);
  return `<div class="ficha" data-id="${esc(p.id)}">
    <p class="etiqueta">${esc(grupoDe(p))}${p.subtema ? ' · ' + esc(p.subtema) : ''} ${ins.map(i => `<span class="insignia">${esc(i)}</span>`).join(' ')}</p>
    <p class="pregunta">${esc(p.enunciado)}</p>
    ${cuerpoFichaHTML(p, extra)}</div>`;
}
const fichasAbiertas = {};
function fichaPlegableHTML(p, abierta) {
  const t = tarjeta(p.id), ins = insigniasDe(t);
  const open = (abierta || fichasAbiertas[p.id]) ? 'open' : '';
  return `<details class="ficha plegable" data-id="${esc(p.id)}" ${open}>
    <summary><span class="pregunta">${esc(p.enunciado)}</span>${ins.length ? `<span class="insignias">${ins.map(i => `<span class="insignia">${esc(i)}</span>`).join(' ')}</span>` : ''}</summary>
    ${cuerpoFichaHTML(p)}</details>`;
}
function engancharFichas(cont) {
  $$('.ficha', cont).forEach(f => {
    const id = f.getAttribute('data-id'), t = tarjeta(id);
    if (f.tagName === 'DETAILS') f.addEventListener('toggle', () => { fichasAbiertas[id] = f.open; });
    $$('[data-accion]', f).forEach(b => b.onclick = e => {
      e.preventDefault();
      const a = b.getAttribute('data-accion');
      if (a === 'marcar') { t.marcada = !t.marcada; guardar(); pintarConsulta(); }
      if (a === 'estudiar') { t.estudiar = !t.estudiar; guardar(); pintarConsulta(); }
      if (a === 'menos') { t.menos = !t.menos; guardar(); pintarConsulta(); }
      if (a === 'mostrar') { t.oculta = false; guardar(); pintarConsulta(); pintarHoy(); }
      if (a === 'ocultar') confirmar('¿Seguro que quieres ocultar esta pregunta?', () => { t.oculta = true; guardar(); pintarConsulta(); pintarHoy(); });
    });
  });
}
function pintarTarjetas(q) {
  const cont = $('#sub-tarjetas');
  const sel = PREGUNTAS.filter(p => coincide(p.enunciado, q) || coincide(p.explicacion, q) || coincide(p.opciones.join(' '), q) || coincide(grupoDe(p), q) || coincide(p.subtema, q));
  if (!sel.length) { cont.innerHTML = '<p class="vacio">Nada encontrado.</p>'; return; }
  const gs = {};
  sel.forEach(p => { const g = grupoDe(p); (gs[g] = gs[g] || []).push(p); });
  cont.innerHTML = `<p class="nota">${sel.length} de ${PREGUNTAS.length} tarjetas. Toca una pregunta para ver la respuesta.</p>` +
    ordenarGrupos(Object.keys(gs)).map(g => {
      const act = gs[g].filter(p => activa(p)).length;
      return `<details class="grupo" data-grupo="${esc(g)}" ${(q || gruposAbiertos['c:' + g]) ? 'open' : ''}>
        <summary><span>${esc(g)}</span><span class="cuenta">${gs[g].length}</span></summary>
        <div class="cuerpo-grupo">
          ${act ? `<button class="enlace" data-repasar-grupo="${esc(g)}">Repasar este tema (${act})</button>` : ''}
          ${gs[g].map(p => fichaPlegableHTML(p, false)).join('')}
        </div></details>`;
    }).join('');
  engancharGrupos(cont, 'c:');
  engancharFichas(cont);
  $$('[data-repasar-grupo]', cont).forEach(b => b.onclick = () => {
    const g = b.getAttribute('data-repasar-grupo');
    iniciarSesion({ filtro: p => grupoDe(p) === g });
  });
}
function pintarMarcadas() {
  const cont = $('#sub-marcadas');
  const marcadas = PREGUNTAS.filter(p => tarjeta(p.id).marcada);
  const probl = listaProblematicas().filter(p => marcadas.indexOf(p) === -1);
  let html = '';
  html += '<h2>Marcadas para revisar</h2>';
  html += marcadas.length ? marcadas.map(p => fichaHTML(p)).join('') : '<p class="vacio">Ninguna. Marca con «Revisar» las preguntas que veas mal redactadas o discutibles.</p>';
  html += '<h2>Problemáticas</h2>';
  html += '<p class="nota">Tarjetas que fallas una y otra vez. Casi siempre el problema es la pregunta, no tu memoria.</p>';
  html += probl.length ? probl.map(p => fichaHTML(p)).join('') : '<p class="vacio">Ninguna, de momento.</p>';
  if (marcadas.length || probl.length) html += '<button id="btn-exportar-revision" class="secundario">Copiar lista para revisar</button>';
  cont.innerHTML = html;
  engancharFichas(cont);
  const bx = $('#btn-exportar-revision');
  if (bx) bx.onclick = () => {
    const txt = marcadas.concat(probl).map(p => {
      const t = tarjeta(p.id);
      return `[${p.id}] (${t.lapsus} lapsus, ${t.aciertos}/${t.vistas} aciertos)\n${p.enunciado}\nOpciones: ${p.opciones.join(' | ')}\nCorrecta: ${p.opciones[p.correcta]}\nExplicación: ${p.explicacion}`;
    }).join('\n\n---\n\n');
    copiar(txt, bx);
  };
}
function copiar(txt, boton) {
  const ok = () => { const o = boton.textContent; boton.textContent = 'Copiado'; setTimeout(() => boton.textContent = o, 1500); };
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(ok, () => alert(txt));
  else alert(txt);
}

/* ---------------------- vista Progreso ---------------------- */
function pintarProgreso() {
  const v = vistasTotales();
  $('#p-racha').textContent = racha();
  $('#p-mejor').textContent = mejorRacha();
  const d = estado.dias[fecha(0)];
  $('#p-hoy').textContent = d ? d.nuevas + d.repasos : 0;
  $('#p-vistas').textContent = v.vistas + '/' + v.total;
  $('#p-umbral').textContent = CFG.srs.umbralMaduroDias;

  const maduras = PREGUNTAS.filter(p => tarjeta(p.id).int >= CFG.srs.umbralMaduroDias && !tarjeta(p.id).oculta).length;
  $('#p-maduras').textContent = maduras;
  $('#p-retencion').textContent = estado.maduras.vistas >= 10
    ? Math.round(estado.maduras.aciertos / estado.maduras.vistas * 100) + '%' : '—';

  const prev = [];
  for (let i = 0; i < 7; i++) {
    const f = fecha(i);
    const n = PREGUNTAS.filter(p => { const t = tarjeta(p.id); return activa(p) && t.venc && (i === 0 ? t.venc <= f : t.venc === f); }).length;
    prev.push({ f, n, dia: new Date(f + 'T00:00').toLocaleDateString('es-ES', { weekday: 'short' }) });
  }
  const max = Math.max(1, ...prev.map(p => p.n));
  $('#prevision').innerHTML = prev.map((p, i) =>
    `<div><span class="cifra">${p.n}</span><div class="barra ${i === 0 ? 'hoy' : ''}" style="height:${Math.round(p.n / max * 78)}%"></div><small>${i === 0 ? 'hoy' : esc(p.dia)}</small></div>`
  ).join('');

  pintarMapa($('#mapa-aciertos-2'));

  const cuenta = { nueva: 0, aprendiendo: 0, repaso: 0, consolidada: 0 };
  PREGUNTAS.forEach(p => {
    const t = tarjeta(p.id); if (t.oculta) return;
    if (t.fase === 'nueva') cuenta.nueva++;
    else if (t.fase === 'aprendiendo') cuenta.aprendiendo++;
    else if (t.int >= CFG.srs.umbralMaduroDias) cuenta.consolidada++;
    else cuenta.repaso++;
  });
  $('#reparto').innerHTML = [['nueva', 'sin ver'], ['aprendiendo', 'aprendiendo'], ['repaso', 'en repaso'], ['consolidada', 'consolidadas']]
    .map(([k, et]) => `<div><b>${cuenta[k]}</b><span>${et}</span></div>`).join('');

  const np = listaProblematicas().length;
  $('#p-problematicas').textContent = np
    ? `Tarjetas problemáticas: ${np}. Las tienes listadas en Consulta › Marcadas.` : 'Ninguna tarjeta problemática.';
}

/* ---------------------- vista Ajustes ---------------------- */
function pintarAjustes() {
  $('#aj-nuevas').value = aj.nuevas;
  $('#aj-tope').value = aj.tope;
  $('#aj-tema').value = estado.ajustes.tema;

  const atrasadas = vencidas(true).length;
  const bloque = $('#bloque-atrasos');
  if (atrasadas > aj.tope) {
    $('#texto-atrasos').textContent = `Tienes ${atrasadas} repasos atrasados. Repartirlos los reparte por días y evita el atracón.`;
    bloque.classList.remove('oculto');
  } else bloque.classList.add('oculto');

  // Temas y subtemas
  const arbol = {};
  PREGUNTAS.forEach(p => {
    const tm = p.tema || '—', sb = p.subtema || '—';
    if (!arbol[tm]) arbol[tm] = {};
    arbol[tm][sb] = (arbol[tm][sb] || 0) + 1;
  });
  $('#lista-temas').innerHTML = Object.keys(arbol).map(tm => {
    const subs = Object.keys(arbol[tm]).map(sb => {
      const k = tm + '||' + sb, on = estado.ajustes.desactivados.indexOf(k) === -1;
      return `<div class="fila-tema"><span>${esc(sb)} <small>(${arbol[tm][sb]})</small></span>
        <input type="checkbox" data-clave="${esc(k)}" ${on ? 'checked' : ''} aria-label="${esc(sb)}"></div>`;
    }).join('');
    return `<div class="grupo-temas"><div class="fila-tema"><span><b>${esc(tm)}</b></span>
      <button class="enlace" data-todo="${esc(tm)}">Todo / nada</button></div>${subs}</div>`;
  }).join('');
  $$('#lista-temas input[data-clave]').forEach(c => c.onchange = () => {
    const k = c.getAttribute('data-clave');
    const i = estado.ajustes.desactivados.indexOf(k);
    if (c.checked && i !== -1) estado.ajustes.desactivados.splice(i, 1);
    if (!c.checked && i === -1) estado.ajustes.desactivados.push(k);
    guardar(); pintarHoy();
  });
  $$('#lista-temas [data-todo]').forEach(b => b.onclick = () => {
    const tm = b.getAttribute('data-todo');
    const claves = Object.keys(arbol[tm]).map(sb => tm + '||' + sb);
    const algunoOn = claves.some(k => estado.ajustes.desactivados.indexOf(k) === -1);
    claves.forEach(k => {
      const i = estado.ajustes.desactivados.indexOf(k);
      if (algunoOn && i === -1) estado.ajustes.desactivados.push(k);
      if (!algunoOn && i !== -1) estado.ajustes.desactivados.splice(i, 1);
    });
    guardar(); pintarAjustes(); pintarHoy();
  });

  listaSimple('#lista-ocultas', '#n-ocultas', p => tarjeta(p.id).oculta, 'Mostrar', t => { t.oculta = false; });
  listaSimple('#lista-menos', '#n-menos', p => tarjeta(p.id).menos && !tarjeta(p.id).oculta, 'Frecuencia normal', t => { t.menos = false; });

  $('#pie-version').textContent = `${CFG.app.nombre} · contenido ${CFG.app.versionContenido} · ${PREGUNTAS.length} preguntas`;
}
function listaSimple(sel, selN, filtro, etiqueta, accion) {
  const sels = PREGUNTAS.filter(filtro);
  $(selN).textContent = sels.length;
  const cont = $(sel);
  cont.innerHTML = sels.length ? sels.map(p =>
    `<div class="fila-lista"><span>${esc(p.enunciado.slice(0, 90))}${p.enunciado.length > 90 ? '…' : ''}</span>
     <button data-id="${esc(p.id)}">${etiqueta}</button></div>`).join('')
    : '<p class="vacio">Ninguna.</p>';
  $$('button[data-id]', cont).forEach(b => b.onclick = () => {
    accion(tarjeta(b.getAttribute('data-id'))); guardar(); pintarAjustes(); pintarHoy();
  });
}

function engancharAjustes() {
  $('#aj-nuevas').onchange = e => { estado.ajustes.nuevasPorDia = Math.max(0, parseInt(e.target.value, 10) || 0); guardar(); pintarHoy(); };
  $('#aj-tope').onchange = e => { estado.ajustes.topeRepasos = Math.max(5, parseInt(e.target.value, 10) || 5); guardar(); pintarHoy(); pintarAjustes(); };
  $('#aj-tema').onchange = e => { estado.ajustes.tema = e.target.value; guardar(); aplicarTema(); };

  $('#btn-repartir').onclick = () => {
    const atr = vencidas(true);
    const porDia = Math.ceil(atr.length / 7);
    atr.forEach((p, i) => { const t = tarjeta(p.id); t.venc = fecha(Math.floor(i / porDia)); });
    guardar(); pintarAjustes(); pintarHoy();
  };

  $('#btn-exportar').onclick = () => {
    const blob = new Blob([JSON.stringify(estado)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${CFG.app.id}-progreso-${fecha(0)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('#btn-importar').onclick = () => $('#fichero-importar').click();
  $('#fichero-importar').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const lector = new FileReader();
    lector.onload = () => {
      let datos = null;
      try { datos = JSON.parse(lector.result); } catch (err) { datos = null; }
      if (!datos || !datos.tarjetas) { alert('Ese fichero no es una copia de progreso de esta app.'); return; }
      confirmar('Al importar se sustituye el progreso actual de este dispositivo. ¿Seguir?', () => {
        estado = datos; cargar2(); guardar(); pintarTodo();
      });
    };
    lector.readAsText(f);
    e.target.value = '';
  };
  $('#btn-reiniciar').onclick = () => confirmar('Se borrará todo el progreso de este dispositivo. ¿Seguro?', () => {
    const semilla = estado.semilla;
    estado = estadoInicial(); estado.semilla = semilla; guardar(); pintarTodo();
  });
}
function cargar2() { // normaliza un estado importado
  const base = estadoInicial();
  for (const k in base) if (estado[k] === undefined) estado[k] = base[k];
  for (const k in base.ajustes) if (estado.ajustes[k] === undefined) estado.ajustes[k] = base.ajustes[k];
}

/* ---------------------- sesión ---------------------- */
let deshacer = null;

function iniciarSesion(opciones) {
  const cola = construirCola(opciones || {});
  if (!cola.length) return;
  sesion = { cola, i: 0, respondidas: 0, aciertos: 0, avisoMostrado: false, dirigida: !!(opciones && opciones.filtro) };
  $('#sesion').classList.remove('oculto');
  $('#resumen').classList.add('oculto');
  document.body.style.overflow = 'hidden';
  mostrarTarjeta();
}
function terminarSesion() {
  document.body.style.overflow = '';
  $('#sesion').classList.add('oculto');
  sesion = null; deshacer = null;
  pintarTodo();
}
function mostrarTarjeta() {
  if (!sesion || sesion.i >= sesion.cola.length) return mostrarResumen();
  const p = PORID[sesion.cola[sesion.i]];
  if (!p) { sesion.i++; return mostrarTarjeta(); }
  const t = tarjeta(p.id);
  deshacer = null;

  $('#contador-sesion').textContent = (sesion.i + 1) + '/' + sesion.cola.length;
  $('#progreso-relleno').style.width = (sesion.i / sesion.cola.length * 100) + '%';
  $('#etiqueta-tarjeta').textContent = (sesion.dirigida ? 'Repaso libre · ' : '') + grupoDe(p) +
    (p.subtema ? ' · ' + p.subtema : '') + (!sesion.dirigida && t.fase === 'nueva' ? ' · nueva' : '');
  $('#enunciado').textContent = p.enunciado;

  const img = $('#imagen-tarjeta');
  if (CFG.modulos.imagenes && p.imagen) { img.src = p.imagen; img.classList.remove('oculto'); }
  else { img.classList.add('oculto'); img.removeAttribute('src'); }

  $('#opciones').innerHTML = '';
  $('#btn-opciones').classList.remove('oculto');
  $('#feedback').classList.add('oculto');
  $('#pie-sesion').classList.add('oculto');
  $('#btn-deshacer').classList.add('oculto');
  $('#panel-problematica').classList.add('oculto');
  $('#panel-normal').classList.remove('oculto');
  $('#btn-dude').classList.remove('activa', 'oculto');
  $('#btn-facil').classList.remove('activa', 'oculto');
  if (sesion.dirigida) { $('#btn-dude').classList.add('oculto'); $('#btn-facil').classList.add('oculto'); }
  sesion.resultado = null;
  $('#cuerpo-sesion').scrollTop = 0;
}

function mostrarOpciones() {
  const p = PORID[sesion.cola[sesion.i]], t = tarjeta(p.id);
  $('#btn-opciones').classList.add('oculto');
  const rnd = prng(hash(p.id) ^ estado.semilla ^ (t.reps * 2654435761));
  const orden = CFG.estudio.ordenOpcionesAleatorio ? barajar(p.opciones.map((_, i) => i), rnd) : p.opciones.map((_, i) => i);
  const cont = $('#opciones');
  cont.innerHTML = orden.map(i => `<button class="opcion" data-i="${i}">${esc(p.opciones[i])}</button>`).join('');
  $$('.opcion', cont).forEach(b => b.onclick = () => responder(parseInt(b.getAttribute('data-i'), 10)));
}

function responder(indice) {
  const p = PORID[sesion.cola[sesion.i]], t = tarjeta(p.id);
  const acierto = indice === p.correcta;

  // Instantánea para deshacer (una pulsación equivocada en el móvil pasa a diario).
  deshacer = {
    tarjeta: JSON.parse(JSON.stringify(t)),
    dia: JSON.parse(JSON.stringify(dia(fecha(0)))),
    maduras: JSON.parse(JSON.stringify(estado.maduras)),
    cola: sesion.cola.slice(),
    respondidas: sesion.respondidas, aciertos: sesion.aciertos
  };

  $$('.opcion').forEach(b => {
    const i = parseInt(b.getAttribute('data-i'), 10);
    b.disabled = true;
    if (i === p.correcta) b.classList.add('acierto');
    else if (i === indice) b.classList.add('fallo');
  });

  sesion.respondidas++;
  if (acierto) sesion.aciertos++;

  if (acierto) {
    if (!sesion.dirigida) aplicar(p.id, 'normal');
    sesion.resultado = 'normal';
  } else {
    if (!sesion.dirigida) aplicar(p.id, 'fallo');
    sesion.resultado = 'fallo';
    // Vuelve a salir dentro de la misma sesión.
    const pos = Math.min(sesion.cola.length, sesion.i + CFG.estudio.reaparicionTrasFallo);
    sesion.cola.splice(pos, 0, p.id);
    $('#contador-sesion').textContent = (sesion.i + 1) + '/' + sesion.cola.length;
    $('#btn-deshacer').classList.remove('oculto');
    // Tras un fallo no hay confianza que graduar.
    $('#btn-dude').classList.add('oculto');
    $('#btn-facil').classList.add('oculto');
  }

  let html = md(p.explicacion);
  if (p.fuente) html += `<p class="nota">${esc(p.fuente)}</p>`;
  $('#explicacion').innerHTML = html;
  $('#feedback').classList.remove('oculto');

  const enl = $('#enlace-teoria');
  const sec = p.teoria && TEORIA.filter(s => s.id === p.teoria)[0];
  if (sec && CFG.modulos.teoria) {
    enl.textContent = (enTeoria(sec) ? 'Ver teoría: ' : 'Guardar en teoría y ver: ') + sec.titulo;
    enl.classList.remove('oculto');
    enl.onclick = () => {
      t.estudiar = true; guardar();
      terminarSesion(); irA('consulta'); subPestana('teoria'); abrirSeccion(p.teoria);
    };
  } else enl.classList.add('oculto');

  $('#pie-sesion').classList.remove('oculto');

  // Aviso de tarjeta problemática: como mucho una vez por sesión.
  if (!acierto && !sesion.dirigida && !sesion.avisoMostrado && esProblematica(t)) {
    sesion.avisoMostrado = true;
    $('#texto-problematica').textContent = `Has fallado esta pregunta ${t.lapsus} veces. ¿Qué hacemos con ella?`;
    $('#panel-problematica').classList.remove('oculto');
    $('#panel-normal').classList.add('oculto');
  }
  $('#cuerpo-sesion').scrollTop = $('#cuerpo-sesion').scrollHeight;
}

function deshacerRespuesta() {
  if (!deshacer) return;
  const p = PORID[sesion.cola[sesion.i]];
  estado.tarjetas[p.id] = deshacer.tarjeta;
  estado.dias[fecha(0)] = deshacer.dia;
  estado.maduras = deshacer.maduras;
  sesion.cola = deshacer.cola;
  sesion.respondidas = deshacer.respondidas;
  sesion.aciertos = deshacer.aciertos;
  guardar();
  mostrarTarjeta();
  mostrarOpciones();
}

function siguiente() {
  const p = PORID[sesion.cola[sesion.i]], t = tarjeta(p.id);
  // Reajuste por confianza: solo si acertó y marcó algo.
  if (!sesion.dirigida && sesion.resultado === 'normal' && deshacer) {
    const dude = $('#btn-dude').classList.contains('activa');
    const facil = $('#btn-facil').classList.contains('activa');
    if (dude || facil) {
      // Se recalcula desde la instantánea para no encadenar dos aplicaciones seguidas.
      // Las marcas (menos / oculta / marcada) son posteriores y se conservan.
      const marcas = { menos: t.menos, oculta: t.oculta, marcada: t.marcada, avisado: t.avisado };
      estado.tarjetas[p.id] = Object.assign(deshacer.tarjeta, marcas);
      estado.dias[fecha(0)] = deshacer.dia;
      estado.maduras = deshacer.maduras;
      aplicar(p.id, dude ? 'dude' : 'facil');
    }
  }
  sesion.i++;
  mostrarTarjeta();
}

function mostrarResumen() {
  const pct = sesion.respondidas ? Math.round(sesion.aciertos / sesion.respondidas * 100) : 0;
  const man = PREGUNTAS.filter(p => { const t = tarjeta(p.id); return activa(p) && t.venc === fecha(1); }).length;
  $('#texto-resumen').textContent = sesion.dirigida
    ? `${sesion.respondidas} respuestas, ${pct}% de aciertos. Repaso libre: no ha tocado tus repasos ni las estadísticas.`
    : `${sesion.respondidas} respuestas, ${pct}% de aciertos. Mañana te tocan ${man} repasos.`;
  $('#resumen').classList.remove('oculto');
}

function abrirSeccion(id) {
  const d = document.getElementById('sec-' + id);
  if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); }
}

/* ---------------------- navegación ---------------------- */
function irA(v) {
  vistaActual = v;
  $$('.vista').forEach(s => s.classList.add('oculto'));
  $('#vista-' + v).classList.remove('oculto');
  $$('.pestana').forEach(b => b.classList.toggle('activa', b.getAttribute('data-vista') === v));
  if (v === 'hoy') pintarHoy();
  if (v === 'consulta') pintarConsulta();
  if (v === 'progreso') pintarProgreso();
  if (v === 'ajustes') pintarAjustes();
  window.scrollTo(0, 0);
}
function subPestana(s) {
  subActual = s;
  $$('.subpestana').forEach(b => b.classList.toggle('activa', b.getAttribute('data-sub') === s));
  $$('.subvista').forEach(d => d.classList.add('oculto'));
  $('#sub-' + s).classList.remove('oculto');
  pintarConsulta();
}
function pintarTodo() { pintarHoy(); if (vistaActual !== 'hoy') irA(vistaActual); }

/* ---------------------- tema y colores ---------------------- */
function aplicarTema() {
  const pref = estado.ajustes.tema;
  const oscuro = pref === 'oscuro' || (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-tema', oscuro ? 'oscuro' : 'claro');
  aplicarColores(oscuro);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', oscuro ? '#0F1526' : CFG.colores.primario);
}

/* Los colores de config.json están pensados para fondo claro. Sobre fondo
   oscuro se recalculan subiendo la luminosidad y manteniendo el tono, para que
   los títulos no queden casi negros. config.coloresOscuro los fija a mano. */
function aHsl(hex) {
  const m = String(hex || '').replace('#', '');
  const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const r = parseInt(v.slice(0, 2), 16) / 255, g = parseInt(v.slice(2, 4), 16) / 255, b = parseInt(v.slice(4, 6), 16) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  let h = 0, sat = 0;
  if (mx !== mn) {
    const d = mx - mn;
    sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s: sat, l };
}
function aHex(h, s, l) {
  const f = t => {
    t = (t + 1) % 1;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p2 = 2 * l - q;
    let c = p2;
    if (t < 1 / 6) c = p2 + (q - p2) * 6 * t;
    else if (t < 1 / 2) c = q;
    else if (t < 2 / 3) c = p2 + (q - p2) * (2 / 3 - t) * 6;
    return Math.round(Math.min(255, Math.max(0, c * 255)));
  };
  const n2 = x => x.toString(16).padStart(2, '0');
  return '#' + n2(f(h + 1 / 3)) + n2(f(h)) + n2(f(h - 1 / 3));
}
function conLuz(hex, l, sMin) {
  const c = aHsl(hex);
  return aHex(c.h, Math.max(sMin == null ? 0 : sMin, c.s), l);
}
function paletaOscura() {
  const c = CFG.colores || {}, o = CFG.coloresOscuro || {};
  return {
    primario: o.primario || conLuz(c.primario || '#1B2D5B', 0.78, 0.55),
    secundario: o.secundario || conLuz(c.secundario || '#BFDBFF', 0.24, 0.30),
    acento: o.acento || conLuz(c.acento || '#0D7377', 0.62, 0.40)
  };
}
function aplicarColores(oscuro) {
  const r = document.documentElement.style;
  const c = oscuro ? paletaOscura() : (CFG.colores || {});
  ['primario', 'secundario', 'acento'].forEach(k => { if (c[k]) r.setProperty('--' + k, c[k]); });
}

/* ---------------------- arranque ---------------------- */
async function arrancar() {
  const traer = async f => (await fetch(f + '?v=' + Date.now(), { cache: 'no-cache' })).json();
  CFG = await traer('./config.json');
  const cont = await traer('./contenido.json');
  PREGUNTAS = cont.preguntas || [];
  PREGUNTAS.forEach(p => { PORID[p.id] = p; });
  if (CFG.modulos.teoria) {
    try { TEORIA = (await traer('./teoria.json')).secciones || []; } catch (e) { TEORIA = []; }
  }
  try { FIGURAS = (await traer('./imagenes.json')).figuras || []; } catch (e) { FIGURAS = []; }

  cargar();
  aplicarTema();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', aplicarTema);

  document.title = CFG.app.nombre;
  $('#titulo-app').textContent = CFG.app.nombre;
  $('#subtitulo-app').textContent = CFG.app.subtitulo || '';
  $$('.eje-etiqueta').forEach(e => e.textContent = (CFG.ejeAgrupacion.etiqueta || 'tema').toLowerCase());
  $('#pestanas [data-vista="consulta"] span').textContent = CFG.modulos.tituloPestanaTeoria || 'Consulta';
  if (!FIGURAS.length) $('.subpestana[data-sub="imagenes"]').classList.add('oculto');

  $$('.pestana').forEach(b => b.onclick = () => irA(b.getAttribute('data-vista')));
  $$('.subpestana').forEach(b => b.onclick = () => subPestana(b.getAttribute('data-sub')));
  $('#buscador').oninput = pintarConsulta;

  $('#btn-estudiar').onclick = () => iniciarSesion({});
  $('#btn-nuevas').onclick = () => iniciarSesion({ soloNuevas: true });
  $('#btn-opciones').onclick = mostrarOpciones;
  $('#btn-siguiente').onclick = siguiente;
  $('#btn-deshacer').onclick = deshacerRespuesta;
  $('#btn-dude').onclick = () => { $('#btn-facil').classList.remove('activa'); $('#btn-dude').classList.toggle('activa'); };
  $('#btn-facil').onclick = () => { $('#btn-dude').classList.remove('activa'); $('#btn-facil').classList.toggle('activa'); };
  $('#btn-salir').onclick = terminarSesion;
  $('#btn-cerrar-resumen').onclick = terminarSesion;

  $('#visor-cerrar').onclick = cerrarVisor;
  $('#visor').onclick = e => { if (e.target.id === 'visor') cerrarVisor(); };
  $('#btn-mas').onclick = () => $('#menu-mas').classList.remove('oculto');
  $$('#menu-mas button').forEach(b => b.onclick = () => {
    const a = b.getAttribute('data-mas');
    $('#menu-mas').classList.add('oculto');
    if (a === 'cerrar') return;
    const p = PORID[sesion.cola[sesion.i]], t = tarjeta(p.id);
    if (a === 'menos') { t.menos = true; guardar(); siguiente(); }
    if (a === 'estudiar') {
      t.estudiar = true; guardar();
      const et = $('#etiqueta-tarjeta');
      if (et.textContent.indexOf('a teoría') === -1) et.textContent += ' · a teoría';
    }
    if (a === 'ocultar') confirmar('¿Seguro que quieres ocultar esta pregunta? Podrás recuperarla en Ajustes.', () => {
      t.oculta = true; guardar();
      sesion.cola = sesion.cola.filter((id, i) => i <= sesion.i || id !== p.id);
      siguiente();
    });
  });
  $$('#panel-problematica button').forEach(b => b.onclick = () => {
    const a = b.getAttribute('data-leech');
    const p = PORID[sesion.cola[sesion.i]], t = tarjeta(p.id);
    if (a === 'menos') { t.menos = true; t.avisado = t.lapsus; guardar(); siguiente(); }
    if (a === 'seguir') { t.avisado = t.lapsus; guardar(); $('#panel-problematica').classList.add('oculto'); $('#panel-normal').classList.remove('oculto'); }
    if (a === 'ocultar') confirmar('¿Seguro que quieres ocultar esta pregunta? Podrás recuperarla en Ajustes.', () => {
      t.oculta = true; t.avisado = t.lapsus; guardar();
      sesion.cola = sesion.cola.filter((id, i) => i <= sesion.i || id !== p.id);
      siguiente();
    });
  });

  engancharAjustes();
  irA('hoy');
  registrarSW();
}

function registrarSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      if (!nuevo) return;
      nuevo.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
          $('#aviso-version').classList.remove('oculto');
          $('#btn-actualizar').onclick = () => { nuevo.postMessage('saltar'); };
        }
      });
    });
    setInterval(() => reg.update(), 60 * 60 * 1000);
  }).catch(() => {});
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return; recargando = true; location.reload();
  });
}

arrancar().catch(e => {
  document.body.innerHTML = '<p style="padding:24px">No se ha podido cargar el contenido: ' + esc(e.message) +
    '. Comprueba que config.json y contenido.json están junto a index.html.</p>';
});
})();
