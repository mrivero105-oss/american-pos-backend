import { useState, useEffect } from 'react';
import { Building2, Globe } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../hooks/AuthContext';

export default function BranchSelector({ compact = false }) {
    const { user } = useAuth();
    const [branches, setBranches] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchBranches = async () => {
            if (['admin', 'superadmin'].includes(user?.role?.toLowerCase())) {
                try {
                    const { data } = await api.get('/branches');
                    setBranches(Array.isArray(data) ? data : []);
                } catch (error) {
                    console.error('Error fetching branches:', error);
                } finally {
                    setLoading(false);
                }
            } else {
                setLoading(false);
            }
        };
        fetchBranches();
    }, [user?.role]);

    const handleSwitchBranch = async (e) => {
        const newBranchId = e.target.value === 'global' ? null : e.target.value;
        try {
            await api.post('/branches/switch', { branchId: newBranchId });

            // Reload page to apply new branch context across all mounted components
            window.location.reload();
        } catch (error) {
            console.error('Error switching branch:', error);
            toast.error('Error al cambiar de sucursal');
        }
    };

    if (loading || !['admin', 'superadmin'].includes(user?.role?.toLowerCase())) {
        return null;
    }

    if (compact) {
        return (
            <div className="flex items-center gap-2 w-full px-2.5 py-1.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-white/10 shadow-xs">
                <div className="p-1.5 rounded-lg shrink-0 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                    {user?.activeBranchId ? <Building2 size={14} strokeWidth={2} /> : <Globe size={14} strokeWidth={2} />}
                </div>
                <div className="flex-1 min-w-0">
                    <span className="block text-[8px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500 leading-none mb-0.5">Sucursal</span>
                    <select
                        value={user?.activeBranchId || 'global'}
                        onChange={handleSwitchBranch}
                        className="w-full bg-transparent text-xs font-bold text-slate-800 dark:text-slate-100 outline-none cursor-pointer tracking-normal truncate py-0 leading-tight"
                    >
                        <option value="global" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-white">Vista Global (Todas)</option>
                        {Array.isArray(branches) && branches.map(b => (
                            <option key={b.id} value={b.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-white">{b.name}</option>
                        ))}
                    </select>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1.5 pl-0.5 pr-1">
            <Building2 size={13} strokeWidth={2} className="text-slate-500 dark:text-slate-400 shrink-0" />
            
            <select
                value={user?.activeBranchId || 'global'}
                onChange={handleSwitchBranch}
                className="bg-transparent text-[11.5px] font-bold text-slate-800 dark:text-slate-100 outline-none cursor-pointer tracking-normal max-w-[120px] sm:max-w-[150px] truncate py-0.5"
                title="Sucursal Activa"
            >
                <option value="global" className="bg-white dark:bg-slate-900 text-slate-800 dark:text-white">Vista Global (Todas)</option>
                {Array.isArray(branches) && branches.map(b => (
                    <option key={b.id} value={b.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-white">{b.name}</option>
                ))}
            </select>
        </div>
    );
}
