#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMESPACE = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');

function stableId(name) {
  const hash = createHash('sha1').update(NAMESPACE).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function text(value, field, max, required = false) {
  if (value != null && typeof value !== 'string') throw new Error(`${field}: se esperaba texto.`);
  const result = (value ?? '').trim();
  if (required && !result) throw new Error(`${field}: es obligatorio.`);
  if (result.length > max) throw new Error(`${field}: supera ${max} caracteres.`);
  return result;
}

function timestamp(value, fallback) {
  if (value == null) return fallback;
  const raw = typeof value === 'object'
    ? (value._seconds ?? value.seconds) * 1000
    : value;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) throw new Error('createdAt inválido en la exportación.');
  return parsed.toISOString();
}

/** Normaliza exclusivamente los campos permitidos; nunca traslada hashes de PIN. */
export function prepareImport(input, { owner, source = 'sorteo-f421d', withoutAssignments = false, now = new Date().toISOString() }) {
  if (!UUID.test(owner ?? '')) throw new Error('--owner debe ser el UUID de un usuario de Supabase Auth existente.');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(source)) throw new Error('--source inválido.');
  if (!input || !Array.isArray(input.events)) throw new Error('Se esperaba un objeto JSON con events: [].');
  const eventsSeen = new Set();
  return input.events.map((raw, eventIndex) => {
    const label = `Evento ${eventIndex + 1}`;
    const oldId = text(raw.id, `${label}.id`, 150, true);
    if (eventsSeen.has(oldId)) throw new Error(`${label}: ID de evento duplicado.`);
    eventsSeen.add(oldId);
    const legacyId = `${source}/${oldId}`;
    const id = stableId(`intercambio/event/${legacyId}`);
    const date = text(raw.date, `${label}.date`, 10, true);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
      throw new Error(`${label}: date debe ser una fecha real YYYY-MM-DD.`);
    }
    if (!Array.isArray(raw.participants) || raw.participants.length < 2 || raw.participants.length > 100) {
      throw new Error(`${label}: se necesitan entre 2 y 100 participantes.`);
    }
    const oldParticipants = new Map();
    const namesSeen = new Set();
    const participants = raw.participants.map((person, index) => {
      const oldPersonId = text(person.id, `${label}.participants[${index}].id`, 150, true);
      if (oldParticipants.has(oldPersonId)) throw new Error(`${label}: ID de participante duplicado.`);
      const name = text(person.name, `${label}.participants[${index}].name`, 80, true);
      if (namesSeen.has(name.toLowerCase())) throw new Error(`${label}: nombre de participante duplicado.`);
      namesSeen.add(name.toLowerCase());
      const result = {
        id: stableId(`intercambio/participant/${JSON.stringify([source, oldId, oldPersonId])}`),
        event_id: id,
        legacy_id: oldPersonId,
        name,
        is_child: person.isChild === true,
        guardian_id: null,
        user_id: null,
        wishes: [1, 2, 3].map((n) => text(person[`wish${n}`], `${label}.wish${n}`, 500)),
        extra: text(person.extra, `${label}.extra`, 1000),
        created_at: timestamp(person.createdAt, timestamp(raw.createdAt, now)),
      };
      oldParticipants.set(oldPersonId, { raw: person, row: result });
      return result;
    });
    for (const { raw: person, row } of oldParticipants.values()) {
      if (!row.is_child) continue;
      const guardianOldId = person.guardianLegacyId ?? person.managedBy;
      const guardian = oldParticipants.get(guardianOldId);
      if (!guardian || guardian.row.is_child || guardian.row.id === row.id) {
        throw new Error(`${label}: un dependiente no tiene adulto responsable válido. Añade guardianLegacyId en el JSON.`);
      }
      row.guardian_id = guardian.row.id;
    }
    let assignments = [];
    const anyAssignment = raw.participants.some((person) => person.targetId);
    if (anyAssignment && !withoutAssignments) {
      const receivers = new Set();
      assignments = [...oldParticipants.values()].map(({ raw: person, row }) => {
        const receiver = oldParticipants.get(person.targetId);
        if (!receiver || receiver.row.id === row.id || receivers.has(receiver.row.id)) {
          throw new Error(`${label}: sorteo incompleto, duplicado o con autorregalo. Corrige el respaldo o usa --without-assignments para importarlo como borrador.`);
        }
        receivers.add(receiver.row.id);
        return { event_id: id, giver_id: row.id, receiver_id: receiver.row.id, revealed_at: person.revealed ? now : null };
      });
    }
    return {
      event: {
        id, legacy_id: legacyId, owner_id: owner,
        title: text(raw.title, `${label}.title`, 120, true),
        event_date: date,
        budget: text(raw.budget || 'Libre', `${label}.budget`, 40, true),
        gift_type: text(raw.giftType, `${label}.giftType`, 120),
        status: assignments.length ? 'drawn' : 'draft',
        created_at: timestamp(raw.createdAt, now),
        drawn_at: assignments.length ? now : null,
      },
      participants,
      assignments,
    };
  });
}

async function insertRow(client, table, row) {
  // Tabla/columnas provienen exclusivamente de constantes y objetos normalizados.
  const columns = Object.keys(row);
  await client.query(`insert into ${table} (${columns.join(',')}) values (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
}

async function applyImport(plan) {
  const connectionString = process.env.INTERCAMBIO_DATABASE_URL;
  if (!connectionString) throw new Error('Falta INTERCAMBIO_DATABASE_URL. Usa la conexión PostgreSQL de servidor, nunca VITE_*.');
  const connectionUrl = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(connectionUrl.protocol)) throw new Error('INTERCAMBIO_DATABASE_URL debe ser una URL PostgreSQL.');
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(connectionUrl.hostname);
  if (!local && ['disable', 'no-verify', 'allow', 'prefer'].includes(connectionUrl.searchParams.get('sslmode'))) {
    throw new Error('La importación remota exige TLS con verificación de certificado.');
  }
  // Evita que parámetros de la URL sustituyan la configuración SSL estricta.
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) connectionUrl.searchParams.delete(key);
  const ssl = local ? false : {
    rejectUnauthorized: true,
    ...(process.env.INTERCAMBIO_DATABASE_CA ? { ca: await readFile(process.env.INTERCAMBIO_DATABASE_CA, 'utf8') } : {}),
  };
  const { Client } = await import('pg');
  const client = new Client({ connectionString: connectionUrl.toString(), ssl, connectionTimeoutMillis: 15000 });
  await client.connect();
  try { return await importIntoClient(client, plan); }
  finally { await client.end(); }
}

/** Separado del transporte para comprobar la transacción contra PostgreSQL de prueba. */
export async function importIntoClient(client, plan) {
  let inserted = 0;
  let skipped = 0;
  try {
    await client.query('begin');
    await client.query("set local lock_timeout = '10s'");
    await client.query("set local statement_timeout = '60s'");
    // Una sola transacción; serializa importadores y evita cambiar eventos existentes.
    await client.query("select pg_advisory_xact_lock(hashtextextended('intercambio_legacy_import', 0))");
    for (const { event, participants, assignments } of plan) {
      const owner = await client.query('select id from auth.users where id = $1', [event.owner_id]);
      if (owner.rowCount !== 1) throw new Error('El propietario indicado no existe en Supabase Auth.');
      const existing = await client.query('select id, owner_id, legacy_id from public.intercambio_events where legacy_id = $1 or id = $2 for update', [event.legacy_id, event.id]);
      if (existing.rowCount) {
        if (existing.rowCount !== 1 || existing.rows[0].id !== event.id || existing.rows[0].owner_id !== event.owner_id || existing.rows[0].legacy_id !== event.legacy_id) {
          throw new Error('Colisión de identidad en un evento importado. No se modificó ningún evento.');
        }
        skipped++;
        continue;
      }
      // Se inserta como borrador hasta completar participantes y asignaciones.
      await insertRow(client, 'public.intercambio_events', { ...event, status: 'draft', drawn_at: null });
      for (const person of [...participants].sort((a, b) => Number(a.is_child) - Number(b.is_child))) {
        await insertRow(client, 'public.intercambio_participants', person);
        if (!person.is_child) {
          await insertRow(client, 'intercambio_private.participant_invites', { event_id: event.id, participant_id: person.id });
        }
      }
      for (const assignment of assignments) await insertRow(client, 'intercambio_private.assignments', assignment);
      if (assignments.length) await client.query('update public.intercambio_events set status = $1, drawn_at = $2 where id = $3', ['drawn', event.drawn_at, event.id]);
      inserted++;
    }
    await client.query('commit');
    return { inserted, skipped };
  } catch (error) {
    await client.query('rollback');
    // No imprimir objetos pg que pueden incluir detalles o datos personales.
    const code = typeof error.code === 'string' ? ` [${error.code}]` : '';
    throw new Error(`La importación se revirtió${code}. ${error.code ? 'Revisa restricciones del esquema y permisos de la conexión.' : error.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes('--help')) {
    console.log('Uso: node scripts/migrate-firestore.mjs respaldo.json --owner UUID [--source firebase-project] [--without-assignments] [--apply]\nSin --apply sólo valida y muestra cantidades. INTERCAMBIO_DATABASE_URL se lee únicamente con --apply.');
    return;
  }
  const file = args.shift();
  const options = {};
  let apply = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--apply') apply = true;
    else if (flag === '--without-assignments') options.withoutAssignments = true;
    else if (['--owner', '--source'].includes(flag)) {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`Falta valor de ${flag}.`);
      options[flag.slice(2)] = value;
    } else throw new Error(`Opción desconocida: ${flag}.`);
  }
  const inputText = await readFile(resolve(file), 'utf8');
  let input;
  try { input = JSON.parse(inputText); }
  catch { throw new Error('El respaldo no contiene JSON válido. No se imprimió su contenido.'); }
  const plan = prepareImport(input, options);
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', events: plan.length, participants: plan.reduce((n, x) => n + x.participants.length, 0), assignments: plan.reduce((n, x) => n + x.assignments.length, 0) }, null, 2));
  if (apply) console.log(JSON.stringify(await applyImport(plan), null, 2));
  else console.log('Validación terminada. No se conectó a ninguna base de datos ni se escribieron datos.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
