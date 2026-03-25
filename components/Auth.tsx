
import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Mail, Lock, LogIn, Loader2, AlertCircle, ShieldCheck, ExternalLink } from 'lucide-react';
import { getPublicResidentialFormPath } from '../utils/publicUrls';

interface AuthProps {
  onSessionUpdate: () => void;
}

const Auth: React.FC<AuthProps> = ({ onSessionUpdate }) => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      onSessionUpdate();
    } catch (err: any) {
      setError(err.message === 'Invalid login credentials' 
        ? 'E-mail ou senha incorretos.' 
        : err.message || 'Ocorreu um erro na autenticação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decor */}
      <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#C69C6D] opacity-[0.05] rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[500px] h-[500px] bg-[#1B263B] opacity-[0.2] rounded-full blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-10 shadow-2xl">
          <div className="flex flex-col items-center mb-10">
            <div className="w-20 h-20 bg-[#1B263B] border-2 border-[#C69C6D]/30 rounded-3xl flex items-center justify-center mb-6 shadow-xl">
              <ShieldCheck size={40} className="text-[#C69C6D]" />
            </div>
            <h1 className="text-white text-3xl font-black tracking-tighter">F&G Hub</h1>
            <p className="text-[#C69C6D] text-[10px] font-black uppercase tracking-[4px] mt-2">Acesso Restrito</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">E-mail Corporativo</label>
              <div className="relative">
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-[#C69C6D]/50 transition-all font-medium"
                  placeholder="exemplo@fgsegurogarantia.com.br"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Senha</label>
              <div className="relative">
                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white placeholder:text-slate-600 outline-none focus:ring-2 focus:ring-[#C69C6D]/50 transition-all font-medium"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-center gap-3 text-xs font-bold">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#C69C6D] hover:bg-[#b58a5b] text-white py-4 rounded-2xl font-black tracking-widest uppercase text-sm shadow-lg shadow-[#C69C6D]/20 transition-all active:scale-95 flex items-center justify-center gap-3"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={20} />
              ) : (
                <LogIn size={20} />
              )}
              {loading ? 'Autenticando...' : 'Entrar no Sistema'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <a
              href={getPublicResidentialFormPath()}
              className="inline-flex items-center gap-2 text-[#C69C6D] text-xs font-bold hover:underline"
            >
              <ExternalLink size={14} className="shrink-0" />
              É cliente? Solicite cotação de Seguro Residencial / Locatícia
            </a>
          </div>

          <div className="mt-8 pt-8 border-t border-white/5">
            <p className="text-center text-slate-500 text-[10px] font-bold uppercase tracking-widest leading-relaxed">
              Sistema de uso exclusivo para colaboradores autorizados da F&G Corretora.
            </p>
          </div>
        </div>

        <p className="text-center text-slate-600 text-[10px] mt-10 font-bold uppercase tracking-[2px]">
          &copy; 2026 F&G Corretora de Seguros. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
};

export default Auth;
