import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Tag, Printer, VolumeX, Volume2, Columns2, Grid2x2, Cpu, LogOut, ChevronDown, ChevronRight, Zap, Monitor, Fingerprint } from 'lucide-react';

const OPERATIONAL_MODULE_IDS = ['pos', 'cash', 'sales', 'customers', 'inventory', 'expenses', 'sync'];

export default function MobileSideNav({
  isOpen,
  onClose,
  triggerHaptic = () => {},
  T,
  isLight,
  isOledMode,
  socketConnected,
  pendingSalesCount,
  businessInfo,
  exchangeRate,
  user,
  onOpenBiometricsModal,
  drawerSearch,
  setDrawerSearch,
  filteredNavSections,
  activeModule,
  setActiveModule,
  posMode,
  setPosMode,
  onOpenThermalPrinterSettings,
  isAudioMuted,
  setIsAudioMuted,
  toggleSoundMute,
  playScanSound,
  showToast,
  theme,
  setTheme,
  logout
}) {
  // En Escritorio (Studio y Titanium), el chasis lateral es siempre Carbón Anodizado (#0a0d12)
  // En Swiss Grid, es Blanco Técnico (#ffffff) con selección en Carbón (#0f172a)
  const isCarbonSidebar = theme !== 'swiss';

  const [showAdminModules, setShowAdminModules] = useState(() => {
    return !OPERATIONAL_MODULE_IDS.includes(activeModule);
  });

  // Clasificación de secciones para modo operativo móvil
  const { operationalItems, adminSections, totalAdminItems, isAdminModuleActive } = useMemo(() => {
    const allItems = filteredNavSections.flatMap(sec => sec.items);
    
    // Items operativos ordenados según OPERATIONAL_MODULE_IDS
    const opItems = [];
    OPERATIONAL_MODULE_IDS.forEach(id => {
      const found = allItems.find(it => it.moduleId === id || it.id === id);
      if (found) opItems.push(found);
    });

    // Secciones administrativas sin los items operativos
    const admSecs = filteredNavSections.map(sec => ({
      ...sec,
      items: sec.items.filter(it => !OPERATIONAL_MODULE_IDS.includes(it.moduleId || it.id))
    })).filter(sec => sec.items.length > 0);

    const totalAdm = admSecs.reduce((acc, s) => acc + s.items.length, 0);
    const hasAdminActive = !OPERATIONAL_MODULE_IDS.includes(activeModule) && activeModule !== 'pos';

    return {
      operationalItems: opItems,
      adminSections: admSecs,
      totalAdminItems: totalAdm,
      isAdminModuleActive: hasAdminActive
    };
  }, [filteredNavSections, activeModule]);

  const renderNavButton = (item) => {
    const IconComp = item.icon;
    const isCurrent = item.moduleId ? activeModule === item.moduleId : false;
    return (
      <button
        key={item.moduleId || item.id}
        onClick={() => {
          onClose();
          setDrawerSearch('');
          if (item.moduleId) {
            setActiveModule(item.moduleId);
          }
        }}
        className={`nav-link-premium w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-left transition-all cursor-pointer group ${
          isCurrent 
            ? (isCarbonSidebar
                ? 'active bg-[#161c26] text-white font-extrabold border border-[#283242] shadow-[inset_2.5px_0_0_0_#ffffff]'
                : 'active bg-[#0f172a] text-white font-extrabold shadow-xs')
            : (isCarbonSidebar
                ? 'text-[#8e99ab] hover:bg-[#141922] hover:text-[#f8fafc] font-medium border border-transparent'
                : 'text-[#475569] hover:bg-[#f1f5f9] hover:text-[#0f172a] font-medium border border-transparent')
        }`}
      >
        <div className={`p-1.5 rounded-[5px] shrink-0 transition-colors ${
          isCurrent
            ? (isCarbonSidebar ? 'bg-white/10 text-white' : 'bg-white/15 text-white')
            : (isCarbonSidebar ? 'bg-[#121721] text-[#7c8799] group-hover:text-white' : 'bg-slate-100 text-slate-600 group-hover:text-slate-900')
        }`}>
          <IconComp size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs truncate font-bold leading-tight flex items-center justify-between">
            <span>{item.label}</span>
            {isCurrent && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/15 text-white uppercase font-black">
                Activo
              </span>
            )}
          </div>
          <p className={`text-[10px] truncate leading-tight mt-0.5 ${
            isCurrent
              ? (isCarbonSidebar ? 'text-slate-300' : 'text-slate-200')
              : (isCarbonSidebar ? 'text-[#647084]' : 'text-slate-400')
          }`}>
            {item.desc}
          </p>
        </div>
      </button>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
          <div className="fixed inset-0 z-50 flex">
            {/* Fondo oscuro para cerrar al tocar fuera */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/75"
              onClick={() => {
                triggerHaptic(10);
                onClose();
              }}
            />

            {/* Panel Lateral Deslizante con el estilo exacto del Chasis Lateral de Escritorio */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0.5, right: 0.05 }}
              onDragEnd={(e, { offset, velocity }) => {
                if (offset.x < -65 || velocity.x < -300) {
                  triggerHaptic(15);
                  onClose();
                }
              }}
              className={`app-main-sidebar relative flex flex-col w-76 sm:w-88 max-w-[88vw] h-full border-r shadow-2xl z-10 overflow-hidden touch-pan-y ${
                isCarbonSidebar
                  ? 'bg-[#0a0d12] border-[#1e242e] text-[#e2e8f0]'
                  : 'bg-white border-[#d8dee8] text-[#0f172a]'
              }`}
            >
            
            {/* Cabecera Unificada y Datos del Comercio (Espacio Optimizado sin logo viejo) */}
            <div className={`p-3.5 border-b shrink-0 space-y-2.5 ${
              isCarbonSidebar ? 'border-[#1e242e] bg-[#0c1017]' : 'border-[#d8dee8] bg-[#f8fafc]'
            }`}>
              {/* Fila 1: Nombre de Comercio + Tasa BCV + Botón Cerrar */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${socketConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                    <span className={`text-[10px] font-extrabold uppercase tracking-wider truncate ${
                      socketConnected ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {socketConnected ? 'Comercio en Línea' : `Offline (${pendingSalesCount} pend.)`}
                    </span>
                  </div>
                  <h3 className={`font-black text-sm truncate leading-tight ${
                    isCarbonSidebar ? 'text-white' : 'text-[#0f172a]'
                  }`}>
                    {businessInfo.name || 'Bodega Sigfrido y Familia'}
                  </h3>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span 
                    className={`px-2 py-1 rounded-[7px] text-[11px] font-mono font-black border select-none ${
                      isCarbonSidebar
                        ? 'bg-[#161c26] border-[#283242] text-amber-400 shadow-2xs'
                        : 'bg-amber-50 border-amber-200 text-amber-800'
                    }`}
                    title={`Tasa oficial BCV: Bs. ${exchangeRate.toFixed(2)}`}
                  >
                    Bs. {exchangeRate.toFixed(2)}
                  </span>
                  <button 
                    type="button"
                    onClick={() => onClose()}
                    className={`p-1.5 rounded-[7px] border transition-all cursor-pointer active:scale-90 ${
                      isCarbonSidebar
                        ? 'bg-[#121721] hover:bg-[#1a212e] text-[#94a3b8] hover:text-white border-[#1e242e]'
                        : 'bg-white hover:bg-slate-100 text-slate-600 border-slate-200 shadow-2xs'
                    }`}
                    title="Cerrar menú"
                  >
                    <X size={17} />
                  </button>
                </div>
              </div>

              {/* Fila 2: Cajero y Estado de Terminal */}
              <div className={`flex items-center justify-between text-xs pt-0.5 ${
                isCarbonSidebar ? 'text-[#8e99ab]' : 'text-slate-600'
              }`}>
                <span className="truncate">Cajero: <b className={isCarbonSidebar ? 'text-white' : 'text-[#0f172a]'}>{user?.name || user?.username || 'Cajero Móvil'}</b></span>
                <span className="shrink-0 text-[10.5px] font-bold text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">Terminal Móvil</span>
              </div>

              {/* Fila 3: Botón de Huella Dactilar */}
              {user && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(15);
                    onClose();
                    onOpenBiometricsModal?.();
                  }}
                  className={`w-full py-1.5 px-2.5 rounded-[6px] border text-xs font-bold flex items-center justify-between transition-all cursor-pointer ${
                    isCarbonSidebar
                      ? 'bg-[#121721] hover:bg-[#1a212e] text-sky-400 border-sky-500/30'
                      : 'bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-200'
                  }`}
                  title="Registrar o gestionar huella dactilar"
                >
                  <span className="flex items-center gap-1.5">
                    <Fingerprint size={14} className="text-sky-500" />
                    <span>Huella Dactilar</span>
                  </span>
                  <span className="text-[10px] font-semibold opacity-80">Gestionar &rarr;</span>
                </button>
              )}
            </div>

            {/* Buscador Rápido de Opciones del Sistema Principal */}
            <div className={`p-2.5 border-b shrink-0 ${
              isCarbonSidebar ? 'border-[#1e242e] bg-[#0a0d12]' : 'border-[#d8dee8] bg-white'
            }`}>
              <div className={`flex items-center gap-2 px-3 py-2 rounded-[6px] border ${
                isCarbonSidebar
                  ? 'bg-[#121721] border-[#1e242e] text-white'
                  : 'bg-[#f4f5f7] border-[#d5dae2] text-[#0f172a]'
              }`}>
                <Search size={14} className={isCarbonSidebar ? 'text-[#7c8799]' : 'text-slate-400'} />
                <input 
                  type="text"
                  placeholder="Buscar módulo en el menú..."
                  value={drawerSearch}
                  onChange={(e) => setDrawerSearch(e.target.value)}
                  className={`bg-transparent flex-1 text-xs outline-none font-medium ${
                    isCarbonSidebar ? 'text-white placeholder-[#647084]' : 'text-[#0f172a] placeholder-slate-400'
                  }`}
                />
                {drawerSearch && (
                  <button onClick={() => setDrawerSearch('')} className={isCarbonSidebar ? 'text-[#7c8799]' : 'text-slate-400'}>
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* Lista de Secciones y Opciones del Sistema */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-3 custom-scrollbar">
              {drawerSearch.trim() ? (
                /* Búsqueda Activa: Resultados directos de cualquier módulo */
                filteredNavSections.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 space-y-1">
                    <Search size={24} className="mx-auto text-slate-400 mb-2 opacity-60" />
                    <p className="font-bold">No se encontró "{drawerSearch}"</p>
                    <p className="text-[10px] text-slate-400">Intenta buscar por otro nombre o función</p>
                  </div>
                ) : (
                  filteredNavSections.map((sec, sIdx) => (
                    <div key={sIdx} className="space-y-1">
                      <div className={`px-2 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 ${
                        isCarbonSidebar ? 'text-[#647084]' : 'text-slate-400'
                      }`}>
                        <span className={`w-1 h-1 rounded-full ${isCarbonSidebar ? 'bg-slate-400' : 'bg-slate-700'}`}></span>
                        <span>{sec.title}</span>
                      </div>
                      <div className="space-y-0.5">
                        {sec.items.map(item => renderNavButton(item))}
                      </div>
                    </div>
                  ))
                )
              ) : (
                /* Modo Móvil Inteligente: Operaciones de Caja/Pasillo directas + Acordeón ERP Administrativo */
                <>
                  {/* Bloque 1: Operaciones Rápidas de Pasillo y Caja */}
                  <div className="space-y-1">
                    <div className={`px-2 text-[10px] font-black uppercase tracking-widest flex items-center justify-between ${
                      isCarbonSidebar ? 'text-emerald-400' : 'text-emerald-700'
                    }`}>
                      <span className="flex items-center gap-1.5">
                        <Zap size={11} className="text-emerald-400" />
                        <span>Operaciones de Caja & Pasillo</span>
                      </span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 font-bold">
                        Rápido
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {operationalItems.map(item => renderNavButton(item))}
                    </div>
                  </div>

                  {/* Bloque 2: Módulos Administrativos y de Gestión (PC / ERP) */}
                  {totalAdminItems > 0 && (
                    <div className="space-y-1 pt-1 border-t border-dashed border-slate-700/40">
                      <button
                        type="button"
                        onClick={() => {
                          triggerHaptic(10);
                          setShowAdminModules(prev => !prev);
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-2 rounded-[6px] border transition-all cursor-pointer ${
                          showAdminModules
                            ? (isCarbonSidebar ? 'bg-[#141a24] border-[#252f40] text-white' : 'bg-slate-100 border-slate-300 text-slate-800')
                            : (isCarbonSidebar ? 'bg-[#0e1218] hover:bg-[#121720] border-[#1a212c] text-[#8e99ab]' : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600')
                        }`}
                      >
                        <div className="flex items-center gap-2 text-xs font-bold">
                          <div className={`p-1 rounded-[4px] ${isCarbonSidebar ? 'bg-[#1e2532] text-indigo-400' : 'bg-indigo-100 text-indigo-600'}`}>
                            <Monitor size={13} />
                          </div>
                          <span>Gestión & Reportes PC</span>
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full bg-slate-700/40 text-slate-300">
                            {totalAdminItems}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {isAdminModuleActive && !showAdminModules && (
                            <span className="text-[9px] font-black text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/20">
                              Activo
                            </span>
                          )}
                          {showAdminModules ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                        </div>
                      </button>

                      {showAdminModules && (
                        <div className="space-y-2 pt-1 pl-1">
                          {adminSections.map((sec, sIdx) => (
                            <div key={sIdx} className="space-y-1">
                              <div className={`px-2 text-[9px] font-black uppercase tracking-wider flex items-center gap-1.5 ${
                                isCarbonSidebar ? 'text-[#647084]' : 'text-slate-400'
                              }`}>
                                <span className={`w-1 h-1 rounded-full ${isCarbonSidebar ? 'bg-slate-500' : 'bg-slate-400'}`}></span>
                                <span>{sec.title}</span>
                              </div>
                              <div className="space-y-0.5">
                                {sec.items.map(item => renderNavButton(item))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Pie del Menú con Controles de Hardware y Arquitectura Visual */}
            <div
              className={`p-3 border-t shrink-0 space-y-2 ${
                isCarbonSidebar ? 'border-[#1e242e] bg-[#080a0e]' : 'border-[#d8dee8] bg-[#f8fafc]'
              }`}
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
            >
              {/* Fila de Utilidades Rápidas: Consultor, Impresora BT y Sonido */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(15);
                    const nextMode = posMode === 'SALE' ? 'PRICE_CHECKER' : 'SALE';
                    setPosMode(nextMode);
                    onClose();
                    showToast(nextMode === 'PRICE_CHECKER' ? '🏷️ Consultor de Precios activado' : '🛒 Modo Venta activado');
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-[6px] border text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    posMode === 'PRICE_CHECKER'
                      ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                      : isCarbonSidebar
                      ? 'bg-[#121721] hover:bg-[#1a212e] text-[#cbd5e1] border-[#1e242e]'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  <Tag size={13} className={posMode === 'PRICE_CHECKER' ? 'text-amber-400' : ''} />
                  <span>{posMode === 'PRICE_CHECKER' ? 'Modo Consultor' : 'Modo Venta'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(15);
                    onClose();
                    onOpenThermalPrinterSettings();
                  }}
                  className={`py-1.5 px-2.5 rounded-[6px] border text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    isCarbonSidebar
                      ? 'bg-[#121721] hover:bg-[#1a212e] text-[#cbd5e1] border-[#1e242e]'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                  title="Configurar Impresora Térmica Bluetooth"
                >
                  <Printer size={13} className="text-emerald-400" />
                  <span>BT</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic(15);
                    const nextMuted = toggleSoundMute();
                    setIsAudioMuted(nextMuted);
                    if (!nextMuted) playScanSound();
                    showToast(nextMuted ? '🔇 Audio silenciado' : '🔊 Audio activado');
                  }}
                  className={`p-1.5 rounded-[6px] border transition-all cursor-pointer ${
                    isAudioMuted
                      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      : isCarbonSidebar
                      ? 'bg-[#121721] hover:bg-[#1a212e] text-[#cbd5e1] border-[#1e242e]'
                      : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                  title={isAudioMuted ? 'Activar sonido' : 'Silenciar sonido'}
                >
                  {isAudioMuted ? <VolumeX size={14} /> : <Volume2 size={14} className="text-emerald-400" />}
                </button>
              </div>

              {/* Fila: Selector de Arquitectura Visual + Cerrar Sesión */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTheme(prev => prev === 'studio' ? 'swiss' : prev === 'swiss' ? 'titanium' : 'studio')}
                  className={`flex-1 py-1.5 px-2.5 rounded-[6px] border text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    isCarbonSidebar
                      ? 'bg-[#121721] hover:bg-[#1a212e] text-[#e2e8f0] border-[#1e242e]'
                      : 'bg-white hover:bg-slate-100 text-slate-800 border-slate-200'
                  }`}
                >
                  {theme === 'swiss' ? (
                    <Grid2x2 size={13} className="text-slate-600" />
                  ) : theme === 'titanium' ? (
                    <Cpu size={13} className="text-slate-300" />
                  ) : (
                    <Columns2 size={13} className="text-emerald-400" />
                  )}
                  <span>{theme === 'swiss' ? 'Swiss Grid' : theme === 'titanium' ? 'Titanium' : 'Studio'}</span>
                </button>

                {user && (
                  <button
                    onClick={() => {
                      onClose();
                      logout();
                    }}
                    className="p-2 rounded-[6px] bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 transition-all cursor-pointer"
                    title="Cerrar sesión"
                  >
                    <LogOut size={15} />
                  </button>
                )}
              </div>
            </div>

            </motion.aside>
          </div>
        )}

    </AnimatePresence>
  );
}