import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { CRMTask } from '../types';
import { Plus, X, Clock, CheckCircle2, Loader2, Phone, Mail, Users, RefreshCw, BookText, Save } from 'lucide-react';

interface TaskManagerProps {
    prospectId?: string;
    saleId?: number;
    saleIds?: number[]; // For aggregated client view
    onTaskChange: () => void;
}

const TaskManager: React.FC<TaskManagerProps> = ({ prospectId, saleId, saleIds, onTaskChange }) => {
    const [leadTasks, setLeadTasks] = useState<CRMTask[]>([]);
    const [loadingTasks, setLoadingTasks] = useState(false);
    const [isAdding, setIsAdding] = useState(false);
    const [saving, setSaving] = useState(false);
    const [newTask, setNewTask] = useState({ title: '', due_date: '', type: 'task' as any });

    const TASK_TYPES: { value: string; label: string; icon: any; color: string }[] = [
        { value: 'task', label: 'Tarefa', icon: <BookText size={14} />, color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
        { value: 'call', label: 'Ligação', icon: <Phone size={14} />, color: 'bg-blue-50 text-blue-700 border-blue-200' },
        { value: 'email', label: 'E-mail', icon: <Mail size={14} />, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
        { value: 'meeting', label: 'Reunião', icon: <Users size={14} />, color: 'bg-amber-50 text-amber-700 border-amber-200' },
        { value: 'renewal', label: 'Renovação', icon: <RefreshCw size={14} />, color: 'bg-rose-50 text-rose-700 border-rose-200' },
    ];

    const load = async () => {
        setLoadingTasks(true);
        let query = supabase.from('crm_tasks').select('*').order('due_date', { ascending: true });
        
        if (prospectId) {
            query = query.eq('prospect_id', prospectId);
        } else if (saleId) {
            query = query.eq('sale_id', saleId);
        } else if (saleIds && saleIds.length > 0) {
            query = query.in('sale_id', saleIds);
        } else {
            setLeadTasks([]);
            setLoadingTasks(false);
            return;
        }

        const { data } = await query;
        setLeadTasks(data || []);
        setLoadingTasks(false);
    };

    useEffect(() => {
        load();
    }, [prospectId, saleId, saleIds]);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTask.title || !newTask.due_date) return;
        setSaving(true);
        try {
            const taskData: any = { 
                ...newTask, 
                status: 'pending' 
            };
            if (prospectId) taskData.prospect_id = prospectId;
            else if (saleId) taskData.sale_id = saleId;
            else if (saleIds && saleIds.length > 0) taskData.sale_id = saleIds[0]; // Anchor to first sale

            const { error } = await supabase.from('crm_tasks').insert([taskData]);
            if (error) throw error;
            
            await load();
            setIsAdding(false);
            setNewTask({ title: '', due_date: '', type: 'task' });
            onTaskChange(); 
        } catch (err) { alert('Erro ao criar tarefa'); }
        finally { setSaving(false); }
    };

    const toggleStatus = async (task: CRMTask) => {
        const newStatus = task.status === 'pending' ? 'completed' : 'pending';
        await supabase.from('crm_tasks').update({ status: newStatus }).eq('id', task.id);
        setLeadTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
        onTaskChange();
    };

    const deleteTask = async (task: CRMTask) => {
        if (!confirm('Deseja excluir esta tarefa?')) return;
        await supabase.from('crm_tasks').delete().eq('id', task.id);
        setLeadTasks(prev => prev.filter(t => t.id !== task.id));
        onTaskChange();
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest">Tarefas & Lembretes</h4>
                <button 
                    onClick={() => setIsAdding(!isAdding)} 
                    className="text-xs font-bold text-indigo-600 flex items-center gap-1 hover:bg-indigo-50 px-2 py-1 rounded-lg transition-colors"
                >
                    {isAdding ? <X size={14} /> : <Plus size={14} />}
                    {isAdding ? 'Cancelar' : 'Nova Tarefa'}
                </button>
            </div>

            {isAdding && (
                <form onSubmit={handleAdd} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 animate-in slide-in-from-top-2 duration-200 space-y-4">
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">O que fazer?</label>
                            <input autoFocus type="text" placeholder="Ex: Ligar para confirmar proposta" value={newTask.title} onChange={e => setNewTask({...newTask, title: e.target.value})} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500/20" />
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Quando?</label>
                                <input type="datetime-local" value={newTask.due_date} onChange={e => setNewTask({...newTask, due_date: e.target.value})} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500/20" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Tipo</label>
                                <div className="flex items-center h-[38px] px-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-500 italic">
                                    Selecione abaixo ↓
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2 pt-1">
                            <div className="flex flex-wrap gap-2">
                                {TASK_TYPES.map(type => (
                                    <button
                                        key={type.value}
                                        type="button"
                                        onClick={() => setNewTask({...newTask, type: type.value})}
                                        className={`flex-1 flex flex-col items-center justify-center p-2 rounded-xl border-2 transition-all gap-1 ${newTask.type === type.value 
                                            ? `${type.color} ring-2 ring-offset-1 ring-indigo-500/20 scale-105` 
                                            : 'bg-white border-slate-100 text-slate-400 hover:border-slate-200 hover:bg-slate-50'}`}
                                    >
                                        {type.icon}
                                        <span className="text-[9px] font-bold uppercase">{type.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button 
                            type="submit" 
                            disabled={saving || !newTask.title || !newTask.due_date}
                            className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                            {saving ? 'Salvando...' : 'Salvar Lembrete'}
                        </button>
                    </div>
                </form>
            )}

            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1 custom-scroll">
                {leadTasks.map(task => {
                    const isOverdue = task.status === 'pending' && new Date(task.due_date) < new Date();
                    return (
                        <div key={task.id} className={`flex items-start gap-3 p-3 rounded-2xl border transition-all ${task.status === 'completed' ? 'bg-slate-50 border-transparent opacity-60' : 'bg-white border-slate-100 hover:border-slate-200'}`}>
                            <button 
                                onClick={() => toggleStatus(task)} 
                                className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${task.status === 'completed' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-200 hover:border-indigo-400'}`}
                            >
                                {task.status === 'completed' && <CheckCircle2 size={12} />}
                            </button>
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-bold ${task.status === 'completed' ? 'line-through text-slate-400' : 'text-slate-700'}`}>{task.title}</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${task.status === 'completed' ? 'bg-slate-100 text-slate-400' : 'bg-indigo-50 text-indigo-600'}`}>
                                        {task.type}
                                    </span>
                                    <span className={`text-[10px] font-bold flex items-center gap-1 ${isOverdue ? 'text-rose-500' : 'text-slate-400'}`}>
                                        <Clock size={10} /> {new Date(task.due_date).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                </div>
                            </div>
                            <button onClick={() => deleteTask(task)} className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-rose-500 transition-all">
                                <X size={14} />
                            </button>
                        </div>
                    );
                })}
                {leadTasks.length === 0 && !loadingTasks && (
                    <div className="text-center py-6 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                        <p className="text-xs font-bold text-slate-400">Nenhuma tarefa agendada</p>
                    </div>
                )}
                {loadingTasks && (
                    <div className="flex justify-center py-4">
                        <Loader2 size={20} className="animate-spin text-slate-300" />
                    </div>
                )}
            </div>
        </div>
    );
};

export default TaskManager;
