/**
 * Contexto global compartilhado entre os analisadores (Contrato/Licitante)
 * e o ChatWidget, permitindo que o chat leia e atualize os campos da análise.
 */

type ResultType = 'contrato' | 'licitante';
type UpdateCallback = (updates: Record<string, unknown>) => void;

let _result: Record<string, unknown> | null = null;
let _type: ResultType | null = null;
let _onUpdate: UpdateCallback | null = null;

export function setAnalysisContext(
  result: Record<string, unknown>,
  type: ResultType,
  onUpdate: UpdateCallback
) {
  _result = result;
  _type = type;
  _onUpdate = onUpdate;
}

export function clearAnalysisContext() {
  _result = null;
  _type = null;
  _onUpdate = null;
}

export function getAnalysisContext() {
  return { result: _result, type: _type };
}

export function applyAnalysisUpdate(updates: Record<string, unknown>) {
  if (_onUpdate) _onUpdate(updates);
}
