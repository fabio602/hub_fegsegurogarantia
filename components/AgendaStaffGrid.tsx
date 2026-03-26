import React, { useRef } from 'react';
import { Camera, Edit2, Trash2 } from 'lucide-react';

export type AgendaStaffGridItem = {
  id: string;
  nome: string;
  cargo: string;
  fotoUrl?: string | null;
};

type AgendaStaffGridProps = {
  items: AgendaStaffGridItem[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onUploadPhoto: (id: string, file: File) => void;
};

const letterOfName = (name: string) => {
  const n = (name || '').trim();
  if (!n) return '?';
  return n[0].toUpperCase();
};

const uniqueColorByLetter = (letter: string) => {
  const l = (letter || '?').charCodeAt(0);
  const hue = (l * 37) % 360;
  return `hsl(${hue} 75% 45%)`;
};

const AgendaStaffGrid: React.FC<AgendaStaffGridProps> = ({
  items,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onUploadPhoto,
}) => {
  const inputByIdRef = useRef<Record<string, HTMLInputElement | null>>({});

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((s) => {
        const initial = letterOfName(s.nome);
        const selected = selectedId === s.id;
        const avatarBg = uniqueColorByLetter(initial);

        return (
          <div
            key={s.id}
            onClick={() => onSelect?.(s.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(s.id);
              }
            }}
            className={`group relative text-left rounded-2xl border bg-white p-4 transition-all cursor-pointer select-none outline-none
              ${selected ? 'border-[#C69C6D] ring-2 ring-[#C69C6D]/25' : 'border-slate-200 hover:border-[#C69C6D]/40'}
            `}
            aria-pressed={selected}
          >
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 border border-slate-200 bg-slate-50">
                {s.fotoUrl ? (
                  <img
                    src={s.fotoUrl}
                    alt={s.nome}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    draggable={false}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.preventDefault()}
                    onDragStart={(e) => e.preventDefault()}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = '';
                    }}
                  />
                ) : (
                  <div
                    className="w-full h-full flex items-center justify-center"
                    style={{ backgroundColor: avatarBg }}
                    aria-hidden
                  >
                    <span className="text-white font-black text-sm">{initial}</span>
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="font-black text-sm text-[#1B263B] truncate">{s.nome}</div>
                <div className="text-xs text-slate-500 font-bold mt-1 truncate">{s.cargo}</div>
              </div>
            </div>

            {/* actions: sempre visíveis no mobile; hover no desktop */}
            <div className="absolute top-3 right-3 flex items-center gap-2 opacity-100 pointer-events-auto sm:opacity-0 sm:pointer-events-none sm:group-hover:opacity-100 sm:group-hover:pointer-events-auto transition-opacity">
              <input
                ref={(el) => {
                  inputByIdRef.current[s.id] = el;
                }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  // permite selecionar a mesma foto novamente
                  e.currentTarget.value = '';
                  if (!f) return;
                  onUploadPhoto(s.id, f);
                }}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  inputByIdRef.current[s.id]?.click();
                }}
                className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-[#1B263B] hover:border-[#C69C6D]/40 hover:bg-[#C69C6D]/10 transition-colors"
                aria-label={`Enviar foto de ${s.nome}`}
                title="Enviar foto"
              >
                <Camera size={16} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(s.id);
                }}
                className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-[#C69C6D] hover:border-[#C69C6D]/40 hover:bg-[#C69C6D]/10 transition-colors"
                aria-label={`Editar ${s.nome}`}
              >
                <Edit2 size={16} />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-rose-500 hover:border-rose-500 hover:bg-rose-50 transition-colors"
                aria-label={`Excluir ${s.nome}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default AgendaStaffGrid;

