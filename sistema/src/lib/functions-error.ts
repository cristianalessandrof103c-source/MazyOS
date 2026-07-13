// Edge Functions chamadas via supabase.functions.invoke que retornam status != 2xx caem como
// FunctionsHttpError, cuja .message é genérica ("Edge Function returned a non-2xx status
// code") — o corpo JSON de verdade (nosso { error }) fica em error.context (a Response crua).
export async function extrairErroFuncao(error: unknown): Promise<string> {
  const err = error as { message?: string; context?: Response }
  if (err.context) {
    try {
      const body = await err.context.clone().json()
      if (body?.error) return body.error as string
    } catch {
      // resposta sem corpo JSON — segue com a mensagem genérica
    }
  }
  return err.message ?? 'Falha inesperada'
}
