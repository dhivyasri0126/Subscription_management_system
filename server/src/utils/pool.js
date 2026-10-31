// One place that finds your pg Pool, whichever way db.js exports it:
//   export const pool = new Pool(...)   -> db.pool
//   export default pool                  -> db.default
// If your db.js exports something else, change this one line.
import * as db from "../db.js";

export const pool = db.pool ?? db.default;