import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  ListChecks,
  Clock,
  Loader2,
  Trash2,
  Copy,
  ArrowRightLeft,
  Pencil,
} from 'lucide-react';
import AgendaStaffGrid, { AgendaStaffGridItem } from './AgendaStaffGrid';

type AgendaStatus = 'pending' | 'completed';
const TZ_BR = 'America/Sao_Paulo';

interface AgendaStaff {
  id: string;
  name: string;
  avatar_url?: string | null;
  cargo?: string | null;
}

interface AgendaTask {
  id: string;
  staff_id: string;
  title: string;
  due_date: string;
  status: AgendaStatus;
  source_crm_task_id?: string | null;
  prospect_id?: string | null;
  sale_id?: number | null;
}

interface AgendaTaskItem {
  id: string;
  task_id: string;
  text: string;
  done: boolean;
  sort_order: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function ymdFromDateInBrt(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_BR }).format(d); // YYYY-MM-DD
}

function safeYmdFromIsoInBrt(iso: string): string | null {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return ymdFromDateInBrt(d);
  } catch {
    return null;
  }
}

function safeTimeFromIsoInBrt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '--:--';
    return new Intl.DateTimeFormat('pt-BR', { timeZone: TZ_BR, hour: '2-digit', minute: '2-digit' }).format(d);
  } catch {
    return '--:--';
  }
}

function brtIsoFromYmdAndTime(ymd: string, hour = 12, minute = 0) {
  // BRT = UTC-3
  const [yy, mm, dd] = ymd.split('-').map(Number);
  const utcHour = hour + 3;
  return new Date(Date.UTC(yy, mm - 1, dd, utcHour, minute, 0)).toISOString();
}

/** Preserva o horário do cartão ao mover/copiar para outro dia (calendário BRT). */
function brtHourMinuteFromIso(iso: string): { h: number; m: number } {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { h: 12, m: 0 };
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ_BR,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '12');
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
    return { h: hour, m: minute };
  } catch {
    return { h: 12, m: 0 };
  }
}

function brtIsoFromYmdAndTimeInput(ymd: string, timeStr: string) {
  const t = timeStr.trim();
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return brtIsoFromYmdAndTime(ymd, 12, 0);
  const hour = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const minute = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  if (Number.isNaN(hour) || Number.isNaN(minute)) return brtIsoFromYmdAndTime(ymd, 12, 0);
  return brtIsoFromYmdAndTime(ymd, hour, minute);
}

function brtMondayOf(ymd: string) {
  // Retorna uma data "âncora" em BRT (representada em UTC) para permitir navegação por semanas.
  // Construímos 12:00 BRT (15:00 UTC) e calculamos o Monday via UTC (dia equivalente em BRT).
  const [yy, mm, dd] = ymd.split('-').map(Number);
  const anchor = new Date(Date.UTC(yy, mm - 1, dd, 15, 0, 0)); // 12:00 BRT
  const dow = anchor.getUTCDay(); // 0..6 (Sun..Sat) no mesmo "dia" do BRT
  const offsetToMonday = (dow + 6) % 7; // Monday => 0
  anchor.setUTCDate(anchor.getUTCDate() - offsetToMonday);
  return anchor;
}

function addDaysUtc(date: Date, days: number) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function dayNamePtShort(isoYmd: string) {
  const [yy, mm, dd] = isoYmd.split('-').map(Number);
  const dt = new Date(Date.UTC(yy, mm - 1, dd, 15, 0, 0)); // 12:00 BRT
  const names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  return names[dt.getUTCDay()];
}

function brtYmdRange(startMondayAnchorUtc: Date) {
  const monday = startMondayAnchorUtc;
  const mondayYmd = ymdFromDateInBrt(monday);
  const days = Array.from({ length: 5 }, (_, i) => addDaysUtc(monday, i));
  const ymds = days.map(d => ymdFromDateInBrt(d));
  const weekStartIso = brtIsoFromYmdAndTime(mondayYmd, 0, 0);
  const weekEndExclusiveIso = brtIsoFromYmdAndTime(ymds[4], 23, 59);
  // Para lt: usa próximo dia 00:00
  const fridayYmd = ymds[4];
  const saturdayYmd = ymdFromDateInBrt(addDaysUtc(brtMondayOf(fridayYmd), 5)); // Saturday
  const weekEnd = brtIsoFromYmdAndTime(saturdayYmd, 0, 0);
  return { mondayYmd, ymds, weekStartIso, weekEndExclusiveIso: weekEnd };
}

function parseBulletLines(raw: string) {
  return raw
    .split('\n')
    .map(s => s.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);
}

const AgendaHub: React.FC = () => {
  const [staff, setStaff] = useState<AgendaStaff[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');

  const todayYmdInBrt = useMemo(() => ymdFromDateInBrt(new Date()), []);
  const [weekAnchorUtc, setWeekAnchorUtc] = useState(() => brtMondayOf(todayYmdInBrt)); // Monday anchor (UTC at 12:00 BRT)

  const { mondayYmd, ymds: weekDaysYmd, weekStartIso, weekEndExclusiveIso } = useMemo(
    () => brtYmdRange(weekAnchorUtc),
    [weekAnchorUtc],
  );

  const [tasks, setTasks] = useState<AgendaTask[]>([]);
  const [itemsByTaskId, setItemsByTaskId] = useState<Record<string, AgendaTaskItem[]>>({});
  const [loadingTasks, setLoadingTasks] = useState(false);

  const [addingStaff, setAddingStaff] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffCargo, setNewStaffCargo] = useState('Responsável');

  // Create task modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createDayYmd, setCreateDayYmd] = useState<string>(weekDaysYmd[0]);
  const [createTitle, setCreateTitle] = useState('');
  const [createChecklistRaw, setCreateChecklistRaw] = useState('');
  const [creating, setCreating] = useState(false);

  // Per-card add item modal
  const [cardItemModal, setCardItemModal] = useState<{ open: boolean; taskId: string; text: string }>({
    open: false,
    taskId: '',
    text: '',
  });

  const [dayPickerModal, setDayPickerModal] = useState<{
    open: boolean;
    mode: 'copy' | 'move';
    task: AgendaTask | null;
    busy: boolean;
  }>({ open: false, mode: 'copy', task: null, busy: false });

  const [editTaskModal, setEditTaskModal] = useState<{
    open: boolean;
    task: AgendaTask | null;
    title: string;
    dayYmd: string;
    timeStr: string;
    saving: boolean;
  }>({
    open: false,
    task: null,
    title: '',
    dayYmd: '',
    timeStr: '12:00',
    saving: false,
  });

  const selectedStaff = useMemo(() => staff.find(s => s.id === selectedStaffId) || null, [staff, selectedStaffId]);
  const staffCards = useMemo<AgendaStaffGridItem[]>(
    () =>
      staff.map((s) => ({
        id: s.id,
        nome: s.name,
        cargo: s.cargo || 'Responsável',
        fotoUrl: s.avatar_url || null,
      })),
    [staff],
  );

  const refreshStaff = async () => {
    const { data, error } = await supabase.from('agenda_staff').select('id, name, cargo, avatar_url').order('name');
    if (error) throw error;
    setStaff(data || []);
  };

  useEffect(() => {
    void (async () => {
      try {
        await refreshStaff();
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedStaffId && staff.length > 0) {
      setSelectedStaffId(staff[0].id);
    }
  }, [staff, selectedStaffId]);

  const refreshTasks = async () => {
    if (!selectedStaffId) return;
    setLoadingTasks(true);
    try {
      const { data: tData, error: tErr } = await supabase
        .from('agenda_tasks')
        .select('id, staff_id, title, due_date, status, source_crm_task_id, prospect_id, sale_id')
        .eq('staff_id', selectedStaffId)
        .gte('due_date', weekStartIso)
        .lt('due_date', weekEndExclusiveIso)
        .order('due_date', { ascending: true });

      if (tErr) throw tErr;

      const t = (tData || []) as AgendaTask[];
      setTasks(t);

      const taskIds = t.map(x => x.id);
      if (taskIds.length === 0) {
        setItemsByTaskId({});
        return;
      }

      const { data: itemData, error: iErr } = await supabase
        .from('agenda_task_items')
        .select('id, task_id, text, done, sort_order')
        .in('task_id', taskIds)
        .order('sort_order', { ascending: true });

      if (iErr) throw iErr;

      const map: Record<string, AgendaTaskItem[]> = {};
      (itemData || []).forEach((it: any) => {
        const key = String(it.task_id);
        if (!map[key]) map[key] = [];
        map[key].push({
          id: it.id,
          task_id: it.task_id,
          text: it.text,
          done: it.done,
          sort_order: it.sort_order,
        });
      });

      setItemsByTaskId(map);
    } finally {
      setLoadingTasks(false);
    }
  };

  useEffect(() => {
    void refreshTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStaffId, mondayYmd, weekStartIso, weekEndExclusiveIso]);

  const dayKeyForDueDate = (due: string) => safeYmdFromIsoInBrt(due);

  const tasksByDay = useMemo(() => {
    const map: Record<string, AgendaTask[]> = {};
    weekDaysYmd.forEach(d => (map[d] = []));
    tasks.forEach(t => {
      const key = dayKeyForDueDate(t.due_date);
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(t);
    });
    return map;
  }, [tasks, weekDaysYmd]);

  const openCreateForDay = (dayYmd: string) => {
    setCreateDayYmd(dayYmd);
    setCreateTitle('');
    setCreateChecklistRaw('');
    setIsCreateModalOpen(true);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffId) return;
    const title = createTitle.trim();
    if (!title) return;

    setCreating(true);
    try {
      const due = brtIsoFromYmdAndTime(createDayYmd, 12, 0);

      const { data: inserted, error: insErr } = await supabase
        .from('agenda_tasks')
        .insert([
          {
            staff_id: selectedStaffId,
            title,
            due_date: due,
            status: 'pending',
            prospect_id: null,
            sale_id: null,
            source_crm_task_id: null,
          },
        ])
        .select('id')
        .single();

      if (insErr) throw insErr;

      const taskId = inserted.id as string;
      const bullets = parseBulletLines(createChecklistRaw);

      if (bullets.length > 0) {
        const rows = bullets.map((b, idx) => ({
          task_id: taskId,
          text: b,
          done: false,
          sort_order: idx,
        }));

        const { error: itemErr } = await supabase.from('agenda_task_items').insert(rows);
        if (itemErr) throw itemErr;
      }

      await refreshTasks();
      setIsCreateModalOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const toggleItemDone = async (item: AgendaTaskItem) => {
    await supabase.from('agenda_task_items').update({ done: !item.done }).eq('id', item.id);
    setItemsByTaskId(prev => {
      const next = { ...prev };
      const arr = next[item.task_id] ? [...next[item.task_id]] : [];
      const i = arr.findIndex(x => x.id === item.id);
      if (i >= 0) arr[i] = { ...arr[i], done: !item.done };
      next[item.task_id] = arr;
      return next;
    });
  };

  const toggleTaskStatus = async (task: AgendaTask) => {
    const newStatus: AgendaStatus = task.status === 'pending' ? 'completed' : 'pending';
    await supabase.from('agenda_tasks').update({ status: newStatus }).eq('id', task.id);
    setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, status: newStatus } : t)));
  };

  const deleteTask = async (task: AgendaTask) => {
    if (!confirm('Excluir esta tarefa da Agenda?')) return;
    await supabase.from('agenda_tasks').delete().eq('id', task.id);
    await refreshTasks();
  };

  const copyTaskToDay = async (task: AgendaTask, targetYmd: string) => {
    const { h, m } = brtHourMinuteFromIso(task.due_date);
    const due = brtIsoFromYmdAndTime(targetYmd, h, m);
    const items = itemsByTaskId[task.id] || [];

    const { data: inserted, error: insErr } = await supabase
      .from('agenda_tasks')
      .insert([
        {
          staff_id: task.staff_id,
          title: task.title,
          due_date: due,
          status: 'pending' as AgendaStatus,
          prospect_id: task.prospect_id ?? null,
          sale_id: task.sale_id ?? null,
          source_crm_task_id: null,
        },
      ])
      .select('id')
      .single();

    if (insErr) throw insErr;
    const newId = inserted!.id as string;

    if (items.length > 0) {
      const rows = items.map((it, idx) => ({
        task_id: newId,
        text: it.text,
        done: false,
        sort_order: idx,
      }));
      const { error: itemErr } = await supabase.from('agenda_task_items').insert(rows);
      if (itemErr) throw itemErr;
    }
  };

  const moveTaskToDay = async (task: AgendaTask, targetYmd: string) => {
    const { h, m } = brtHourMinuteFromIso(task.due_date);
    const newDue = brtIsoFromYmdAndTime(targetYmd, h, m);

    if (task.source_crm_task_id) {
      const { error } = await supabase
        .from('crm_tasks')
        .update({ due_date: newDue })
        .eq('id', task.source_crm_task_id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('agenda_tasks').update({ due_date: newDue }).eq('id', task.id);
      if (error) throw error;
    }
  };

  const applyDayPickerChoice = async (targetYmd: string) => {
    const task = dayPickerModal.task;
    if (!task) return;
    const currentYmd = dayKeyForDueDate(task.due_date);
    if (dayPickerModal.mode === 'move' && currentYmd === targetYmd) return;

    setDayPickerModal(prev => ({ ...prev, busy: true }));
    try {
      if (dayPickerModal.mode === 'copy') {
        await copyTaskToDay(task, targetYmd);
      } else {
        await moveTaskToDay(task, targetYmd);
      }
      setDayPickerModal({ open: false, mode: 'copy', task: null, busy: false });
      await refreshTasks();
    } catch (e: any) {
      alert(e?.message || 'Não foi possível concluir a ação.');
      setDayPickerModal(prev => ({ ...prev, busy: false }));
    }
  };

  const openDayPicker = (mode: 'copy' | 'move', task: AgendaTask) => {
    setDayPickerModal({ open: true, mode, task, busy: false });
  };

  const openEditTaskModal = (task: AgendaTask) => {
    const ymd = dayKeyForDueDate(task.due_date) || weekDaysYmd[0];
    const { h, m } = brtHourMinuteFromIso(task.due_date);
    setEditTaskModal({
      open: true,
      task,
      title: task.title,
      dayYmd: ymd,
      timeStr: `${pad2(h)}:${pad2(m)}`,
      saving: false,
    });
  };

  const saveEditTaskModal = async () => {
    const task = editTaskModal.task;
    if (!task) return;
    const title = editTaskModal.title.trim();
    if (!title) return;
    const due = brtIsoFromYmdAndTimeInput(editTaskModal.dayYmd, editTaskModal.timeStr);

    setEditTaskModal(prev => ({ ...prev, saving: true }));
    try {
      if (task.source_crm_task_id) {
        const { error } = await supabase
          .from('crm_tasks')
          .update({ title, due_date: due })
          .eq('id', task.source_crm_task_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('agenda_tasks')
          .update({ title, due_date: due })
          .eq('id', task.id);
        if (error) throw error;
      }
      setEditTaskModal({
        open: false,
        task: null,
        title: '',
        dayYmd: '',
        timeStr: '12:00',
        saving: false,
      });
      await refreshTasks();
    } catch (e: any) {
      alert(e?.message || 'Erro ao salvar o cartão.');
      setEditTaskModal(prev => ({ ...prev, saving: false }));
    }
  };

  const addCardItem = async (taskId: string, text: string) => {
    const t = text.trim();
    if (!t) return;

    const existing = itemsByTaskId[taskId] || [];
    const sortOrder = existing.length;

    await supabase.from('agenda_task_items').insert([
      {
        task_id: taskId,
        text: t,
        done: false,
        sort_order: sortOrder,
      },
    ]);
    setCardItemModal({ open: false, taskId: '', text: '' });
    await refreshTasks();
  };

  const openAddItemModal = (taskId: string) => {
    setCardItemModal({ open: true, taskId, text: '' });
  };

  const [editStaffModal, setEditStaffModal] = useState<{
    open: boolean;
    staffId: string;
    name: string;
    cargo: string;
    saving: boolean;
  }>({ open: false, staffId: '', name: '', cargo: 'Responsável', saving: false });

  const openEditStaffModal = (staffId: string) => {
    const s = staff.find(x => x.id === staffId);
    if (!s) return;
    setEditStaffModal({
      open: true,
      staffId,
      name: s.name || '',
      cargo: s.cargo || 'Responsável',
      saving: false,
    });
  };

  const saveEditStaffModal = async () => {
    const name = editStaffModal.name.trim();
    const cargo = editStaffModal.cargo.trim() || 'Responsável';
    if (!name) return;

    setEditStaffModal(prev => ({ ...prev, saving: true }));
    try {
      const { error } = await supabase
        .from('agenda_staff')
        .update({ name, cargo })
        .eq('id', editStaffModal.staffId);
      if (error) throw error;

      setEditStaffModal({ open: false, staffId: '', name: '', cargo: 'Responsável', saving: false });
      await refreshStaff();
    } catch (e: any) {
      alert(e?.message || 'Erro ao salvar funcionário.');
      setEditStaffModal(prev => ({ ...prev, saving: false }));
    }
  };

  const deleteStaff = async (staffId: string) => {
    if (!confirm('Excluir este funcionário da Agenda? As tarefas vinculadas serão removidas.')) return;
    // Libera vínculos em crm_tasks (evita FK/violação)
    await supabase.from('crm_tasks').update({ assigned_staff_id: null }).eq('assigned_staff_id', staffId);
    await supabase.from('agenda_staff').delete().eq('id', staffId);
    await refreshStaff();
    if (selectedStaffId === staffId) {
      setSelectedStaffId('');
    }
  };

  const uploadStaffAvatar = async (staffId: string, file: File) => {
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const safeExt = ext.replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${staffId}/avatar.${safeExt}`;

      const { error: upErr } = await supabase.storage.from('agenda-avatars').upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from('agenda-avatars').getPublicUrl(path);
      const url = `${data.publicUrl}?v=${Date.now()}`; // cache-bust

      const { error: dbErr } = await supabase.from('agenda_staff').update({ avatar_url: url }).eq('id', staffId);
      if (dbErr) throw dbErr;

      await refreshStaff();
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Erro ao enviar foto.');
    }
  };

  const addStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newStaffName.trim();
    if (!name) return;
    const cargo = (newStaffCargo || '').trim() || 'Responsável';
    const { error } = await supabase.from('agenda_staff').insert([{ name, cargo }]);
    if (error) {
      alert(error.message || 'Erro ao adicionar funcionário.');
      return;
    }
    setNewStaffName('');
    setNewStaffCargo('Responsável');
    setAddingStaff(false);
    await refreshStaff();
  };

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-col lg:flex-row">
          <div>
            <div className="inline-flex items-center gap-2 bg-[#C69C6D]/15 text-[#C69C6D] px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-[#C69C6D]/25">
              <Calendar size={12} /> Agenda (Hub)
            </div>
            <h3 className="text-2xl font-black text-[#1B263B] mt-3">Agenda Semanal</h3>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Organização é um dos segredos do sucesso: planeje sua semana com clareza e execute com foco.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start lg:self-center">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setWeekAnchorUtc(prev => addDaysUtc(prev, -7));
              }}
              className="p-2 rounded-xl border border-slate-200 hover:border-[#C69C6D]/50 hover:bg-[#C69C6D]/10 transition-all"
              aria-label="Semana anterior"
            >
              <ChevronLeft size={18} className="text-[#1B263B]" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setWeekAnchorUtc(brtMondayOf(ymdFromDateInBrt(new Date())));
              }}
              className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-center hover:border-[#C69C6D]/50 hover:bg-[#C69C6D]/10 transition-all"
              aria-label="Ir para a semana atual"
            >
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Semana</div>
              <div className="text-sm font-black text-[#1B263B]">
                {weekDaysYmd[0].split('-').reverse().join('/') + ' - ' + weekDaysYmd[4].split('-').reverse().join('/')}
              </div>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setWeekAnchorUtc(prev => addDaysUtc(prev, 7));
              }}
              className="p-2 rounded-xl border border-slate-200 hover:border-[#C69C6D]/50 hover:bg-[#C69C6D]/10 transition-all"
              aria-label="Próxima semana"
            >
              <ChevronRight size={18} className="text-[#1B263B]" />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Staff list */}
        <div className="space-y-4">
          <div className="bg-white rounded-[2rem] p-5 border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div />
              <button
                type="button"
                onClick={() => {
                  setAddingStaff(true);
                  setNewStaffName('');
                  setNewStaffCargo('Responsável');
                }}
                className="text-xs font-black text-[#C69C6D] hover:text-[#b58a5b] transition-colors"
              >
                <Plus size={14} className="inline mr-1" />
                Adicionar
              </button>
            </div>

            {addingStaff && (
              <form onSubmit={addStaff} className="mb-4">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={newStaffName}
                    onChange={(e) => setNewStaffName(e.target.value)}
                    placeholder="Nome do funcionário"
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/25 focus:border-[#C69C6D]"
                    autoFocus
                  />
                  <input
                    value={newStaffCargo}
                    onChange={(e) => setNewStaffCargo(e.target.value)}
                    placeholder="Cargo/Função"
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/25 focus:border-[#C69C6D]"
                  />
                  <button
                    type="button"
                    onClick={() => setAddingStaff(false)}
                    className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50"
                  >
                    <X size={16} className="inline" />
                  </button>
                </div>
              </form>
            )}

            {staff.length === 0 ? (
              <div className="text-xs text-slate-500 italic">Nenhum funcionário cadastrado.</div>
            ) : (
              <AgendaStaffGrid
                items={staffCards}
                selectedId={selectedStaffId}
                onSelect={(id) => setSelectedStaffId(id)}
                onEdit={(id) => openEditStaffModal(id)}
                onDelete={(id) => void deleteStaff(id)}
                onUploadPhoto={(id, file) => void uploadStaffAvatar(id, file)}
              />
            )}
          </div>
        </div>

        {/* Trello board */}
        <div>
          <div className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-xs font-black text-slate-400 uppercase tracking-widest">Visão semanal</div>
                <div className="text-lg font-black text-[#1B263B] truncate">
                  {selectedStaff ? selectedStaff.name : 'Selecione um funcionário'}
                </div>
              </div>
              <div className="text-xs text-slate-500 font-bold flex items-center gap-2">
                <Clock size={14} className="text-[#C69C6D]" />
                <span>Pendente vs concluído</span>
              </div>
            </div>

            <div className="flex gap-4 overflow-x-auto pb-3">
              {weekDaysYmd.map(dayYmd => {
                const list = tasksByDay[dayYmd] || [];
                const title = `${dayNamePtShort(dayYmd)} ${dayYmd.split('-').reverse().join('/')}`;

                return (
                  <div key={dayYmd} className="min-w-[280px] max-w-[280px]">
                    <div className="flex items-center justify-between mb-3">
                      <div className="px-3 py-2 rounded-2xl border border-slate-200 bg-slate-50">
                        <div className="text-xs font-black text-slate-500 uppercase tracking-widest">{title}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openCreateForDay(dayYmd)}
                        className="p-2 rounded-xl bg-[#C69C6D]/15 border border-[#C69C6D]/30 text-[#C69C6D] hover:bg-[#C69C6D]/25 transition-colors"
                        aria-label="Adicionar cartão"
                      >
                        <Plus size={16} />
                      </button>
                    </div>

                    <div className="space-y-3">
                      {list.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-4">
                          <div className="text-xs font-bold text-slate-400">Sem tarefas</div>
                          <div className="text-[10px] text-slate-500 mt-1">Clique em + para criar</div>
                        </div>
                      )}

                      {list.map(t => {
                        const its = itemsByTaskId[t.id] || [];
                        const isDone = t.status === 'completed';
                        return (
                          <div
                            key={t.id}
                            className={`rounded-[1.4rem] border p-3 overflow-hidden transition-all ${isDone ? 'bg-slate-50 border-slate-200' : 'bg-white border-[#C69C6D]/25'}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <button
                                type="button"
                                onClick={() => toggleTaskStatus(t)}
                                className="min-w-0 text-left"
                                aria-label="Alternar status"
                              >
                                <div className={`text-sm font-black truncate ${isDone ? 'text-slate-400 line-through' : 'text-[#1B263B]'}`}>
                                  {t.title}
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                  <span
                                    className={`text-[10px] font-black px-2 py-1 rounded-full border ${isDone ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-[#C69C6D]/12 text-[#1B263B] border-[#C69C6D]/25'}`}
                                  >
                                    {isDone ? 'Concluído' : 'Pendente'}
                                  </span>
                                  <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                                    <Clock size={10} />
                                    {safeTimeFromIsoInBrt(t.due_date)}
                                  </span>
                                </div>
                              </button>

                              <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openEditTaskModal(t);
                                  }}
                                  className="p-2 rounded-xl text-slate-400 hover:text-[#1B263B] hover:bg-[#C69C6D]/15 transition-colors"
                                  title="Editar cartão"
                                  aria-label="Editar cartão"
                                >
                                  <Pencil size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openDayPicker('copy', t);
                                  }}
                                  className="p-2 rounded-xl text-slate-400 hover:text-[#1B263B] hover:bg-[#C69C6D]/15 transition-colors"
                                  title="Copiar para outro dia"
                                  aria-label="Copiar cartão para outro dia"
                                >
                                  <Copy size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openDayPicker('move', t);
                                  }}
                                  className="p-2 rounded-xl text-slate-400 hover:text-[#1B263B] hover:bg-[#C69C6D]/15 transition-colors"
                                  title="Mover para outro dia"
                                  aria-label="Mover cartão para outro dia"
                                >
                                  <ArrowRightLeft size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    void deleteTask(t);
                                  }}
                                  className="p-2 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                                  aria-label="Excluir tarefa"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>

                            <div className="mt-3 space-y-2">
                              {its.length === 0 ? (
                                <div className="text-xs text-slate-400 italic">Sem itens de checklist</div>
                              ) : (
                                its.map(it => (
                                  <label key={it.id} className="flex items-start gap-2 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={it.done}
                                      onChange={() => toggleItemDone(it)}
                                      className="mt-0.5 accent-[#C69C6D]"
                                    />
                                    <span className={`text-xs font-medium ${it.done ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                                      {it.text}
                                    </span>
                                  </label>
                                ))
                              )}

                              <div className="pt-1">
                                <button
                                  type="button"
                                  onClick={() => openAddItemModal(t.id)}
                                  className="text-[11px] font-bold text-[#C69C6D] hover:text-[#b58a5b] transition-colors flex items-center gap-2"
                                >
                                  <ListChecks size={14} />
                                  Adicionar item
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {loadingTasks && list.length === 0 && (
                        <div className="flex justify-center py-4">
                          <Loader2 size={18} className="animate-spin text-slate-300" />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Create task modal */}
      {isCreateModalOpen && createPortal(
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => !creating && setIsCreateModalOpen(false)}
            aria-label="Fechar"
          />
          <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-lg border border-[#C69C6D]/25">
            <div className="p-6 border-b border-[#C69C6D]/20 bg-[#1B263B] text-white rounded-t-[2rem]">
              <h3 className="text-lg font-black flex items-center gap-2">
                <Plus size={18} className="text-[#C69C6D]" />
                Nova tarefa — {dayNamePtShort(createDayYmd)} {createDayYmd.split('-').reverse().join('/')}
              </h3>
              <p className="text-xs text-white/70 font-medium mt-1">Checklist em linhas separadas (cada linha vira um item).</p>
            </div>

            <form onSubmit={handleCreateTask} className="p-6 space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Título</label>
                <input
                  value={createTitle}
                  onChange={(e) => setCreateTitle(e.target.value)}
                  placeholder="Ex: Ligar para cliente e confirmar documentação"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/25 focus:border-[#C69C6D]"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Checklist (bullets)</label>
                <textarea
                  value={createChecklistRaw}
                  onChange={(e) => setCreateChecklistRaw(e.target.value)}
                  placeholder={'- item 1\n- item 2\n- item 3'}
                  rows={5}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/25 focus:border-[#C69C6D] resize-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => !creating && setIsCreateModalOpen(false)}
                  className="flex-1 px-4 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 px-4 py-3 rounded-xl bg-[#C69C6D] text-[#1B263B] font-black hover:bg-[#b58a5b] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {creating ? <Loader2 size={18} className="animate-spin" /> : <Plus size={16} />}
                  Criar
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      {/* Add checklist item modal */}
      {cardItemModal.open && createPortal(
        <div className="fixed inset-0 z-[100001] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setCardItemModal({ open: false, taskId: '', text: '' })}
            aria-label="Fechar"
          />
          <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-md border border-[#C69C6D]/25">
            <div className="p-6 border-b border-[#C69C6D]/20 bg-[#1B263B] text-white rounded-t-[2rem]">
              <h3 className="text-lg font-black flex items-center gap-2">
                <ListChecks size={18} className="text-[#C69C6D]" />
                Adicionar item ao cartão
              </h3>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void addCardItem(cardItemModal.taskId, cardItemModal.text);
              }}
              className="p-6 space-y-4"
            >
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Item</label>
                <input
                  value={cardItemModal.text}
                  onChange={(e) => setCardItemModal(prev => ({ ...prev, text: e.target.value }))}
                  placeholder="Ex: Enviar documentação por e-mail"
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/25 focus:border-[#C69C6D]"
                  autoFocus
                  required
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCardItemModal({ open: false, taskId: '', text: '' })}
                  className="flex-1 px-4 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 rounded-xl bg-[#C69C6D] text-[#1B263B] font-black hover:bg-[#b58a5b] transition-colors flex items-center justify-center gap-2"
                >
                  <Plus size={16} />
                  Adicionar
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      {/* Edit staff modal */}
      {editStaffModal.open && createPortal(
        <div className="fixed inset-0 z-[100002] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => !editStaffModal.saving && setEditStaffModal({ open: false, staffId: '', name: '', cargo: 'Responsável', saving: false })}
            aria-label="Fechar"
          />
          <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-md border border-[#C69C6D]/25">
            <div className="p-6 border-b border-[#C69C6D]/20 bg-[#1B263B] text-white rounded-t-[2rem]">
              <h3 className="text-lg font-black">Editar funcionário</h3>
              <p className="text-xs text-white/70 font-medium mt-1">Atualize o nome e a função exibida no card.</p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveEditStaffModal();
              }}
              className="p-6 space-y-4"
            >
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nome</label>
                <input
                  value={editStaffModal.name}
                  onChange={(e) => setEditStaffModal(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/25 focus:border-[#C69C6D]"
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cargo/Função</label>
                <input
                  value={editStaffModal.cargo}
                  onChange={(e) => setEditStaffModal(prev => ({ ...prev, cargo: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/25 focus:border-[#C69C6D]"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  disabled={editStaffModal.saving}
                  onClick={() => setEditStaffModal({ open: false, staffId: '', name: '', cargo: 'Responsável', saving: false })}
                  className="flex-1 px-4 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editStaffModal.saving}
                  className="flex-1 px-4 py-3 rounded-xl bg-[#C69C6D] text-[#1B263B] font-black hover:bg-[#b58a5b] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {editStaffModal.saving ? <Loader2 size={18} className="animate-spin" /> : null}
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}

      {dayPickerModal.open && dayPickerModal.task && createPortal(
        <div className="fixed inset-0 z-[100003] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() =>
              !dayPickerModal.busy && setDayPickerModal({ open: false, mode: 'copy', task: null, busy: false })
            }
            aria-label="Fechar"
          />
          <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-md border border-[#C69C6D]/25">
            <div className="p-6 border-b border-[#C69C6D]/20 bg-[#1B263B] text-white rounded-t-[2rem]">
              <h3 className="text-lg font-black flex items-center gap-2">
                {dayPickerModal.mode === 'copy' ? (
                  <Copy size={18} className="text-[#C69C6D]" />
                ) : (
                  <ArrowRightLeft size={18} className="text-[#C69C6D]" />
                )}
                {dayPickerModal.mode === 'copy' ? 'Copiar cartão para…' : 'Mover cartão para…'}
              </h3>
              <p className="text-xs text-white/70 font-medium mt-1">
                Escolha o dia na semana que está visível. O horário do cartão é mantido.
              </p>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-xs text-slate-600 font-medium line-clamp-3">
                <span className="font-black text-[#1B263B]">{dayPickerModal.task.title}</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {weekDaysYmd.map(dayYmd => {
                  const isCurrentDay =
                    dayPickerModal.mode === 'move' &&
                    dayKeyForDueDate(dayPickerModal.task!.due_date) === dayYmd;
                  const label = `${dayNamePtShort(dayYmd)} ${dayYmd.split('-').reverse().join('/')}`;
                  return (
                    <button
                      key={dayYmd}
                      type="button"
                      disabled={dayPickerModal.busy || isCurrentDay}
                      onClick={() => void applyDayPickerChoice(dayYmd)}
                      className={`px-4 py-3 rounded-xl text-left text-sm font-bold border transition-colors ${
                        isCurrentDay
                          ? 'border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed'
                          : 'border-slate-200 hover:border-[#C69C6D]/50 hover:bg-[#C69C6D]/10 text-[#1B263B]'
                      }`}
                    >
                      {label}
                      {isCurrentDay ? (
                        <span className="block text-[10px] font-medium text-slate-400 mt-0.5">Dia atual</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={dayPickerModal.busy}
                onClick={() => setDayPickerModal({ open: false, mode: 'copy', task: null, busy: false })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60"
              >
                Cancelar
              </button>
              {dayPickerModal.busy ? (
                <div className="flex justify-center pt-1">
                  <Loader2 size={20} className="animate-spin text-[#C69C6D]" />
                </div>
              ) : null}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {editTaskModal.open && editTaskModal.task && createPortal(
        <div className="fixed inset-0 z-[100004] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            onClick={() =>
              !editTaskModal.saving &&
              setEditTaskModal({
                open: false,
                task: null,
                title: '',
                dayYmd: '',
                timeStr: '12:00',
                saving: false,
              })
            }
            aria-label="Fechar"
          />
          <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-lg border border-[#C69C6D]/25">
            <div className="p-6 border-b border-[#C69C6D]/20 bg-[#1B263B] text-white rounded-t-[2rem]">
              <h3 className="text-lg font-black flex items-center gap-2">
                <Pencil size={18} className="text-[#C69C6D]" />
                Editar cartão
              </h3>
              <p className="text-xs text-white/70 font-medium mt-1">
                Título, dia da semana visível e horário (referência em horário de Brasília).
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveEditTaskModal();
              }}
              className="p-6 space-y-4"
            >
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Título</label>
                <input
                  value={editTaskModal.title}
                  onChange={(e) => setEditTaskModal(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/25 focus:border-[#C69C6D]"
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dia</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {weekDaysYmd.map(dayYmd => {
                    const selected = editTaskModal.dayYmd === dayYmd;
                    const label = `${dayNamePtShort(dayYmd)} ${dayYmd.split('-').reverse().join('/')}`;
                    return (
                      <button
                        key={dayYmd}
                        type="button"
                        disabled={editTaskModal.saving}
                        onClick={() => setEditTaskModal(prev => ({ ...prev, dayYmd }))}
                        className={`px-3 py-2 rounded-xl text-left text-xs font-bold border transition-colors ${
                          selected
                            ? 'border-[#C69C6D] bg-[#C69C6D]/15 text-[#1B263B]'
                            : 'border-slate-200 hover:border-[#C69C6D]/40 text-slate-700'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Horário (24h)</label>
                <input
                  type="time"
                  value={editTaskModal.timeStr}
                  onChange={(e) => setEditTaskModal(prev => ({ ...prev, timeStr: e.target.value || '12:00' }))}
                  disabled={editTaskModal.saving}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#C69C6D]/25 focus:border-[#C69C6D]"
                />
              </div>
              {editTaskModal.task?.source_crm_task_id ? (
                <p className="text-[11px] text-slate-500 font-medium">
                  Este cartão está ligado à Prospecção; alterações sincronizam com a tarefa do lead.
                </p>
              ) : null}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  disabled={editTaskModal.saving}
                  onClick={() =>
                    setEditTaskModal({
                      open: false,
                      task: null,
                      title: '',
                      dayYmd: '',
                      timeStr: '12:00',
                      saving: false,
                    })
                  }
                  className="flex-1 px-4 py-3 rounded-xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editTaskModal.saving}
                  className="flex-1 px-4 py-3 rounded-xl bg-[#C69C6D] text-[#1B263B] font-black hover:bg-[#b58a5b] transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {editTaskModal.saving ? <Loader2 size={18} className="animate-spin" /> : null}
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default AgendaHub;

