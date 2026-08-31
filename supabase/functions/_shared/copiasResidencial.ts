// Cópias adicionais (Cco) dos e-mails do módulo Residencial.
//
// Lê residencial_config.copias_adicionais (migração 044) direto pelo PostgREST
// com a service role — sem depender do supabase-js, porque nem toda function
// que envia e-mail cria um client (ex.: send-boleto-email).
//
// Falha aqui NUNCA pode segurar o envio: se a leitura der errado, devolve
// lista vazia e o e-mail sai como sempre saiu (só com o Cco do Fábio).
export async function copiasResidencial(): Promise<string[]> {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return [];
    const res = await fetch(`${url}/rest/v1/residencial_config?select=copias_adicionais&id=eq.1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return [];
    const rows = await res.json();
    const lista = rows?.[0]?.copias_adicionais;
    if (!Array.isArray(lista)) return [];
    return lista.filter((e: unknown): e is string => typeof e === 'string' && e.includes('@'));
  } catch {
    return [];
  }
}

/** Cco final: o fixo (Fábio) + as cópias configuradas, sem duplicata. */
export async function bccResidencial(fixo: string): Promise<string[]> {
  return [...new Set([fixo, ...(await copiasResidencial())])];
}
