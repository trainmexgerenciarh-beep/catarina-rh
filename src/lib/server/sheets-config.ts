/** Destinos expresamente entregados por Trainmex. No son credenciales.
 * No se permite redirigir exportaciones a un archivo arbitrario desde la UI. */
export const DIRECTORY_SHEET_ID="1O07l76lvHsRo869ODOB9z7G76PnZRuw_sbBQqwlf4a8";
export const EXPORT_SHEET_ID="1lLpgaLr3Y7-9u0p45alq3txRS42M8mQAesu3gibXpvI";
// Read all used cells, then enforce size/row/header limits. A fixed A1:G202
// range could silently omit employees or unexpected columns further down.
export const DIRECTORY_RANGE="'Hoja 1'";
