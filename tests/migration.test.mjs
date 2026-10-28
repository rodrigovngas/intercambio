import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareImport, importIntoClient } from '../scripts/migrate-firestore.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-10-27T12:00:00.000Z';
const OPTIONS = { owner: OWNER, now: NOW };

function backup(id = 'evento-original') {
  return {
    events: [{
      id,
      title: 'Cena de Navidad',
      date: '2026-12-24',
      budget: '$300',
      giftType: 'Libros',
      createdAt: '2025-12-01T10:00:00.000Z',
      participants: [
        { id: 'ana', name: 'Ana', targetId: 'luis', wish1: ' Libro ', wish2: 'Taza', extra: 'Talla M', revealed: true, password: 'LEGACY_PIN_HASH', secretKey: 'LEGACY_SECRET' },
        { id: 'luis', name: 'Luis', targetId: 'peque', wish1: 'Juegos' },
        { id: 'peque', name: 'Peque', isChild: true, managedBy: 'ana', targetId: 'ana' },
      ],
    }],
  };
}

describe('preparación del historial de Firestore', () => {
  it('conserva información y asignaciones sin trasladar credenciales ni reclamar perfiles', () => {
    const source = backup();
    const original = structuredClone(source);
    const [plan] = prepareImport(source, OPTIONS);
    expect(source).toEqual(original);
    expect(plan.event).toMatchObject({ owner_id: OWNER, title: 'Cena de Navidad', event_date: '2026-12-24', budget: '$300', gift_type: 'Libros', status: 'drawn', created_at: '2025-12-01T10:00:00.000Z' });
    expect(plan.participants[0].wishes).toEqual(['Libro', 'Taza', '']);
    expect(plan.participants[0].extra).toBe('Talla M');
    expect(plan.participants.every((person) => person.user_id === null)).toBe(true);
    expect(plan.participants[2].guardian_id).toBe(plan.participants[0].id);
    expect(plan.assignments.map((draw) => [draw.giver_id, draw.receiver_id])).toEqual([
      [plan.participants[0].id, plan.participants[1].id],
      [plan.participants[1].id, plan.participants[2].id],
      [plan.participants[2].id, plan.participants[0].id],
    ]);
    expect(plan.assignments[0].revealed_at).toBe(NOW);
    expect(plan.assignments[1].revealed_at).toBeNull();
    expect(JSON.stringify(plan)).not.toMatch(/LEGACY_PIN_HASH|LEGACY_SECRET|"password"|"secretKey"/);
  });

  it('genera identidades reproducibles separadas por proyecto de origen', () => {
    const [first] = prepareImport(backup(), OPTIONS);
    expect(prepareImport(backup(), OPTIONS)).toEqual([first]);
    const [otherSource] = prepareImport(backup(), { ...OPTIONS, source: 'otro-proyecto' });
    expect(otherSource.event.id).not.toBe(first.event.id);
    expect(otherSource.participants[0].id).not.toBe(first.participants[0].id);
  });

  it.each([
    ['autorregalo', (event) => { event.participants[0].targetId = 'ana'; }],
    ['receptor duplicado', (event) => { event.participants[1].targetId = 'ana'; }],
    ['asignación incompleta', (event) => { delete event.participants[1].targetId; }],
  ])('rechaza un sorteo con %s', (_, mutate) => {
    const data = backup();
    mutate(data.events[0]);
    expect(() => prepareImport(data, OPTIONS)).toThrow(/sorteo incompleto/);
  });

  it('sólo descarta resultados con la opción explícita y conserva deseos', () => {
    const [plan] = prepareImport(backup(), { ...OPTIONS, withoutAssignments: true });
    expect(plan.event.status).toBe('draft');
    expect(plan.event.drawn_at).toBeNull();
    expect(plan.assignments).toEqual([]);
    expect(plan.participants[0].wishes[0]).toBe('Libro');
  });

  it('requiere un adulto válido para cada dependiente sin adivinarlo', () => {
    const data = backup();
    delete data.events[0].participants[2].managedBy;
    expect(() => prepareImport(data, OPTIONS)).toThrow(/adulto responsable válido/);
    data.events[0].participants[2].guardianLegacyId = 'luis';
    const [plan] = prepareImport(data, OPTIONS);
    expect(plan.participants[2].guardian_id).toBe(plan.participants[1].id);
  });

  it('detecta fechas imposibles y nombres repetidos antes de conectar', () => {
    const date = backup();
    date.events[0].date = '2026-02-31';
    expect(() => prepareImport(date, OPTIONS)).toThrow(/fecha real/);
    const names = backup();
    names.events[0].participants[1].name = ' ANA ';
    expect(() => prepareImport(names, OPTIONS)).toThrow(/nombre de participante duplicado/);
  });

  it('el CLI predeterminado valida offline sin imprimir datos ni leer credenciales de conexión', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'intercambio-import-test-'));
    try {
      const file = join(directory, 'backup.json');
      await writeFile(file, JSON.stringify(backup()));
      const result = spawnSync(process.execPath, ['scripts/migrate-firestore.mjs', file, '--owner', OWNER], {
        cwd: new URL('..', import.meta.url),
        encoding: 'utf8',
        timeout: 10000,
        env: { ...process.env, INTERCAMBIO_DATABASE_URL: 'INVALIDA_NO_DEBE_LEERSE' },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('"mode": "dry-run"');
      expect(result.stdout).toContain('"participants": 3');
      expect(result.stdout).not.toMatch(/LEGACY_PIN_HASH|LEGACY_SECRET|Ana|Talla M|INVALIDA/);
      expect(result.stderr).toBe('');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe('aplicación transaccional a PostgreSQL', () => {
  let db;
  let client;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261027223953_intercambio_backend.sql', import.meta.url), 'utf8'));
    client = {
      query: async (sql, values) => {
        const result = await db.query(sql, values);
        return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
      },
    };
  }, 30000);
  beforeEach(async () => {
    await db.exec('truncate auth.users cascade');
    await db.query('insert into auth.users(id) values ($1),($2)', [OWNER, OTHER]);
  });
  afterAll(async () => { if (db) await db.close(); });

  it('preserva el sorteo privado y crea invitaciones sólo para adultos', async () => {
    const plan = prepareImport(backup(), OPTIONS);
    await expect(importIntoClient(client, plan)).resolves.toEqual({ inserted: 1, skipped: 0 });
    const assignments = (await db.query('select giver_id,receiver_id,revealed_at from intercambio_private.assignments order by giver_id')).rows;
    expect(assignments.map(({ giver_id, receiver_id }) => ({ giver_id, receiver_id }))).toEqual(
      plan[0].assignments.map(({ giver_id, receiver_id }) => ({ giver_id, receiver_id })).sort((a, b) => a.giver_id.localeCompare(b.giver_id)),
    );
    const invites = (await db.query('select participant_id,token from intercambio_private.participant_invites')).rows;
    expect(invites).toHaveLength(2);
    expect(invites.every((invite) => /^[a-f0-9]{64}$/.test(invite.token))).toBe(true);
    expect(invites.some((invite) => invite.participant_id === plan[0].participants[2].id)).toBe(false);
    expect((await db.query('select status from public.intercambio_events')).rows[0].status).toBe('drawn');
  });

  it('repetir una importación omite datos existentes y preserva cambios y perfiles reclamados', async () => {
    const plan = prepareImport(backup(), OPTIONS);
    await importIntoClient(client, plan);
    const participantId = plan[0].participants[0].id;
    await db.query('update public.intercambio_participants set user_id=$1,wishes=$2 where id=$3', [OTHER, ['Actualizado', '', ''], participantId]);
    await db.query('update public.intercambio_events set title=$1 where id=$2', ['Título nuevo', plan[0].event.id]);
    await expect(importIntoClient(client, plan)).resolves.toEqual({ inserted: 0, skipped: 1 });
    expect((await db.query('select user_id,wishes from public.intercambio_participants where id=$1', [participantId])).rows[0]).toEqual({ user_id: OTHER, wishes: ['Actualizado', '', ''] });
    expect((await db.query('select title from public.intercambio_events')).rows[0].title).toBe('Título nuevo');
    expect((await db.query('select count(*)::integer n from intercambio_private.assignments')).rows[0].n).toBe(3);
  });

  it('un fallo en el segundo evento revierte todas las inserciones de la ejecución', async () => {
    await importIntoClient(client, prepareImport(backup('previo'), OPTIONS));
    const plan = prepareImport({ events: [...backup('nuevo-uno').events, ...backup('nuevo-dos').events] }, OPTIONS);
    plan[1].participants[0].wishes = ['INVALIDO'];
    await expect(importIntoClient(client, plan)).rejects.toThrow(/La importación se revirtió/);
    expect((await db.query('select legacy_id from public.intercambio_events')).rows).toEqual([{ legacy_id: 'sorteo-f421d/previo' }]);
    expect((await db.query('select count(*)::integer n from public.intercambio_participants')).rows[0].n).toBe(3);
    expect((await db.query('select count(*)::integer n from intercambio_private.participant_invites')).rows[0].n).toBe(2);
  });

  it('rechaza reutilizar el mismo historial con otro propietario', async () => {
    await importIntoClient(client, prepareImport(backup(), OPTIONS));
    await expect(importIntoClient(client, prepareImport(backup(), { ...OPTIONS, owner: OTHER }))).rejects.toThrow(/Colisión de identidad/);
    expect((await db.query('select owner_id from public.intercambio_events')).rows[0].owner_id).toBe(OWNER);
  });

  it('usa parámetros SQL para texto del respaldo', async () => {
    const data = backup();
    data.events[0].title = "Cena'); DROP TABLE auth.users;--";
    await importIntoClient(client, prepareImport(data, OPTIONS));
    expect((await db.query('select title from public.intercambio_events')).rows[0].title).toBe(data.events[0].title);
    expect((await db.query('select count(*)::integer n from auth.users')).rows[0].n).toBe(2);
  });
});
