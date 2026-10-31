import { pool } from "../db.js";

const columnCache = new Map();

export async function getTableColumns(table) {
  if (!/^[a-z_]+$/.test(table)) {
    throw new Error("Invalid table name.");
  }
  if (!columnCache.has(table)) {
    columnCache.set(
      table,
      pool
        .query(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = $1`,
          [table]
        )
        .then(({ rows }) => new Set(rows.map((row) => row.column_name)))
        .catch((error) => {
          columnCache.delete(table);
          throw error;
        })
    );
  }
  return columnCache.get(table);
}

export async function getColumn(table, candidates, { required = true } = {}) {
  const columns = await getTableColumns(table);
  const column = candidates.find((candidate) => columns.has(candidate));
  if (!column && required) {
    throw new Error(
      `The ${table} table is missing a required column (expected one of: ${candidates.join(", ")}).`
    );
  }
  return column ?? null;
}

export function quoteColumn(column, qualifier = "") {
  const quoted = `"${column.replace(/"/g, '""')}"`;
  return qualifier ? `${qualifier}.${quoted}` : quoted;
}

export async function getStatusExpression(table, qualifier = "") {
  const status = await getColumn(table, ["status", "is_active"], {
    required: false,
  });
  if (!status) return "'active'::text AS status";

  const reference = quoteColumn(status, qualifier);
  if (status === "is_active") {
    return `CASE WHEN ${reference} THEN 'active' ELSE 'inactive' END AS status`;
  }
  return `${reference}::text AS status`;
}

export function statusValue(column, status) {
  return column === "is_active" ? status === "active" : status;
}

export async function insertMappedRow(table, fields, returning) {
  const columns = [];
  const values = [];
  for (const [value, candidates, required = false] of fields) {
    const column = await getColumn(table, candidates, { required });
    if (!column || value === undefined) continue;
    columns.push(column);
    values.push(value);
  }
  if (!columns.length) {
    throw new Error(`No writable mapped columns were found for ${table}.`);
  }
  const sqlColumns = columns.map((column) => quoteColumn(column)).join(", ");
  const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
  const returnColumns = returning
    .map(([alias, candidates]) =>
      getColumn(table, candidates, { required: false }).then((column) =>
        column
          ? `${quoteColumn(column)} AS ${quoteColumn(alias)}`
          : `NULL AS ${quoteColumn(alias)}`
      )
    );
  const selectedReturnColumns = (await Promise.all(returnColumns)).join(", ");
  return pool.query(
    `INSERT INTO ${quoteColumn(table)} (${sqlColumns})
     VALUES (${placeholders})
     RETURNING ${selectedReturnColumns}`,
    values
  );
}

export async function updateMappedRow(table, id, fields, returning) {
  const assignments = [];
  const values = [];
  for (const [value, candidates] of fields) {
    if (value === undefined) continue;
    const column = await getColumn(table, candidates, { required: false });
    if (!column) continue;
    values.push(value);
    assignments.push(`${quoteColumn(column)} = $${values.length}`);
  }
  if (!assignments.length) {
    throw new Error(`No writable mapped columns were found for ${table}.`);
  }

  values.push(id);
  const returnColumns = await Promise.all(
    returning.map(async ([alias, candidates]) => {
      const column = await getColumn(table, candidates, { required: false });
      return column
        ? `${quoteColumn(column)} AS ${quoteColumn(alias)}`
        : `NULL AS ${quoteColumn(alias)}`;
    })
  );
  return pool.query(
    `UPDATE ${quoteColumn(table)}
     SET ${assignments.join(", ")}
     WHERE ${quoteColumn("id")} = $${values.length}
     RETURNING ${returnColumns.join(", ")}`,
    values
  );
}

export async function invalidateTableColumns(table) {
  columnCache.delete(table);
}
